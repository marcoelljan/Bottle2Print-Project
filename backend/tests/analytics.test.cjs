const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const Database = require("better-sqlite3");
const { computeAdminAnalytics } = require("../dist/analytics.js");

const databases = [];

function createTestDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfid TEXT NOT NULL,
      type TEXT NOT NULL,
      size TEXT,
      height_mm REAL,
      weight_g REAL,
      co2_saved_g REAL DEFAULT 0,
      credits INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reject_stage TEXT,
      reject_reason TEXT
    );
    CREATE TABLE bin_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      distance_cm REAL NOT NULL,
      fill_percent INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO system_config (key, value) VALUES
      ('ink_cost_bw_per_page', '0.37'),
      ('ink_cost_color_per_page', '0.74'),
      ('resale_price_per_kg', '6'),
      ('bottle_weight_g_1_5l', '49.09'),
      ('bottle_weight_g_small', '17.33'),
      ('bin_max_bottles_1_5l', '55'),
      ('bin_max_bottles_small', '75');
  `);
  databases.push(db);
  return db;
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

test("buckets UTC timestamps into Asia/Manila dates and busiest hour", () => {
  const db = createTestDb();
  // 2026-11-24 15:30:00 UTC = 2026-11-24 23:30:00 Manila
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
    VALUES ('CARD1', 'deposit', 'Small', 15, 17.19, 3, '2026-11-24 15:30:00')
  `).run();
  // 2026-11-24 16:30:00 UTC = 2026-11-25 00:30:00 Manila (rolls to next Manila day!)
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
    VALUES ('GUEST', 'deposit', 'XL', 45, 51.57, 5, '2026-11-24 16:30:00')
  `).run();
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
    VALUES ('GUEST', 'reject', NULL, 2, 0, 0, '2026-11-24 16:35:00')
  `).run();

  // Fixed "now" = 2026-11-25 10:00:00 Manila (02:00:00 UTC)
  const now = new Date("2026-11-25T02:00:00Z");
  const result = computeAdminAnalytics(db, { range: 7, now });

  assert.equal(result.startDate, "2026-11-19");
  assert.equal(result.endDate, "2026-11-25");

  const day24 = result.dailySeries.find(d => d.date === "2026-11-24");
  const day25 = result.dailySeries.find(d => d.date === "2026-11-25");
  assert.equal(day24.bottlesAccepted, 1);
  assert.equal(day24.creditsIssued, 3);
  assert.equal(day25.bottlesAccepted, 1);
  assert.equal(day25.rejectedBottles, 1);
  assert.equal(day25.creditsIssued, 5);

  assert.equal(result.totals.bottlesAccepted, 2);
  assert.equal(result.totals.plasticWeightKg, 0.07);
  assert.equal(day24.plasticWeightKg, 0.02);
  assert.equal(day25.plasticWeightKg, 0.05);
  assert.equal(result.cardVsGuest.card.bottlesAccepted, 1);
  assert.equal(result.cardVsGuest.guest.bottlesAccepted, 1);
  assert.equal(result.busiestHour.hour, 0); // tied at 1 each, earliest hour wins (00:00)
});

test("nets print refunds against submitted prints without subtracting admin adjustments", () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, credits, created_at)
    VALUES
      ('CARD1', 'print', '2 page(s), bw', 6, '2026-11-25 01:00:00'),
      ('CARD1', 'print', '1 page(s), color', 8, '2026-11-25 02:00:00'),
      ('GUEST', 'print', '1 page(s), bw', 3, '2026-11-25 03:00:00'),
      ('CARD1', 'adjust', 'Print refunded: the job did not finish', 8, '2026-11-25 02:05:00'),
      ('GUEST', 'adjust', 'Print refunded: cancelled by user', 3, '2026-11-25 02:08:00'),
      ('CARD1', 'adjust', 'Admin added credits: manual correction', 10, '2026-11-25 02:10:00')
  `).run();

  const result = computeAdminAnalytics(db, {
    range: 7,
    now: new Date("2026-11-25T06:00:00Z"),
  });

  assert.equal(result.totals.submittedPrints, 3);
  assert.equal(result.totals.refundedPrints, 2);
  assert.equal(result.totals.confirmedPrints, 1);
  assert.equal(result.totals.printCreditsSpent, 6); // 6 + 8 + 3 - 8 - 3
  assert.equal(result.cardVsGuest.card.confirmedPrints, 1);
  assert.equal(result.cardVsGuest.guest.confirmedPrints, 0);
});

test("zero-fills daily series across 7, 30, and 90 day ranges", () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
    VALUES ('CARD1', 'deposit', 'Small', 20, 22.92, 3, '2026-11-20 04:00:00')
  `).run();

  const now = new Date("2026-11-25T02:00:00Z");
  for (const range of [7, 30, 90]) {
    const res = computeAdminAnalytics(db, { range, now });
    assert.equal(res.dailySeries.length, range);
    assert.equal(res.dailySeries[res.dailySeries.length - 1].date, "2026-11-25");
    const emptyDays = res.dailySeries.filter(d => d.bottlesAccepted === 0);
    assert.equal(emptyDays.length, range - 1);
  }
});

