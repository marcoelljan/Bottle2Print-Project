const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const {
  createCardExpiryDate,
  expireCardIfOverdue,
  expireOverdueCards,
  getCardValidityDays,
  isCardExpiryDue,
} = require("../dist/cardExpiry.js");

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE users (
      rfid TEXT PRIMARY KEY, card_status TEXT NOT NULL, expires_at TEXT,
      flagged_reason TEXT, flagged_at TEXT, reactivated_at TEXT,
      reactivation_count INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rfid TEXT, type TEXT, size TEXT,
      credits INTEGER, created_at TEXT
    );
    CREATE TABLE rfid_credit_lots (rfid TEXT, remaining_credits INTEGER);
    CREATE TABLE rfid_credit_allocations (rfid TEXT, status TEXT);
  `);
  return db;
}

test("card validity uses the configured value and defaults safely", () => {
  const db = createDb();
  assert.equal(getCardValidityDays(db), 180);
  db.prepare("INSERT INTO system_config (key, value) VALUES ('card_validity_days', '90')").run();
  assert.equal(getCardValidityDays(db), 90);
  assert.equal(createCardExpiryDate(new Date("2026-01-01T00:00:00.000Z"), 90), "2026-04-01 00:00:00");
  db.close();
});

test("expiry only applies when due", () => {
  assert.equal(isCardExpiryDue("2026-01-02 00:00:00", new Date("2026-01-01T23:59:59Z")), false);
  assert.equal(isCardExpiryDue("2026-01-02 00:00:00", new Date("2026-01-02T00:00:00Z")), true);
  assert.equal(isCardExpiryDue(null, new Date()), false);
});

test("overdue card is wiped, audited, and processed idempotently", () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO users (rfid, card_status, expires_at, credits)
    VALUES ('card-1', 'active', '2026-01-01 00:00:00', 7)
  `).run();
  db.prepare("INSERT INTO rfid_credit_lots (rfid, remaining_credits) VALUES ('card-1', 7)").run();
  db.prepare("INSERT INTO rfid_credit_allocations (rfid, status) VALUES ('card-1', 'reserved')").run();

  const first = expireCardIfOverdue(db, "card-1", new Date("2026-01-02T00:00:00Z"));
  const second = expireOverdueCards(db, new Date("2026-01-03T00:00:00Z"));

  assert.equal(first.status, "expired");
  assert.equal(second.length, 0);
  assert.deepEqual(db.prepare("SELECT card_status, credits FROM users WHERE rfid = 'card-1'").get(), {
    card_status: "expired",
    credits: 0,
  });
  assert.equal(db.prepare("SELECT remaining_credits FROM rfid_credit_lots WHERE rfid = 'card-1'").get().remaining_credits, 0);
  assert.equal(db.prepare("SELECT status FROM rfid_credit_allocations WHERE rfid = 'card-1'").get().status, "expired");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE type = 'expiry'").get().count, 1);
  assert.equal(db.prepare("SELECT credits FROM transactions WHERE type = 'expiry'").get().credits, -7);
  db.close();
});
