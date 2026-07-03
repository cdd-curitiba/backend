require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { handleWebhook } = require('./webhook');
const routes = require('./routes');
const { checkPhone, setPin, login, requireAuth, normalizePhone } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Webhook Evolution API
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    await handleWebhook(req.body);
  } catch (e) {
    console.error('Erro no webhook:', e.message);
  }
});

// ─── Autenticação (público — sem middleware) ──────────────────
app.post('/api/auth/check-phone', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  res.json(checkPhone(phone));
});

app.post('/api/auth/set-pin', (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'phone e pin obrigatórios' });
  const result = setPin(normalizePhone(phone), pin);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'phone e pin obrigatórios' });
  const result = login(normalizePhone(phone), pin);
  if (result.error) return res.status(401).json(result);
  res.json(result);
});

// API REST (protegida — precisa de token)
app.use('/api', requireAuth, routes);

// Dashboard estático
app.use(express.static(path.join(__dirname, '../dashboard/public')));
// Fallback pra qualquer rota não encontrada (SPA) — usa middleware em vez de
// padrão de rota '*', que quebrou em versões mais novas do path-to-regexp
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FinZap rodando na porta ${PORT}`));
