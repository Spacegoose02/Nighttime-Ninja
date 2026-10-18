import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Row = Record<string, unknown>;

// Each entry runs once, in order. Never edit a shipped migration; append a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT NOT NULL,
    google_sub TEXT UNIQUE,
    avatar TEXT NOT NULL DEFAULT 'classic',
    theme TEXT NOT NULL DEFAULT 'forest',
    units TEXT NOT NULL DEFAULT 'us',
    is_admin INTEGER NOT NULL DEFAULT 0,
    last_home_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE pair_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE homes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    calendar_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE home_members (
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('manager', 'member')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (home_id, user_id)
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    location TEXT NOT NULL DEFAULT 'Pantry',
    icon TEXT,
    photo TEXT,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT,
    low_threshold REAL,
    barcode TEXT,
    expires_on TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX items_home ON items(home_id);
  CREATE TABLE inventory_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    item_id TEXT,
    item_name TEXT NOT NULL,
    delta REAL NOT NULL,
    unit TEXT,
    quantity_after REAL,
    reason TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX inventory_history_home ON inventory_history(home_id, created_at);
  CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    servings INTEGER,
    prep_minutes INTEGER,
    cook_minutes INTEGER,
    source_url TEXT,
    image TEXT,
    instructions TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    is_public INTEGER NOT NULL DEFAULT 0,
    share_slug TEXT UNIQUE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX recipes_home ON recipes(home_id);
  CREATE TABLE recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    note TEXT,
    optional INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
  CREATE TABLE shopping_items (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    category TEXT NOT NULL DEFAULT 'Other',
    note TEXT,
    checked INTEGER NOT NULL DEFAULT 0,
    added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    checked_at TEXT
  );
  CREATE INDEX shopping_home ON shopping_items(home_id, checked);
  CREATE TABLE shopping_history (
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name_key TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    times_bought INTEGER NOT NULL DEFAULT 0,
    last_bought_at TEXT,
    PRIMARY KEY (home_id, name_key)
  );
  CREATE TABLE meal_plan (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    slot TEXT NOT NULL DEFAULT 'dinner',
    recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
    title TEXT,
    note TEXT,
    cooked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX meal_plan_home ON meal_plan(home_id, date);
  CREATE TABLE feeds (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE home_settings (
    home_id TEXT PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,
    zip_code TEXT,
    stores TEXT NOT NULL DEFAULT '["walmart","foodlion","kroger","bjs","samsclub"]',
    kroger_location_id TEXT
  );
  `,
  // Stronger sign-in: passwords, two-factor codes, passkeys, session management, server settings.
  `
  ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE;
  ALTER TABLE users ADD COLUMN password_hash TEXT;
  ALTER TABLE users ADD COLUMN totp_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
  ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX users_username ON users(username);
  ALTER TABLE sessions ADD COLUMN user_agent TEXT;
  ALTER TABLE sessions ADD COLUMN ip TEXT;
  ALTER TABLE sessions ADD COLUMN method TEXT;
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  CREATE TABLE recovery_codes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    PRIMARY KEY (user_id, code_hash)
  );
  CREATE TABLE mfa_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX passkeys_user ON passkeys(user_id);
  CREATE TABLE webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    user_id TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE server_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Hand-picked matches between recipe ingredients and pantry items.
  `
  CREATE TABLE ingredient_links (
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    ingredient_key TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (home_id, ingredient_key)
  );
  `,
];

export function openDb(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'nighttime-ninja.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function openMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Runs fn inside a transaction. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
