const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { interpretMessage, generateReport } = require('./gemini');
const { transcribeAudio } = require('./whisper');
const { sendText, downloadMedia } = require('./evolution');

// ─── Helpers de stats ────────────────────────────────────────
async function getUserStats(userId) {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const income   = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=? AND type='receita' AND date>=? AND (paid=1 OR installment_total=1)`).get(userId, start);
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=? AND type='despesa' AND date>=? AND (paid=1 OR installment_total=1)`).get(userId, start);
  const count    = db.prepare(`SELECT COUNT(*) as t FROM transactions WHERE user_id=? AND date>=?`).get(userId, start);
  const topCats  = db.prepare(`SELECT category, SUM(amount) as total FROM transactions WHERE user_id=? AND type='despesa' AND date>=? GROUP BY category ORDER BY total DESC LIMIT 3`).all(userId, start);
  return {
    income: income.t, expenses: expenses.t,
    balance: income.t - expenses.t,
    count: count.t,
    topCategories: topCats.map(c => `${c.category} (R$${Math.round(c.total)})`).join(', ') || 'nenhuma ainda',
  };
}

function getUserCategories(userId) {
  return db.prepare(`SELECT name FROM categories WHERE user_id=?`).all(userId).map(r => r.name);
}

function getUserAccounts(userId) {
  return db.prepare(`SELECT * FROM accounts WHERE user_id=?`).all(userId);
}

function getUserCards(userId) {
  return db.prepare(`SELECT * FROM cards WHERE user_id=?`).all(userId);
}

