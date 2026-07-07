import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "bottle2print.db");

export const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    rfid       TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT 'User',
    studentId  TEXT DEFAULT '',
    credits    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid       TEXT NOT NULL,
    type       TEXT NOT NULL,
    size       TEXT,
    height_mm  REAL,
    weight_g   REAL,
    credits    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid       TEXT,
    context    TEXT NOT NULL,
    rating     INTEGER NOT NULL,
    comment    TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// studentId migration for pre-existing DBs
try {
  db.exec(`ALTER TABLE users ADD COLUMN studentId TEXT DEFAULT '';`);
} catch (e) {
  // Column already exists, ignore
}