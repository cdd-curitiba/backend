const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRES_IN = '30d';
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Normaliza telefone: mantém só dígitos. Se vier sem código de país (10 ou 11
// dígitos, formato brasileiro comum), assume Brasil e prefixa 55 — assim bate
// com o formato que a Evolution API já grava (ex: 5511999999999).
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function findUserByPhone(phone) {
  return db.prepare(`SELECT * FROM users WHERE phone=?`).get(normalizePhone(phone));
}

// GET /api/auth/check-phone — o painel usa isso pra saber se deve pedir
// "criar PIN" (primeira vez) ou "digitar PIN" (usuário já configurou antes).
function checkPhone(phone) {
  const user = findUserByPhone(phone);
  if (!user) return { exists: false, has_pin: false };
  return { exists: true, has_pin: !!user.pin_hash, name: user.name };
}

// POST /api/auth/set-pin — só permite definir PIN se:
//  1. o número já existe (ou seja, a pessoa já mandou mensagem no WhatsApp
//     e tem uma conta criada automaticamente pelo webhook), e
//  2. ainda não tem PIN configurado (não é pra sobrescrever sem senha antiga —
//     troca de PIN é um fluxo separado, com verificação do PIN atual).
function setPin(phone, pin) {
  if (!/^\d{4,6}$/.test(String(pin || ''))) {
    return { error: 'PIN deve ter entre 4 e 6 números' };
  }
  const user = findUserByPhone(phone);
  if (!user) {
    return { error: 'Esse número ainda não tem conta. Manda uma mensagem pro WhatsApp do PlanejaIA primeiro pra criar sua conta, depois volta aqui pra configurar o acesso ao painel.' };
  }
  if (user.pin_hash) {
    return { error: 'Esse número já tem um PIN configurado. Use "Esqueceu seu PIN?" pra trocar.' };
  }
  const hash = bcrypt.hashSync(String(pin), 10);
  db.prepare(`UPDATE users SET pin_hash=?, pin_attempts=0, pin_locked_until=NULL WHERE id=?`).run(hash, user.id);
  const token = jwt.sign({ uid: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
  return { token, user: { id: user.id, name: user.name, phone: user.phone } };
}

// POST /api/auth/login — confere PIN com trava progressiva contra força bruta.
function login(phone, pin) {
  const user = findUserByPhone(phone);
  if (!user || !user.pin_hash) {
    return { error: 'Número ou PIN inválido' };
  }

  if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.pin_locked_until) - new Date()) / 60000);
    return { error: `Muitas tentativas erradas. Tenta de novo em ${mins} minuto(s).` };
  }

  const ok = bcrypt.compareSync(String(pin || ''), user.pin_hash);
  if (!ok) {
    const attempts = (user.pin_attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
      db.prepare(`UPDATE users SET pin_attempts=0, pin_locked_until=? WHERE id=?`).run(lockUntil, user.id);
      return { error: `Muitas tentativas erradas. Conta travada por ${LOCK_MINUTES} minutos.` };
    }
    db.prepare(`UPDATE users SET pin_attempts=? WHERE id=?`).run(attempts, user.id);
    return { error: 'Número ou PIN inválido', attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  db.prepare(`UPDATE users SET pin_attempts=0, pin_locked_until=NULL WHERE id=?`).run(user.id);
  const token = jwt.sign({ uid: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
  return { token, user: { id: user.id, name: user.name, phone: user.phone, plan: user.plan } };
}

// Middleware — protege as rotas /api/* exigindo um token válido, e injeta
// req.userId a partir do token (nunca confia em user_id vindo do cliente).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada, faça login novamente' });
  }
}

module.exports = { normalizePhone, checkPhone, setPin, login, requireAuth };
