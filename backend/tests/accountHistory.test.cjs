const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const Database = require("better-sqlite3");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { anonymizeRfidHistory } = require("../dist/accountHistory.js");
const { anonymizeExistingRfidHistory } = require("../dist/accountHistory.js");
const { anonymizeOrphanedRecords } = require("../dist/scripts/anonymizeOrphanedRecords.js");

const databases = [];

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE users (
      rfid TEXT PRIMARY KEY, surname TEXT, firstname TEXT, middlename TEXT,
      studentId TEXT, credits INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, rfid TEXT NOT NULL, type TEXT NOT NULL, size TEXT,
      weight_g REAL, co2_saved_g REAL, credits INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reject_reason TEXT
    );
    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY, rfid TEXT, context TEXT, rating INTEGER,
      comment TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY, admin_user TEXT, action TEXT, details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function createDb() {
  const db = new Database(":memory:");
  initializeSchema(db);
  databases.push(db);
  return db;
}

function totals(db) {
  return db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS bottles,
      SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) AS prints,
      SUM(CASE WHEN type = 'deposit' THEN COALESCE(weight_g, 0) ELSE 0 END) AS weight,
      SUM(CASE WHEN type = 'deposit' THEN COALESCE(co2_saved_g, 0) ELSE 0 END) AS co2,
      SUM(CASE WHEN type = 'print' THEN ABS(COALESCE(credits, 0)) ELSE 0 END) AS creditsUsed
    FROM transactions
  `).get();
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

test("deletion and same-RFID registration start with zero linked history", () => {
  const db = createDb();
  const rfid = "04A1B2C3";
  const identity = {
    rfid, surname: "Example", firstname: "Test", middlename: "", studentId: "STU-101",
  };
  db.prepare("INSERT INTO users (rfid, surname, firstname, studentId, credits) VALUES (?, ?, ?, ?, 9)")
    .run(rfid, identity.surname, identity.firstname, identity.studentId);
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, credits) VALUES (?, 'register', ?, 0, 0)")
    .run(rfid, "Registered: Example, Test (STU-101)");
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits) VALUES (?, 'deposit', 'Small', 14, 42, 3)")
    .run(rfid);
  db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'print', '2 page(s), bw', -6)")
    .run(rfid);
  db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'adjust', 'Admin reason: Test Example', 2)")
    .run(rfid);
  db.prepare("INSERT INTO feedback (rfid, context, rating, comment) VALUES (?, 'print', 5, 'Test Example STU-101')")
    .run(rfid);
  db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES ('admin', 'EDIT_USER', ?)")
    .run(`Updated user RFID ${rfid} (Test Example STU-101)`);

  const before = totals(db);
  let token;
  db.transaction(() => {
    token = anonymizeRfidHistory(db, identity);
    db.prepare("DELETE FROM users WHERE rfid = ?").run(rfid);
  })();

  assert.match(token, /^deleted_[0-9a-f-]{36}$/);
  assert.deepEqual(totals(db), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = ?").get(rfid).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE rfid = ?").get(rfid).n, 0);
  assert.equal(db.prepare("SELECT size FROM transactions WHERE type = 'register' AND rfid = ?").get(token).size, "Deleted user");
  assert.equal(db.prepare("SELECT size FROM transactions WHERE type = 'print' AND rfid = ?").get(token).size, "2 page(s), bw");
  assert.equal(db.prepare("SELECT comment FROM feedback WHERE rfid = ?").get(token).comment, null);
  assert.equal(db.prepare("SELECT details FROM activity_logs").get().details, "Deleted user activity (anonymized)");
  assert.equal(db.prepare("SELECT size FROM transactions WHERE type = 'adjust' AND rfid = ?").get(token).size, "Credit adjustment");

  db.prepare("INSERT INTO users (rfid, surname, firstname, studentId) VALUES (?, 'Example', 'Test', 'STU-101')")
    .run(rfid);
  db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'register', 'New registration', 0)")
    .run(rfid);
  const linkedHistory = db.prepare(`
    SELECT t.* FROM transactions t JOIN users u ON u.rfid = t.rfid
    WHERE u.rfid = ? AND t.type != 'register'
  `).all(rfid);
  assert.equal(db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid).credits, 0);
  assert.deepEqual(linkedHistory, []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = ?").get(token).n, 4);
  assert.deepEqual(totals(db), before);
});

test("orphan cleanup preserves active and guest rows and is repeat-safe", () => {
  const db = createDb();
  db.prepare("INSERT INTO users (rfid, surname, firstname) VALUES ('ACTIVE', 'A', 'User')").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g) VALUES ('ORPHAN', 'register', 'Old Name and ID', 0)").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g) VALUES ('ORPHAN', 'deposit', 'Large', 25, 75)").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g) VALUES ('ACTIVE', 'deposit', 'Small', 10, 30)").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g) VALUES ('GUEST', 'deposit', 'Small', 8, 24)").run();
  db.prepare("INSERT INTO feedback (rfid, context, rating, comment) VALUES ('ORPHAN', 'deposit', 4, 'Personal note')").run();

  const before = totals(db);
  assert.equal(anonymizeOrphanedRecords(db), 1);
  assert.equal(anonymizeOrphanedRecords(db), 0);
  assert.deepEqual(totals(db), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = 'ORPHAN'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = 'ACTIVE'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = 'GUEST'").get().n, 1);
  const token = db.prepare("SELECT rfid FROM transactions WHERE type = 'register'").get().rfid;
  assert.match(token, /^deleted_/);
  assert.equal(db.prepare("SELECT size FROM transactions WHERE type = 'register'").get().size, "Deleted user");
  assert.equal(db.prepare("SELECT comment FROM feedback WHERE rfid = ?").get(token).comment, null);
});

test("legacy deleted RFID can register cleanly even when stale rows were left behind", () => {
  const db = createDb();
  const rfid = "LEGACY";
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, created_at) VALUES (?, 'register', 'Old name', 0, '2025-01-01 00:00:00')")
    .run(rfid);
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, created_at) VALUES (?, 'deposit', 'Small', 12, '2025-01-02 00:00:00')")
    .run(rfid);
  db.prepare("INSERT INTO feedback (rfid, context, rating, comment, created_at) VALUES (?, 'deposit', 5, 'Old note', '2025-01-02 00:00:00')")
    .run(rfid);

  db.transaction(() => {
    const token = anonymizeExistingRfidHistory(db, { rfid });
    db.prepare("INSERT INTO users (rfid, surname, firstname) VALUES (?, 'New', 'Account')").run(rfid);
    db.prepare("INSERT INTO transactions (rfid, type, size, weight_g) VALUES (?, 'register', 'New registration', 0)").run(rfid);
    assert.match(token, /^deleted_/);
  })();

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = ? AND type = 'deposit'").get(rfid).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE rfid = ?").get(rfid).n, 0);
  assert.equal(db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid).credits, 0);
});

test("migration separates legacy records predating an already re-registered account", () => {
  const db = createDb();
  db.prepare("INSERT INTO users (rfid, surname, firstname, created_at) VALUES ('REUSED', 'New', 'User', '2026-11-01 12:00:00')").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, created_at) VALUES ('REUSED', 'register', 'Old registration', 0, '2025-01-01 00:00:00')").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, created_at) VALUES ('REUSED', 'deposit', 'Old deposit', 12, '2025-01-02 00:00:00')").run();
  db.prepare("INSERT INTO feedback (rfid, context, rating, comment, created_at) VALUES ('REUSED', 'deposit', 4, 'Old note', '2025-01-02 00:00:00')").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, created_at) VALUES ('REUSED', 'register', 'Current registration', 0, '2026-11-01 12:00:00')").run();
  db.prepare("INSERT INTO transactions (rfid, type, size, weight_g, created_at) VALUES ('REUSED', 'deposit', 'Current deposit', 15, '2026-11-02 12:00:00')").run();

  assert.equal(anonymizeOrphanedRecords(db), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = 'REUSED' AND type = 'deposit'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE rfid = 'REUSED'").get().n, 0);
  const anonymousToken = db.prepare("SELECT rfid FROM transactions WHERE type = 'register' AND substr(rfid, 1, 8) = 'deleted_'").get().rfid;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = ?").get(anonymousToken).n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feedback WHERE rfid = ?").get(anonymousToken).n, 1);
});

test("migration command creates a pre-change backup before anonymizing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bottle2print-migration-"));
  const dbPath = path.join(directory, "kiosk.db");
  const original = new Database(dbPath);
  initializeSchema(original);
  original.prepare("INSERT INTO transactions (rfid, type, size, weight_g) VALUES ('ORPHAN', 'register', 'Old Name', 0)").run();
  original.prepare("INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g) VALUES ('ORPHAN', 'deposit', 'Small', 12, 36)").run();
  original.close();

  try {
    const script = path.resolve(__dirname, "../dist/scripts/anonymizeOrphanedRecords.js");
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, BOTTLE2PRINT_DB_PATH: dbPath },
    });
    assert.equal(result.status, 0, result.stderr);
    const backupPath = fs.readdirSync(directory).find(file => file.startsWith("kiosk.db.before-anonymize-"));
    assert.ok(backupPath);

    const backup = new Database(path.join(directory, backupPath), { readonly: true });
    assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = 'ORPHAN'").get().n, 2);
    backup.close();

    const migrated = new Database(dbPath, { readonly: true });
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM transactions WHERE rfid = 'ORPHAN'").get().n, 0);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM transactions WHERE substr(rfid, 1, 8) = 'deleted_'").get().n, 2);
    migrated.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
