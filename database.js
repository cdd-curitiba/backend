const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'planejaia.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT UNIQUE,
    plan TEXT DEFAULT 'trial',
    trial_ends_at TEXT,
    pin_hash TEXT,
    pin_attempts INTEGER DEFAULT 0,
    pin_locked_until TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migração segura: adiciona colunas de PIN se o banco já existir de uma versão anterior
const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
if (!userCols.includes('pin_hash'))         db.exec(`ALTER TABLE users ADD COLUMN pin_hash TEXT`);
if (!userCols.includes('pin_attempts'))     db.exec(`ALTER TABLE users ADD COLUMN pin_attempts INTEGER DEFAULT 0`);
if (!userCols.includes('pin_locked_until')) db.exec(`ALTER TABLE users ADD COLUMN pin_locked_until TEXT`);

db.exec(`

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT,
    description TEXT,
    amount REAL,
    category TEXT,
    date TEXT,
    method TEXT DEFAULT 'PIX',
    installment_total INTEGER DEFAULT 1,
    installment_current INTEGER DEFAULT 1,
    installment_group TEXT,
    paid INTEGER DEFAULT 0,
    account_id TEXT,
    card_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    emoji TEXT,
    monthly_limit REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pending_confirmations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    phone TEXT,
    data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    type TEXT DEFAULT 'Conta corrente',
    balance REAL DEFAULT 0,
    emoji TEXT DEFAULT '🏦',
    color TEXT DEFAULT '#6c63ff',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    brand TEXT DEFAULT 'Visa',
    credit_limit REAL DEFAULT 0,
    current_bill REAL DEFAULT 0,
    closing_day INTEGER DEFAULT 1,
    due_day INTEGER DEFAULT 10,
    color TEXT DEFAULT '#6c63ff',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pending_account_selection (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    phone TEXT,
    tx_data TEXT,
    selection_type TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
