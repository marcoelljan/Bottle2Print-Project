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
  CREATE TABLE IF NOT EXISTS bin_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    distance_cm  REAL NOT NULL,
    fill_percent INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS system_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS print_logs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id           TEXT UNIQUE,
    legacy_transaction_id INTEGER UNIQUE,
    rfid                 TEXT NOT NULL,
    status               TEXT NOT NULL,
    pages                INTEGER NOT NULL,
    color_mode           TEXT NOT NULL DEFAULT 'bw',
    credits_charged      INTEGER NOT NULL DEFAULT 0,
    coverage_factor      REAL NOT NULL DEFAULT 1.0,
    job_id               TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at         TEXT,
    refunded_at          TEXT
  );
  CREATE TABLE IF NOT EXISTS guest_print_logs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id           TEXT UNIQUE,
    legacy_transaction_id INTEGER UNIQUE,
    rfid                 TEXT NOT NULL DEFAULT 'GUEST',
    status               TEXT NOT NULL,
    pages                INTEGER NOT NULL,
    color_mode           TEXT NOT NULL DEFAULT 'bw',
    credits_charged      INTEGER NOT NULL DEFAULT 0,
    coverage_factor      REAL NOT NULL DEFAULT 1.0,
    job_id               TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at         TEXT,
    refunded_at          TEXT
  );
  INSERT OR IGNORE INTO system_config (key, value) VALUES
    ('ink_cost_bw_per_page', '0.37'),
    ('ink_cost_color_per_page', '0.74'),
    ('resale_price_per_kg', '6'),
    ('bottle_weight_g_1_5l', '49.09'),
    ('bottle_weight_g_small', '17.33'),
    ('bin_max_bottles_1_5l', '55'),
    ('bin_max_bottles_small', '75');
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
// ── Transaction rejection stage & reason migration ─────────────────────────
try { db.exec(`ALTER TABLE transactions ADD COLUMN reject_stage TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE transactions ADD COLUMN reject_reason TEXT;`); } catch (e) {}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_bin_history_created_at ON bin_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_print_logs_created_at ON print_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_guest_print_logs_created_at ON guest_print_logs(created_at);
`);

// Import historical print transactions once; legacy print records have no job ID
// and are treated as B&W unless the transaction description says color.
db.exec(`
  INSERT OR IGNORE INTO print_logs (
    legacy_transaction_id, rfid, status, pages, color_mode, credits_charged, created_at, completed_at
  )
  SELECT
    id,
    rfid,
    'completed',
    CASE
      WHEN instr(COALESCE(size, ''), ' page(s)') > 0
        THEN MAX(1, CAST(substr(size, 1, instr(size, ' page(s)') - 1) AS INTEGER))
      ELSE 1
    END,
    CASE WHEN lower(COALESCE(size, '')) LIKE '%color%' THEN 'color' ELSE 'bw' END,
    ABS(COALESCE(credits, 0)),
    created_at,
    created_at
  FROM transactions
  WHERE type = 'print' AND rfid != 'GUEST';

  INSERT OR IGNORE INTO guest_print_logs (
    legacy_transaction_id, rfid, status, pages, color_mode, credits_charged, created_at, completed_at
  )
  SELECT
    id,
    'GUEST',
    'completed',
    CASE
      WHEN instr(COALESCE(size, ''), ' page(s)') > 0
        THEN MAX(1, CAST(substr(size, 1, instr(size, ' page(s)') - 1) AS INTEGER))
      ELSE 1
    END,
    CASE WHEN lower(COALESCE(size, '')) LIKE '%color%' THEN 'color' ELSE 'bw' END,
    ABS(COALESCE(credits, 0)),
    created_at,
    created_at
  FROM transactions
  WHERE type = 'print' AND rfid = 'GUEST';
`);

// Pair legacy refund adjustments with print charges by user and credit amount,
// one-for-one in chronological order, without consuming unrelated adjustments.
db.exec(`
  WITH print_rows AS (
    SELECT id, rfid, ABS(COALESCE(credits, 0)) AS amount,
           ROW_NUMBER() OVER (PARTITION BY rfid, ABS(COALESCE(credits, 0)) ORDER BY created_at, id) AS rn
    FROM transactions
    WHERE type = 'print'
  ),
  refund_rows AS (
    SELECT id, rfid, ABS(COALESCE(credits, 0)) AS amount, created_at,
           ROW_NUMBER() OVER (PARTITION BY rfid, ABS(COALESCE(credits, 0)) ORDER BY created_at, id) AS rn
    FROM transactions
    WHERE type = 'adjust' AND size LIKE 'Print refunded%'
  )
  UPDATE print_logs
  SET status = 'refunded',
      refunded_at = (
        SELECT r.created_at
        FROM print_rows p JOIN refund_rows r ON r.rfid = p.rfid AND r.amount = p.amount AND r.rn = p.rn
        WHERE p.id = print_logs.legacy_transaction_id AND r.created_at >= print_logs.created_at
      )
  WHERE legacy_transaction_id IN (
    SELECT p.id
    FROM print_rows p JOIN refund_rows r ON r.rfid = p.rfid AND r.amount = p.amount AND r.rn = p.rn
    WHERE p.rfid != 'GUEST' AND r.created_at >= print_logs.created_at
  );

  WITH print_rows AS (
    SELECT id, rfid, ABS(COALESCE(credits, 0)) AS amount,
           ROW_NUMBER() OVER (PARTITION BY rfid, ABS(COALESCE(credits, 0)) ORDER BY created_at, id) AS rn
    FROM transactions
    WHERE type = 'print'
  ),
  refund_rows AS (
    SELECT id, rfid, ABS(COALESCE(credits, 0)) AS amount, created_at,
           ROW_NUMBER() OVER (PARTITION BY rfid, ABS(COALESCE(credits, 0)) ORDER BY created_at, id) AS rn
    FROM transactions
    WHERE type = 'adjust' AND size LIKE 'Print refunded%'
  )
  UPDATE guest_print_logs
  SET status = 'refunded',
      refunded_at = (
        SELECT r.created_at
        FROM print_rows p JOIN refund_rows r ON r.rfid = p.rfid AND r.amount = p.amount AND r.rn = p.rn
        WHERE p.id = guest_print_logs.legacy_transaction_id AND r.created_at >= guest_print_logs.created_at
      )
  WHERE legacy_transaction_id IN (
    SELECT p.id
    FROM print_rows p JOIN refund_rows r ON r.rfid = p.rfid AND r.amount = p.amount AND r.rn = p.rn
    WHERE p.rfid = 'GUEST' AND r.created_at >= guest_print_logs.created_at
  );
`);