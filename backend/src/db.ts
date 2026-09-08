import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "bottle2print.db");

export const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    rfid              TEXT PRIMARY KEY,
    surname           TEXT NOT NULL DEFAULT '',
    firstname         TEXT NOT NULL DEFAULT '',
    middlename        TEXT DEFAULT '',
    studentId         TEXT DEFAULT '',
    credits           INTEGER NOT NULL DEFAULT 0,
    pin_hash          TEXT,
    pin_fail_count    INTEGER NOT NULL DEFAULT 0,
    pin_locked_until  TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid          TEXT NOT NULL,
    type          TEXT NOT NULL,
    size          TEXT,
    height_mm     REAL,
    weight_g      REAL,
    co2_saved_g   REAL DEFAULT 0,
    credits       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid       TEXT,
    context    TEXT NOT NULL,
    rating     INTEGER NOT NULL,
    comment    TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Safe migrations for pre-existing databases to support 3 name columns
try {
  db.exec(`ALTER TABLE users ADD COLUMN surname TEXT DEFAULT '';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN firstname TEXT DEFAULT '';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN middlename TEXT DEFAULT '';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN studentId TEXT DEFAULT '';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE transactions ADD COLUMN co2_saved_g REAL DEFAULT 0;`);
} catch (e) {}

// ── PIN support migration ───────────────────────────────────────────────────
try {
  db.exec(`ALTER TABLE users ADD COLUMN pin_hash TEXT;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN pin_fail_count INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN pin_locked_until TEXT;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN pin_needs_reset INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

// ── Admin email migration ───────────────────────────────────────────────────
try {
  db.exec(`ALTER TABLE admins ADD COLUMN email TEXT DEFAULT '';`);
} catch (e) {}