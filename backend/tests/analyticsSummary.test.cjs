const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const Database = require("better-sqlite3");
const { computeAnalyticsSummary } = require("../dist/analyticsSummary.js");
const { saveSystemConfig } = require("../dist/systemConfig.js");

const databases = [];

function createTestDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfid TEXT NOT NULL,
      type TEXT NOT NULL,
      size TEXT,
      co2_saved_g REAL DEFAULT 0,
      credits INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE print_logs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      pages INTEGER NOT NULL,
      color_mode TEXT NOT NULL,
      credits_charged INTEGER NOT NULL,
      coverage_factor REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE guest_print_logs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      pages INTEGER NOT NULL,
      color_mode TEXT NOT NULL,
      credits_charged INTEGER NOT NULL,
      coverage_factor REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);
  databases.push(db);
  return db;
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

test("today totals use Manila dates and exclude refunded/failed jobs from ink and credits", () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, co2_saved_g, created_at)
    VALUES
      ('GUEST', 'deposit', 'XL', 56.3, '2026-11-25 01:10:00'),
      ('GUEST', 'deposit', 'Small-Large', 19.9, '2026-11-25 01:20:00')
  `).run();
  db.prepare(`
    INSERT INTO print_logs (status, pages, color_mode, credits_charged, created_at)
    VALUES
      ('completed', 2, 'bw', 6, '2026-11-25 01:30:00'),
      ('completed', 1, 'color', 8, '2026-11-25 01:40:00'),
      ('refunded', 2, 'color', 16, '2026-11-25 01:50:00'),
      ('failed', 1, 'bw', 3, '2026-11-25 01:55:00')
  `).run();
  db.prepare(`
    INSERT INTO guest_print_logs (status, pages, color_mode, credits_charged, created_at)
    VALUES ('completed', 1, 'bw', 3, '2026-11-25 02:05:00')
  `).run();

  const result = computeAnalyticsSummary(db, {
    range: "today",
    series: "hourly",
    now: new Date("2026-11-25T02:00:00Z"),
  });

  assert.equal(result.today.bottles, 2);
  assert.equal(result.today.bottles1_5L, 1);
  assert.equal(result.today.bottlesSmall, 1);
  assert.equal(result.today.kg, 0.07);
  assert.equal(result.today.co2SavedG, 76.2);
  assert.equal(result.today.printsOk, 3);
  assert.equal(result.today.printsRefunded, 1);
  assert.equal(result.today.creditsSpent, 17);
  assert.equal(result.today.pagesBw, 3);
  assert.equal(result.today.pagesColor, 1);
  assert.equal(result.today.inkCost, 1.85);
  assert.equal(result.today.resaleIncome, 0.4);
  assert.equal(result.today.netValue, -1.45);
  assert.equal(result.today.bottlesNeededFor1Peso["1.5L"], 4);
  assert.equal(result.today.bottlesNeededFor1Peso.small, 10);
  assert.equal(result.buckets.length, 24);
  assert.equal(result.buckets[9].label, "09:00");
  assert.equal(result.buckets[9].bottles, 2);
  assert.equal(result.buckets[10].label, "10:00");
  assert.equal(result.buckets[10].printsOk, 1);
  assert.equal(result.binFillPercentByType["1.5L"], null);
});

test("range and series return daily buckets and live resale price calculations", () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, co2_saved_g, created_at)
    VALUES ('CARD1', 'deposit', 'XL', 56.3, '2026-11-24 03:00:00')
  `).run();

  const result = computeAnalyticsSummary(db, {
    range: "7d",
    series: "daily",
    resalePerKg: 8,
    now: new Date("2026-11-25T02:00:00Z"),
  });

  assert.equal(result.buckets.length, 7);
  assert.equal(result.buckets[5].label, "2026-11-24");
  assert.equal(result.totals.kg, 0.05);
  assert.equal(result.totals.resaleIncome, 0.39);
  assert.equal(result.totals.netValue, 0.39);
  assert.equal(result.resalePricePerKg, 8);
});

