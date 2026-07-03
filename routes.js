const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// Todas as rotas aqui já passam pelo middleware requireAuth (montado no
// server.js), então req.userId é sempre o dono legítimo do token — nunca
// aceitamos mais um user_id vindo do cliente, pra ninguém conseguir ler ou
// editar dados de outra pessoa só trocando um parâmetro na URL.

// ─── Transações ──────────────────────────────────────────────
router.get('/transactions', (req, res) => {
  const { month } = req.query;
  let rows;
  if (month) {
    rows = db.prepare(`SELECT * FROM transactions WHERE user_id=? AND date LIKE ? ORDER BY date DESC`).all(req.userId, `${month}%`);
  } else {
    rows = db.prepare(`SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC LIMIT 100`).all(req.userId);
  }
  res.json(rows);
});

router.post('/transactions', (req, res) => {
  const { type, description, amount, category, date, method, account_id, card_id } = req.body;
  const id = uuidv4();
  db.prepare(`INSERT INTO transactions (id, user_id, type, description, amount, category, date, method, account_id, card_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.userId, type, description, amount, category, date, method || 'PIX', account_id || null, card_id || null);
  res.json({ id });
});

router.put('/transactions/:id', (req, res) => {
  const { description, category, method, paid } = req.body;
  db.prepare(`UPDATE transactions SET description=COALESCE(?,description), category=COALESCE(?,category), method=COALESCE(?,method), paid=COALESCE(?,paid) WHERE id=? AND user_id=?`)
    .run(description, category, method, paid, req.params.id, req.userId);
  res.json({ ok: true });
});

router.delete('/transactions/:id', (req, res) => {
  db.prepare(`DELETE FROM transactions WHERE id=? AND user_id=?`).run(req.params.id, req.userId);
  res.json({ ok: true });
});

// ─── Contas bancárias ────────────────────────────────────────
router.get('/accounts', (req, res) => {
  res.json(db.prepare(`SELECT * FROM accounts WHERE user_id=?`).all(req.userId));
});

router.post('/accounts', (req, res) => {
  const { name, type, balance, emoji, color } = req.body;
  const id = uuidv4();
  db.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, emoji, color) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.userId, name, type || 'Conta corrente', balance || 0, emoji || '🏦', color || '#6c63ff');
  res.json({ id });
});

router.put('/accounts/:id', (req, res) => {
  const { name, balance, emoji, color } = req.body;
  db.prepare(`UPDATE accounts SET name=COALESCE(?,name), balance=COALESCE(?,balance), emoji=COALESCE(?,emoji), color=COALESCE(?,color) WHERE id=? AND user_id=?`)
    .run(name, balance, emoji, color, req.params.id, req.userId);
  res.json({ ok: true });
});

router.delete('/accounts/:id', (req, res) => {
  db.prepare(`DELETE FROM accounts WHERE id=? AND user_id=?`).run(req.params.id, req.userId);
  res.json({ ok: true });
});

// ─── Cartões de crédito ──────────────────────────────────────
router.get('/cards', (req, res) => {
  res.json(db.prepare(`SELECT * FROM cards WHERE user_id=?`).all(req.userId));
});

router.post('/cards', (req, res) => {
  const { name, brand, credit_limit, current_bill, closing_day, due_day, color } = req.body;
  const id = uuidv4();
  db.prepare(`INSERT INTO cards (id, user_id, name, brand, credit_limit, current_bill, closing_day, due_day, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.userId, name, brand || 'Visa', credit_limit || 0, current_bill || 0, closing_day || 1, due_day || 10, color || '#6c63ff');
  res.json({ id });
});

router.put('/cards/:id', (req, res) => {
  const { name, credit_limit, current_bill, closing_day, due_day } = req.body;
  db.prepare(`UPDATE cards SET name=COALESCE(?,name), credit_limit=COALESCE(?,credit_limit), current_bill=COALESCE(?,current_bill), closing_day=COALESCE(?,closing_day), due_day=COALESCE(?,due_day) WHERE id=? AND user_id=?`)
    .run(name, credit_limit, current_bill, closing_day, due_day, req.params.id, req.userId);
  res.json({ ok: true });
});

router.delete('/cards/:id', (req, res) => {
  db.prepare(`DELETE FROM cards WHERE id=? AND user_id=?`).run(req.params.id, req.userId);
  res.json({ ok: true });
});

// ─── Categorias ──────────────────────────────────────────────
router.get('/categories', (req, res) => {
  res.json(db.prepare(`SELECT * FROM categories WHERE user_id=?`).all(req.userId));
});

router.post('/categories', (req, res) => {
  const { name, emoji, monthly_limit } = req.body;
  const id = uuidv4();
  db.prepare(`INSERT INTO categories (id, user_id, name, emoji, monthly_limit) VALUES (?, ?, ?, ?, ?)`)
    .run(id, req.userId, name, emoji || '📦', monthly_limit || 0);
  res.json({ id });
});

router.put('/categories/:id', (req, res) => {
  const { name, emoji, monthly_limit } = req.body;
  db.prepare(`UPDATE categories SET name=COALESCE(?,name), emoji=COALESCE(?,emoji), monthly_limit=COALESCE(?,monthly_limit) WHERE id=? AND user_id=?`)
    .run(name, emoji, monthly_limit, req.params.id, req.userId);
  res.json({ ok: true });
});

router.delete('/categories/:id', (req, res) => {
  db.prepare(`DELETE FROM categories WHERE id=? AND user_id=?`).run(req.params.id, req.userId);
  res.json({ ok: true });
});

// ─── Stats ───────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const { month } = req.query;
  const start = month ? `${month}-01` : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const income = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=? AND type='receita' AND date>=?`).get(req.userId, start);
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE user_id=? AND type='despesa' AND date>=?`).get(req.userId, start);
  const topCats = db.prepare(`SELECT category, SUM(amount) as total FROM transactions WHERE user_id=? AND type='despesa' AND date>=? GROUP BY category ORDER BY total DESC LIMIT 5`).all(req.userId, start);
  res.json({ income: income.t, expenses: expenses.t, balance: income.t - expenses.t, top_categories: topCats });
});

module.exports = router;
