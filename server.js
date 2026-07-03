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

// Dashboard estático (opcional — se a pasta dashboard/public não existir
// aqui, sem problema, o painel pode estar hospedado em outro lugar como
// GitHub Pages; esse backend só precisa responder a API e o webhook)
const fs = require('fs');
const dashboardPath = path.join(__dirname, '../dashboard/public');
const dashboardIndex = path.join(dashboardPath, 'index.html');
if (fs.existsSync(dashboardPath)) {
  app.use(express.static(dashboardPath));
}
app.use((req, res) => {
  if (fs.existsSync(dashboardIndex)) {
    res.sendFile(dashboardIndex);
  } else {
    res.status(200).send('PlanejaIA backend rodando. O painel é servido separadamente.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FinZap rodando na porta ${PORT}`));
