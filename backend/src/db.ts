import Database from "better-sqlite3";
import path from "path";
import { addDaysToIsoDate, RFID_CREDIT_VALIDITY_DAYS } from "./rfidCredits";
import { getCardValidityDays } from "./cardExpiry";

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
    card_status       TEXT NOT NULL DEFAULT 'active' CHECK (card_status IN ('active', 'expired', 'flagged')),
    expires_at        TEXT,
    flagged_reason    TEXT CHECK (flagged_reason IN ('auto_expired', 'admin_flagged') OR flagged_reason IS NULL),
    flagged_at        TEXT,
    reactivated_at    TEXT,
    reactivation_count INTEGER NOT NULL DEFAULT 0,
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
    ('bin_max_bottles_small', '75'),
    ('rfid_credit_expiration_date', ''),
    ('rfid_credit_expiry_policy_version', ''),
    ('card_validity_days', '180'),
    ('card_expiry_migration_version', ''),
    ('credits_per_peso', '10'),
    ('reward_new_badge_days', '7'),
    ('reward_pricing_migration_version', '');
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

try { db.exec(`ALTER TABLE users ADD COLUMN card_status TEXT NOT NULL DEFAULT 'active';`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN expires_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN flagged_reason TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN flagged_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN reactivated_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN reactivation_count INTEGER NOT NULL DEFAULT 0;`); } catch (e) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN pin_needs_reset INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

// ── Admin email migration ───────────────────────────────────────────────────
try {
  db.exec(`ALTER TABLE admins ADD COLUMN email TEXT DEFAULT '';`);
} catch (e) {}

db.exec("CREATE INDEX IF NOT EXISTS idx_users_card_status_expiry ON users(card_status, expires_at);");
const cardExpiryMigration = db.prepare(
  "SELECT value FROM system_config WHERE key = 'card_expiry_migration_version'",
).get() as { value: string } | undefined;
if (cardExpiryMigration?.value !== "card-expiry-v1") {
  const validityDays = getCardValidityDays(db);
  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET expires_at = datetime(created_at, '+' || ? || ' days')
      WHERE expires_at IS NULL
    `).run(validityDays);
    db.prepare("UPDATE system_config SET value = 'card-expiry-v1' WHERE key = 'card_expiry_migration_version'").run();
  })();
}