test("returns not-ready forecast under 14 days and blended forecast at 14+ days", () => {
  const db = createTestDb();
  const now = new Date("2026-11-25T02:00:00Z");

  // Insert 13 days of deposits -> still below 14 days
  for (let i = 0; i < 13; i++) {
    const dt = new Date(Date.UTC(2026, 10, 12 + i, 4, 0, 0)).toISOString().slice(0, 19).replace("T", " ");
    db.prepare(`
      INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
      VALUES ('CARD1', 'deposit', 'Small', 20, 22.92, 3, ?)
    `).run(dt);
  }

  const tooShort = computeAdminAnalytics(db, { range: 30, currentBinFillPercent: 40, now });
  assert.deepEqual(tooShort.forecast, {
    ready: false,
    reason: "Needs at least 14 days of data",
    activeDays: 13,
  });

  // Add 14th day -> forecast becomes ready
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
    VALUES ('CARD1', 'deposit', 'Small', 20, 22.92, 3, '2026-11-25 01:00:00')
  `).run();

  const withBin = computeAdminAnalytics(db, { range: 30, currentBinFillPercent: 50, now });
  assert.equal(withBin.forecast.ready, true);
  assert.equal(withBin.forecast.projectedSeries.length, 30);
  assert.ok(withBin.forecast.next7Days.bottles > 0);
  assert.ok(withBin.forecast.next30Days.bottles >= withBin.forecast.next7Days.bottles);
  assert.ok(typeof withBin.forecast.estimatedBinFullDate === "string");

  const withoutBin = computeAdminAnalytics(db, { range: 30, currentBinFillPercent: null, now });
  assert.equal(withoutBin.forecast.ready, true);
  assert.equal("estimatedBinFullDate" in withoutBin.forecast, false);
});

test("computes forecast plasticWeightKg from configured bottle-type weights with all-time fallback", () => {
  const db = createTestDb();
  const now = new Date("2026-11-25T02:00:00Z");

  // 14 consecutive small-type deposits ending 2026-11-17 (so range=7 from Nov 19..25 has none).
  for (let i = 0; i < 14; i++) {
    const dt = new Date(Date.UTC(2026, 10, 4 + i, 4, 0, 0)).toISOString().slice(0, 19).replace("T", " ");
    db.prepare(`
      INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
      VALUES ('CARD1', 'deposit', 'Small', 20, 22.92, 3, ?)
    `).run(dt);
  }
  // Rejected bottles (heavy weight) must be ignored in average grams per bottle
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, weight_g, co2_saved_g, credits, created_at)
    VALUES ('CARD1', 'reject', NULL, 500, 0, 0, '2026-11-24 04:00:00')
  `).run();

  // Range=30 includes those 14 days and uses the configured S-type reference weight.
  const range30 = computeAdminAnalytics(db, { range: 30, now });
  assert.equal(range30.forecast.ready, true);
  assert.equal(range30.forecast.avgGramsPerBottle, 17.33);
  assert.equal(
    range30.forecast.next7Days.plasticWeightKg,
    Math.round((range30.forecast.next7Days.bottles * 17.33 / 1000 + Number.EPSILON) * 100) / 100
  );
  assert.equal(
    range30.forecast.next30Days.plasticWeightKg,
    Math.round((range30.forecast.next30Days.bottles * 17.33 / 1000 + Number.EPSILON) * 100) / 100
  );

  // Range=7 has no accepted deposits in Nov 19..25, so it falls back to the same configured type weight.
  const range7 = computeAdminAnalytics(db, { range: 7, now });
  assert.equal(range7.totals.bottlesAccepted, 0);
  assert.equal(range7.forecast.ready, true);
  assert.equal(range7.forecast.avgGramsPerBottle, 17.33);
  assert.equal(
    range7.forecast.next30Days.plasticWeightKg,
    Math.round((range7.forecast.next30Days.bottles * 17.33 / 1000 + Number.EPSILON) * 100) / 100
  );
});