test("1-day and 14-day ranges return Manila-local daily totals", () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, co2_saved_g, created_at)
    VALUES
      ('CARD1', 'deposit', 'XL', 56.3, '2026-11-24 03:00:00'),
      ('CARD1', 'deposit', 'XL', 56.3, '2026-11-25 03:00:00')
  `).run();
  const now = new Date("2026-11-25T02:00:00Z");

  const oneDay = computeAnalyticsSummary(db, { range: "1d", series: "daily", now });
  assert.equal(oneDay.startDate, "2026-11-25");
  assert.equal(oneDay.endDate, "2026-11-25");
  assert.equal(oneDay.buckets.length, 1);
  assert.equal(oneDay.totals.bottles, 1);

  const twoWeeks = computeAnalyticsSummary(db, { range: "14d", series: "daily", now });
  assert.equal(twoWeeks.startDate, "2026-11-12");
  assert.equal(twoWeeks.endDate, "2026-11-25");
  assert.equal(twoWeeks.buckets.length, 14);
  assert.equal(twoWeeks.totals.bottles, 2);
});

test("selected historical date returns Manila-local hourly totals and excludes adjacent dates", () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO transactions (rfid, type, size, co2_saved_g, created_at)
    VALUES
      ('CARD1', 'deposit', 'XL', 56.3, '2026-11-23 16:30:00'),
      ('CARD1', 'deposit', 'Small-Large', 19.9, '2026-11-24 15:59:00'),
      ('CARD1', 'deposit', 'XL', 56.3, '2026-11-24 16:00:00')
  `).run();
  db.prepare(`
    INSERT INTO print_logs (status, pages, color_mode, credits_charged, created_at)
    VALUES
      ('completed', 2, 'bw', 6, '2026-11-23 16:45:00'),
      ('refunded', 1, 'color', 8, '2026-11-24 15:45:00'),
      ('completed', 1, 'color', 4, '2026-11-24 16:00:00')
  `).run();

  const result = computeAnalyticsSummary(db, {
    range: "date",
    series: "hourly",
    date: "2026-11-24",
    now: new Date("2026-11-25T02:00:00Z"),
  });

  assert.equal(result.range, "date");
  assert.equal(result.selectedDate, "2026-11-24");
  assert.equal(result.series, "hourly");
  assert.equal(result.startDate, "2026-11-24");
  assert.equal(result.endDate, "2026-11-24");
  assert.equal(result.totals.bottles, 2);
  assert.equal(result.totals.printsOk, 1);
  assert.equal(result.totals.printsRefunded, 1);
  assert.equal(result.totals.inkCost, 0.74);
  assert.equal(result.buckets.length, 24);
  assert.equal(result.buckets[0].label, "00:00");
  assert.equal(result.buckets[0].bottles, 1);
  assert.equal(result.buckets[0].printsOk, 1);
  assert.equal(result.buckets[23].label, "23:00");
  assert.equal(result.buckets[23].printsRefunded, 1);
});

test("selected date rejects invalid and future calendar dates", () => {
  const db = createTestDb();
  const now = new Date("2026-11-25T02:00:00Z");
  for (const date of ["2026-02-30", "2026-11-26", "not-a-date"]) {
    assert.throws(() => computeAnalyticsSummary(db, {
      range: "date",
      date,
      now,
    }));
  }
});

test("empty print data reports zero ink cost and a finite net value", () => {
  const db = createTestDb();
  const result = computeAnalyticsSummary(db, {
    range: "today",
    series: "hourly",
    now: new Date("2026-11-25T02:00:00Z"),
  });

  assert.equal(result.today.printsOk, 0);
  assert.equal(result.today.printsRefunded, 0);
  assert.equal(result.today.inkCost, 0);
  assert.equal(result.today.netValue, 0);
  assert.ok(Number.isFinite(result.today.netValue));
});

test("system analytics settings persist and color ink stays costlier than B&W", () => {
  const db = createTestDb();
  const saved = saveSystemConfig({ resalePricePerKg: 7 }, db);
  assert.equal(saved.resalePricePerKg, 7);
  assert.throws(() => saveSystemConfig({ inkCostColorPerPage: 0.37 }, db), /greater than B&W/);
});