// ─── Webhook principal ───────────────────────────────────────
async function handleWebhook(body) {
  const event = body?.event;
  const data  = body?.data;
  if (event !== 'messages.upsert') return;
  if (data?.key?.fromMe) return;

  const phone       = data?.key?.remoteJid?.replace('@s.whatsapp.net', '');
  const messageType = data?.messageType;
  const messageId   = data?.key?.id;
  if (!phone) return;

  // Busca ou cria usuário
  let user = db.prepare(`SELECT * FROM users WHERE phone=?`).get(phone);
  if (!user) {
    const id = uuidv4();
    db.prepare(`INSERT INTO users (id, name, phone, plan, trial_ends_at) VALUES (?, ?, ?, 'trial', datetime('now', '+7 days'))`).run(id, `Usuário ${phone.slice(-4)}`, phone);
    user = db.prepare(`SELECT * FROM users WHERE phone=?`).get(phone);
    await sendText(phone,
      `Oi! 👋 Sou o *Plano*, seu assistente financeiro do *PlanejaIA*!\n\n` +
      `Me conta qualquer gasto ou receita — pode ser por texto ou áudio — e eu registro na hora pra você.\n\n` +
      `Exemplos:\n_"Gastei R$45 no almoço hoje"_\n_"Recebi R$3.000 de salário"_\n_"Comprei geladeira 12x R$150 no crédito"_\n\n` +
      `Também pode me perguntar qualquer coisa sobre finanças. Tô aqui! 😊`
    );
    return;
  }

  // Verifica trial
  if (user.plan === 'trial' && new Date(user.trial_ends_at) < new Date()) {
    await sendText(phone,
      `⏰ Seu período de teste de 7 dias encerrou!\n\n` +
      `Para continuar usando o PlanejaIA, acesse nosso Instagram e assine o plano. É menos de R$1,50 por dia 😊`
    );
    return;
  }

  let text = '';

  // ─── Áudio → Whisper ────────────────────────────────────────
  if (messageType === 'audioMessage') {
    await sendText(phone, '🎙️ Deixa eu ouvir isso...');
    try {
      const audioBuffer = await downloadMedia(messageId, 'audioMessage');
      text = await transcribeAudio(audioBuffer);
    } catch {
      await sendText(phone, 'Não consegui ouvir o áudio 😅 Tenta me mandar em texto?');
      return;
    }
  }

  // ─── Foto/nota fiscal → Gemini Vision ───────────────────────
  else if (messageType === 'imageMessage') {
    await sendText(phone, '📷 Analisando a nota...');
    try {
      const imgBuffer = await downloadMedia(messageId, 'imageMessage');
      const base64 = imgBuffer.toString('base64');
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent([
        { text: `Você é um assistente financeiro. Analise essa nota fiscal ou extrato e extraia os lançamentos. Responda APENAS com JSON: { "items": [{ "description": "...", "amount": 0.00, "category": "..." }], "total": 0.00, "date": "YYYY-MM-DD" }. Se não for nota fiscal, retorne { "items": [], "total": 0, "date": "" }` },
        { inlineData: { mimeType: 'image/jpeg', data: base64 } }
      ]);
      const raw = result.response.text().replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(raw);
      if (!parsed.items?.length) {
        await sendText(phone, 'Não encontrei lançamentos nessa imagem. Tenta mandar a nota mais nítida, ou me conta por texto mesmo 😊');
        return;
      }
      const pendingData = { type: 'batch', items: parsed.items, date: parsed.date || new Date().toISOString().split('T')[0], total: parsed.total };
      db.prepare(`DELETE FROM pending_confirmations WHERE phone=?`).run(phone);
      db.prepare(`INSERT INTO pending_confirmations (id, user_id, phone, data) VALUES (?, ?, ?, ?)`).run(uuidv4(), user.id, phone, JSON.stringify(pendingData));
      const lista = parsed.items.map(i => `• ${i.description}: R$${Number(i.amount).toFixed(2)}`).join('\n');
      await sendText(phone,
        `📋 Achei ${parsed.items.length} item(ns) na nota:\n\n${lista}\n\n*Total: R$${Number(parsed.total).toFixed(2)}*\n\nResponde *SIM* pra registrar tudo ou *NÃO* pra cancelar.`
      );
      return;
    } catch {
      await sendText(phone, 'Não consegui ler essa imagem 😅 Tenta mandar mais nítida ou me conta por texto!');
      return;
    }
  }

  else if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
    text = data?.message?.conversation || data?.message?.extendedTextMessage?.text || '';
  } else {
    return;
  }

  if (!text?.trim()) return;
  text = text.trim();

  // ─── Seleção de conta/cartão pendente ───────────────────────
  const pendingAccSel = db.prepare(`SELECT * FROM pending_account_selection WHERE phone=? ORDER BY created_at DESC LIMIT 1`).get(phone);
  if (pendingAccSel) {
    const txData = JSON.parse(pendingAccSel.tx_data);
    const type   = pendingAccSel.selection_type; // 'account' ou 'card'
    const lower  = text.toLowerCase().trim();

    if (type === 'account') {
      const accounts = getUserAccounts(user.id);
      // Tentar identificar a conta pelo nome ou número
      const chosen = accounts.find(a =>
        lower.includes(a.name.toLowerCase()) ||
        lower.includes(String(accounts.indexOf(a) + 1))
      );
      if (!chosen && accounts.length > 0) {
        const lista = accounts.map((a, i) => `${i+1}. ${a.emoji} ${a.name} (R$${a.balance.toFixed(2)})`).join('\n');
        await sendText(phone, `Não entendi qual conta 😅 Responde com o nome ou número:\n\n${lista}`);
        return;
      }
      txData.account_id = chosen?.id || null;
      // Descontar do saldo da conta
      if (chosen) {
        db.prepare(`UPDATE accounts SET balance = balance - ? WHERE id=?`).run(txData.amount, chosen.id);
      }
    } else if (type === 'card') {
      const cards = getUserCards(user.id);
      const chosen = cards.find(c =>
        lower.includes(c.name.toLowerCase()) ||
        lower.includes(String(cards.indexOf(c) + 1))
      );
      if (!chosen && cards.length > 0) {
        const lista = cards.map((c, i) => `${i+1}. 💳 ${c.name} (fatura: R$${c.current_bill.toFixed(2)})`).join('\n');
        await sendText(phone, `Não entendi qual cartão 😅 Responde com o nome ou número:\n\n${lista}`);
        return;
      }
      txData.card_id = chosen?.id || null;
      // Aumentar fatura do cartão
      if (chosen) {
        db.prepare(`UPDATE cards SET current_bill = current_bill + ? WHERE id=?`).run(txData.amount, chosen.id);
      }
    }

    // Salvar transação
    db.prepare(`DELETE FROM pending_account_selection WHERE phone=?`).run(phone);
    db.prepare(`INSERT INTO transactions (id, user_id, type, description, amount, category, date, method, account_id, card_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), user.id, txData.type, txData.description, txData.amount, txData.category, txData.date, txData.method || 'PIX', txData.account_id || null, txData.card_id || null);

    const stats = await getUserStats(user.id);
    const signal = txData.type === 'receita' ? '+' : '-';
    await sendText(phone,
      `✅ Registrado!\n${txData.description} — ${signal}R$${txData.amount.toFixed(2)}\n\nSaldo do mês: *R$${stats.balance.toFixed(2)}*`
    );
    return;
  }

  // ─── Confirmação pendente normal ────────────────────────────
  const pending = db.prepare(`SELECT * FROM pending_confirmations WHERE phone=? ORDER BY created_at DESC LIMIT 1`).get(phone);

  if (pending) {
    const lower  = text.toLowerCase();
    const isYes  = ['sim','s','✅','confirmar','confirma','yes'].includes(lower);
    const isNo   = ['não','nao','n','cancelar','cancela','no'].includes(lower);

    if (isYes) {
      const txData = JSON.parse(pending.data);
      db.prepare(`DELETE FROM pending_confirmations WHERE phone=?`).run(phone);

      if (txData.type === 'batch') {
        for (const item of txData.items) {
          db.prepare(`INSERT INTO transactions (id, user_id, type, description, amount, category, date) VALUES (?, ?, 'despesa', ?, ?, ?, ?)`)
            .run(uuidv4(), user.id, item.description, item.amount, item.category || 'Outros', txData.date);
        }
        await sendText(phone, `✅ Pronto! ${txData.items.length} lançamento(s) da nota registrados. Tá tudo no seu painel 📊`);
        return;
      }

      // Parcelas
      if (txData.installment_total > 1) {
        const groupId = uuidv4();
        for (let i = 1; i <= txData.installment_total; i++) {
          const d = new Date(txData.date);
          d.setMonth(d.getMonth() + (i - 1));
          db.prepare(`INSERT INTO transactions (id, user_id, type, description, amount, category, date, method, installment_total, installment_current, installment_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(uuidv4(), user.id, txData.type, `${txData.description} (${i}/${txData.installment_total})`,
              txData.amount / txData.installment_total, txData.category,
              d.toISOString().split('T')[0], txData.method || 'Crédito',
              txData.installment_total, i, groupId);
        }
        // Perguntar qual cartão para parcelas no crédito
        const cards = getUserCards(user.id);
        if (cards.length > 0) {
          db.prepare(`INSERT INTO pending_account_selection (id, user_id, phone, tx_data, selection_type) VALUES (?, ?, ?, ?, ?)`)
            .run(uuidv4(), user.id, phone, JSON.stringify({...txData, installment_total: 1, amount: txData.amount / txData.installment_total}), 'card');
          const lista = cards.map((c, i) => `${i+1}. 💳 ${c.name}`).join('\n');
          await sendText(phone,
            `✅ ${txData.installment_total} parcelas de R$${(txData.amount/txData.installment_total).toFixed(2)} criadas no app!\n\nEm qual cartão foi?\n\n${lista}`
          );
        } else {
          await sendText(phone, `✅ ${txData.installment_total} parcelas de R$${(txData.amount/txData.installment_total).toFixed(2)} criadas no app! 📊`);
        }
        return;
      }

      // Transação simples — verificar se precisa perguntar conta/cartão
      if (txData.needs_account && (txData.method === 'Débito' || txData.method === 'Crédito')) {
        const selType = txData.method === 'Débito' ? 'account' : 'card';
        const items   = selType === 'account' ? getUserAccounts(user.id) : getUserCards(user.id);

        if (items.length === 1) {
          // Só tem uma — usar automaticamente
          txData.account_id = selType === 'account' ? items[0].id : null;
          txData.card_id    = selType === 'card'    ? items[0].id : null;
          if (selType === 'account') db.prepare(`UPDATE accounts SET balance = balance - ? WHERE id=?`).run(txData.amount, items[0].id);
          if (selType === 'card')    db.prepare(`UPDATE cards SET current_bill = current_bill + ? WHERE id=?`).run(txData.amount, items[0].id);
          db.prepare(`INSERT INTO transactions (id, user_id, type, description, amount, category, date, method, account_id, card_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(uuidv4(), user.id, txData.type, txData.description, txData.amount, txData.category, txData.date, txData.method, txData.account_id||null, txData.card_id||null);
          const stats = await getUserStats(user.id);
          await sendText(phone, `✅ Registrado no ${items[0].name}!\n${txData.description} — -R$${txData.amount.toFixed(2)}\n\nSaldo do mês: *R$${stats.balance.toFixed(2)}*`);
        } else if (items.length > 1) {
          db.prepare(`INSERT INTO pending_account_selection (id, user_id, phone, tx_data, selection_type) VALUES (?, ?, ?, ?, ?)`)
            .run(uuidv4(), user.id, phone, JSON.stringify(txData), selType);
          const lista = items.map((a, i) => `${i+1}. ${selType==='account'?(a.emoji+' '):'💳 '}${a.name}${selType==='account'?' (R$'+a.balance.toFixed(2)+')':''}`).join('\n');
          await sendText(phone, `Em qual ${selType==='account'?'conta':'cartão'} foi?\n\n${lista}`);
        } else {
          // Nenhuma conta/cartão cadastrado — salvar sem vínculo
          db.prepare(`INSERT INTO transactions (id, user_id, type, description, amount, category, date, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(uuidv4(), user.id, txData.type, txData.description, txData.amount, txData.category, txData.date, txData.method||'PIX');
          const stats = await getUserStats(user.id);
          await sendText(phone, `✅ Registrado!\n${txData.description} — -R$${txData.amount.toFixed(2)}\n\nSaldo do mês: *R$${stats.balance.toFixed(2)}*`);
        }
        return;
      }

      // PIX ou Dinheiro — salvar direto
      db.prepare(`INSERT INTO transactions (id, user_id, type, description, amount, category, date, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), user.id, txData.type, txData.description, txData.amount, txData.category, txData.date, txData.method||'PIX');
      const signal = txData.type === 'receita' ? '+' : '-';
      const stats  = await getUserStats(user.id);
      await sendText(phone,
        `✅ Registrado!\n${txData.description} — ${signal}R$${txData.amount.toFixed(2)}\n\nSaldo do mês: *R$${stats.balance.toFixed(2)}*`
      );
      return;
    }

    if (isNo) {
      db.prepare(`DELETE FROM pending_confirmations WHERE phone=?`).run(phone);
      await sendText(phone, 'Tudo bem, cancelado! Qualquer coisa é só me chamar 😊');
      return;
    }
  }

  // ─── Interpreta nova mensagem ────────────────────────────────
  const categories = getUserCategories(user.id);
  const stats      = await getUserStats(user.id);
  const accounts   = getUserAccounts(user.id);
  const cards      = getUserCards(user.id);

  const lower = text.toLowerCase();
  if (lower.includes('relatório') || lower.includes('relatorio') || lower.includes('resumo do mês') || lower.includes('como tô') || lower.includes('como to')) {
    const report = await generateReport(stats);
    await sendText(phone, report);
    return;
  }

  const interpreted = await interpretMessage(text, categories, stats, accounts, cards);

  if (interpreted.type === 'transaction') {
    const tx = interpreted.data;
    db.prepare(`DELETE FROM pending_confirmations WHERE phone=?`).run(phone);
    db.prepare(`INSERT INTO pending_confirmations (id, user_id, phone, data) VALUES (?, ?, ?, ?)`).run(uuidv4(), user.id, phone, JSON.stringify(tx));

    const signal      = tx.type === 'receita' ? '+' : '-';
    const parcelaInfo = tx.installment_total > 1 ? `\n🔢 ${tx.installment_total}x de R$${(tx.amount / tx.installment_total).toFixed(2)}` : '';
    const methodInfo  = tx.method ? `\n💳 ${tx.method}` : '';

    await sendText(phone,
      `${interpreted.reply}\n\n` +
      `📋 *Confirmar ${tx.type}:*\n` +
      `• ${tx.description}\n` +
      `• ${signal}R$${tx.amount.toFixed(2)}\n` +
      `• ${tx.category} · ${tx.date}` +
      parcelaInfo + methodInfo +
      `\n\n*SIM* pra confirmar ou *NÃO* pra cancelar`
    );
  } else {
    await sendText(phone, interpreted.reply);
  }
}

module.exports = { handleWebhook };