// ── Transaction rejection stage & reason migration ─────────────────────────
try { db.exec(`ALTER TABLE transactions ADD COLUMN reject_stage TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE transactions ADD COLUMN reject_reason TEXT;`); } catch (e) {}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_bin_history_created_at ON bin_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_print_logs_created_at ON print_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_guest_print_logs_created_at ON guest_print_logs(created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rfid_credit_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid TEXT NOT NULL,
    initial_credits INTEGER NOT NULL CHECK (initial_credits > 0),
    remaining_credits INTEGER NOT NULL CHECK (remaining_credits >= 0),
    expires_on TEXT,
    source_type TEXT NOT NULL,
    source_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (rfid) REFERENCES users(rfid)
  );
  CREATE INDEX IF NOT EXISTS idx_rfid_credit_lots_user_expiry
    ON rfid_credit_lots(rfid, expires_on, remaining_credits);

  CREATE TABLE IF NOT EXISTS rfid_credit_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid TEXT NOT NULL,
    lot_id INTEGER NOT NULL,
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    credits INTEGER NOT NULL CHECK (credits > 0),
    status TEXT NOT NULL CHECK (status IN ('spent', 'reserved', 'restored', 'committed', 'expired')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lot_id) REFERENCES rfid_credit_lots(id)
  );
  CREATE INDEX IF NOT EXISTS idx_rfid_credit_allocations_reference
    ON rfid_credit_allocations(reference_type, reference_id, status);

  CREATE TABLE IF NOT EXISTS reward_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    regular_price REAL,
    discounted_price REAL,
    image TEXT,
    price_php REAL NOT NULL DEFAULT 0,
    listed_at TEXT,
    credit_cost INTEGER NOT NULL CHECK (credit_cost > 0),
    quantity_available INTEGER,
    max_per_user INTEGER NOT NULL DEFAULT 1 CHECK (max_per_user > 0),
    starts_on TEXT,
    ends_on TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reward_offers_status_dates
    ON reward_offers(status, starts_on, ends_on);

  CREATE TABLE IF NOT EXISTS reward_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid TEXT NOT NULL,
    offer_id INTEGER,
    offer_title TEXT NOT NULL,
    credit_cost INTEGER NOT NULL CHECK (credit_cost > 0),
    regular_price REAL,
    discounted_price REAL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'ready', 'fulfilled', 'declined', 'cancelled')),
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_by TEXT,
    resolution_note TEXT,
    FOREIGN KEY (rfid) REFERENCES users(rfid),
    FOREIGN KEY (offer_id) REFERENCES reward_offers(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reward_requests_user_date ON reward_requests(rfid, requested_at);
  CREATE INDEX IF NOT EXISTS idx_reward_requests_status_date ON reward_requests(status, requested_at);
`);

try { db.exec("ALTER TABLE reward_offers ADD COLUMN regular_price REAL;"); } catch (e) {}
try { db.exec("ALTER TABLE reward_requests ADD COLUMN regular_price REAL;"); } catch (e) {}
try { db.exec("ALTER TABLE reward_offers ADD COLUMN price_php REAL NOT NULL DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE reward_offers ADD COLUMN image TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE reward_offers ADD COLUMN listed_at TEXT;"); } catch (e) {}
try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_reward_offers_price_required_insert
    BEFORE INSERT ON reward_offers
    WHEN NEW.price_php IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'price_php is required');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_reward_offers_price_required_update
    BEFORE UPDATE OF price_php ON reward_offers
    WHEN NEW.price_php IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'price_php is required');
    END;
  `);
} catch (e) {}
db.exec(`
  UPDATE reward_offers SET regular_price = discounted_price WHERE regular_price IS NULL;
  UPDATE reward_requests SET regular_price = discounted_price WHERE regular_price IS NULL;
  UPDATE reward_offers SET listed_at = created_at WHERE status = 'active' AND listed_at IS NULL;
`);
const rewardPricingMigration = db.prepare(
  "SELECT value FROM system_config WHERE key = 'reward_pricing_migration_version'",
).get() as { value: string } | undefined;
if (rewardPricingMigration?.value !== "peso-rewards-v1") {
  db.transaction(() => {
    db.prepare(`
      UPDATE reward_offers
      SET price_php = ROUND(
        credit_cost / CAST((SELECT value FROM system_config WHERE key = 'credits_per_peso') AS REAL),
        2
      )
      WHERE price_php IS NULL OR price_php = 0
    `).run();
    db.prepare("UPDATE system_config SET value = 'peso-rewards-v1' WHERE key = 'reward_pricing_migration_version'").run();
  })();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reward_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    reward_id INTEGER,
    user_id TEXT NOT NULL,
    rfid TEXT NOT NULL,
    reward_title TEXT NOT NULL,
    price_php REAL NOT NULL,
    credits_applied INTEGER NOT NULL CHECK (credits_applied >= 0),
    discount_php REAL NOT NULL,
    amount_due_php REAL NOT NULL,
    credits_per_peso_used REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'ready', 'fulfilled', 'declined')),
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_by TEXT,
    resolution_note TEXT,
    FOREIGN KEY (rfid) REFERENCES users(rfid),
    FOREIGN KEY (reward_id) REFERENCES reward_offers(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user_date ON reward_redemptions(rfid, requested_at);
  CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status_date ON reward_redemptions(status, requested_at);
`);
try { db.exec("ALTER TABLE reward_redemptions ADD COLUMN user_id TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE reward_redemptions ADD COLUMN timestamp TEXT;"); } catch (e) {}
db.exec(`
  UPDATE reward_redemptions SET user_id = rfid WHERE user_id IS NULL;
  UPDATE reward_redemptions SET timestamp = requested_at WHERE timestamp IS NULL;
`);

// Existing RFID balances have no individual earning dates. Preserve the current
// balance as one lot before applying its one-time registration-based expiry.
db.exec(`
  INSERT INTO rfid_credit_lots (rfid, initial_credits, remaining_credits, source_type, source_key)
  SELECT users.rfid, users.credits, users.credits, 'launch_balance', 'launch:' || users.rfid
  FROM users
  WHERE users.credits > 0
    AND NOT EXISTS (
      SELECT 1 FROM rfid_credit_lots WHERE source_key = 'launch:' || users.rfid
    );
`);
const expiryPolicy = db.prepare("SELECT value FROM system_config WHERE key = 'rfid_credit_expiry_policy_version'").get() as { value: string } | undefined;
if (expiryPolicy?.value !== "earned-180-days-v1") {
  const existingLots = db.prepare(`
    SELECT lot.id, lot.source_type AS sourceType,
           date(lot.created_at, '+8 hours') AS grantedDate,
           date(users.created_at, '+8 hours') AS registeredDate
    FROM rfid_credit_lots lot
    JOIN users ON users.rfid = lot.rfid
  `).all() as Array<{ id: number; sourceType: string; grantedDate: string; registeredDate: string }>;
  const applyLegacyExpiry = db.prepare("UPDATE rfid_credit_lots SET expires_on = ? WHERE id = ?");
  db.transaction(() => {
    for (const lot of existingLots) {
      const earnedDate = lot.sourceType === "launch_balance" ? lot.registeredDate : lot.grantedDate;
      if (earnedDate) applyLegacyExpiry.run(addDaysToIsoDate(earnedDate, RFID_CREDIT_VALIDITY_DAYS), lot.id);
    }
    db.prepare("UPDATE system_config SET value = 'earned-180-days-v1' WHERE key = 'rfid_credit_expiry_policy_version'").run();
  })();
}

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