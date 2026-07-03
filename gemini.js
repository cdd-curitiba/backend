const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PERSONALITY = `
Você é o Plano, assistente financeiro do PlanejaIA. Sua personalidade:
- Inteligente, direto e levemente bem-humorado — como um amigo que entende de finanças
- Registra gastos e receitas sem enrolação, mas sempre adiciona um comentário curto e humano quando faz sentido
- Responde dúvidas financeiras de forma simples, sem parecer um banco
- Nunca julga de verdade — só zoa com carinho em situações óbvias (madrugada, impulso, fast food de novo)
- Nunca usa bullet points ou formatação markdown — fala como gente, em texto corrido
- Máximo 3 linhas por resposta. Seja cirúrgico.

Exemplos de tom:
- Gasto de madrugada: "Anotado! 🌙 Madrugada produtiva essa, hein. Registrado em Alimentação."
- Gasto repetido na mesma categoria: "De novo o mercado 😅 Já são R$X esse mês nessa categoria. Registrado!"
- Receita: "Dinheiro entrando, ótimo! 💸 Salário registrado. Saldo ficou bem melhor agora."
- Dúvida sobre finanças: responde direto, de forma prática, como um amigo que estudou o assunto
- Não entendeu: "Não peguei bem o que você quis dizer. Pode repetir? Se for um gasto ou receita, manda o valor e o que foi 😊"
`;

async function interpretMessage(text, userCategories = [], userStats = null, userAccounts = [], userCards = []) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const categoryList = userCategories.length > 0
    ? `Categorias disponíveis: ${userCategories.join(', ')}.`
    : 'Categorias comuns: Alimentação, Moradia, Transporte, Saúde, Lazer, Educação, Outros.';

  const statsContext = userStats
    ? `Contexto do usuário este mês: entradas R$${userStats.income.toFixed(0)}, saídas R$${userStats.expenses.toFixed(0)}, saldo R$${userStats.balance.toFixed(0)}. Top categorias de gasto: ${userStats.topCategories}.`
    : '';

  const accountsContext = userAccounts.length > 0
    ? `Contas bancárias do usuário: ${userAccounts.map(a => `${a.name} (saldo R$${a.balance.toFixed(2)})`).join(', ')}.`
    : '';

  const cardsContext = userCards.length > 0
    ? `Cartões de crédito do usuário: ${userCards.map(c => `${c.name} (limite R$${c.credit_limit.toFixed(2)}, fatura atual R$${c.current_bill.toFixed(2)})`).join(', ')}.`
    : '';

  const hora = new Date().getHours();
  const periodoStr = hora >= 0 && hora < 6 ? 'madrugada' : hora < 12 ? 'manhã' : hora < 18 ? 'tarde' : 'noite';

  const prompt = `
${PERSONALITY}

${categoryList}
${statsContext}
${accountsContext}
${cardsContext}
Horário atual: ${periodoStr} (${hora}h).

Mensagem do usuário: "${text}"

Analise a mensagem e responda com um JSON válido, sem markdown, sem explicações:

Se for um registro financeiro (gasto, receita, compra, pagamento, transferência):
{
  "type": "transaction",
  "data": {
    "type": "receita" ou "despesa",
    "description": "descrição curta",
    "amount": valor numérico,
    "category": "categoria adequada",
    "date": "YYYY-MM-DD (hoje se não mencionado: ${new Date().toISOString().split('T')[0]})",
    "method": "Débito", "Crédito", "PIX" ou "Dinheiro" (inferir da mensagem),
    "installment_total": 1 (ou N se parcelado),
    "installment_current": 1,
    "needs_account": true se método for Débito ou Crédito E não ficou claro qual conta/cartão (pedir confirmação), false caso contrário
  },
  "reply": "resposta curta com personalidade, confirmando o registro"
}

Se for uma pergunta ou conversa:
{
  "type": "chat",
  "reply": "resposta conversativa e útil"
}

Se não entendeu:
{
  "type": "unclear",
  "reply": "peça esclarecimento de forma simpática"
}
`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      type: 'chat',
      reply: 'Não entendi bem. Pode me contar de novo? Se for um gasto ou receita, manda o valor e do que se trata 😊'
    };
  }
}

async function generateReport(userStats) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const prompt = `
${PERSONALITY}

O usuário pediu um relatório financeiro. Dados do mês:
- Entradas: R$${userStats.income.toFixed(2)}
- Saídas: R$${userStats.expenses.toFixed(2)}
- Saldo: R$${userStats.balance.toFixed(2)}
- Transações: ${userStats.count}
- Top gastos: ${userStats.topCategories}

Gere um resumo financeiro curto (máximo 5 linhas), com personalidade, destacando pontos importantes e uma dica prática. Sem bullet points, texto corrido.
`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

module.exports = { interpretMessage, generateReport };
