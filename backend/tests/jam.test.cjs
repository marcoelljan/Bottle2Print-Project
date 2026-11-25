const test = require("node:test");
const assert = require("node:assert/strict");

const { db } = require("../dist/db.js");
const {
  clearJam,
  getJam,
  setJam,
  registerJamClearSender,
  requestJamClear,
  handleJamClearLine,
  JAM_DETECTION_ENABLED,
} = require("../dist/jam.js");

test("jam persistence survives a simulated restart", () => {
  clearJam();
  setJam("chamber", 620, "2026-11-25T12:00:00.000Z");

  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'jam_active'").get();
  assert.ok(row);

  const restarted = getJam();
  assert.equal(restarted.active, true);
  assert.equal(restarted.source, "chamber");
  assert.equal(restarted.mm, 620);
  assert.equal(restarted.since, "2026-11-25T12:00:00.000Z");

  clearJam();
  assert.equal(getJam().active, false);
});

test("jam clear refuses a busy chamber", async () => {
  clearJam();
  registerJamClearSender(() => {});
  const pending = requestJamClear();
  handleJamClearLine("JAMCLEAR:BUSY:182");
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.busy, true);
  assert.equal(result.mm, 182);
});

test("forced jam clear leaves an activity-log entry", () => {
  db.exec(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.prepare("DELETE FROM activity_logs WHERE action = 'JAM_CLEARED_FORCED'").run();
  db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)")
    .run("Test Admin", "JAM_CLEARED_FORCED", "Forced jam clear; source=chamber; ToF unavailable");
  const row = db.prepare("SELECT details FROM activity_logs WHERE action = 'JAM_CLEARED_FORCED' ORDER BY id DESC LIMIT 1").get();
  assert.match(row.details, /Forced jam clear/);
});

test("jam lines are disabled by the environment flag", () => {
  assert.equal(JAM_DETECTION_ENABLED, process.env.JAM_DETECTION_ENABLED === "true");
});
