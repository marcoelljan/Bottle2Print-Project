import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { db } from "./db";
import { isKioskBusy } from "./kioskState";
import { sendMail } from "./alerts";

const REMOTE = process.env.RCLONE_REMOTE || "gdrive:Bottle2Print-Backups";
const KEEP = 14;          // newest backups to keep in Drive
db.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

export function getBackupSettings() {
  const t = db.prepare("SELECT value FROM app_settings WHERE key = 'backup_time'").get() as any;
  const e = db.prepare("SELECT value FROM app_settings WHERE key = 'backup_enabled'").get() as any;
  return { time: t && /^\d{2}:\d{2}$/.test(t.value) ? t.value : "17:00", enabled: e ? e.value !== "0" : true };
}

export function saveBackupSettings(time: string, enabled: boolean) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Time must look like 17:00.");
  const up = db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  up.run("backup_time", time);
  up.run("backup_enabled", enabled ? "1" : "0");
}
let running = false;
let lastFailMail = 0;

const SECRET = crypto.createHash("sha256")
  .update(process.env.BACKUP_SECRET_KEY || process.env.ADMIN_PASSWORD_HASH || "fallback_kiosk_backup_secret_key").digest();

function manila() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Manila" });   // 2026-10-04 17:00:12
  return { date: s.slice(0, 10), hour: parseInt(s.slice(11, 13), 10), minute: parseInt(s.slice(14, 16), 10), stamp: s.replace(" ", "_").replace(/:/g, "").slice(0, 15) };
}
const manilaDate = (ms: number) => new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Manila" }).slice(0, 10);

function lastOk(): number | null {
  try {
    const r = db.prepare("SELECT created_at FROM activity_logs WHERE action = 'DRIVE_BACKUP' ORDER BY id DESC LIMIT 1").get() as any;
    return r ? Date.parse(r.created_at.replace(" ", "T") + "Z") : null;
  } catch { return null; }
}

function log(by: string, action: string, details: string) {
  try { db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)").run(by, action, details); } catch {}
}

export function getBackupStatus() {
  try {
    return db.prepare("SELECT action, details, created_at FROM activity_logs WHERE action IN ('DRIVE_BACKUP','DRIVE_BACKUP_FAILED') ORDER BY id DESC LIMIT 1").get() ?? null;
  } catch { return null; }
}

// Same format as the Download Backup button, so Restore Backup accepts these files
function buildEncryptedBackup(): string {
  const raw = {
    users: db.prepare("SELECT * FROM users").all(),
    transactions: db.prepare("SELECT * FROM transactions").all(),
    feedback: db.prepare("SELECT * FROM feedback").all(),
    activity_logs: db.prepare("SELECT * FROM activity_logs").all(),
    sensor_config: db.prepare("SELECT * FROM sensor_config").all(),
    version: 1,
    exported_at: new Date().toISOString(),
  };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(raw), "utf8"), cipher.final()]);
  return JSON.stringify({ iv: iv.toString("hex"), encrypted: encrypted.toString("hex"), tag: cipher.getAuthTag().toString("hex") });
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string; error: string }> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ""), error: String(stderr || (err && err.message) || "") });
    });
  });
}

export async function runDriveBackup(by: string): Promise<{ ok: boolean; message: string }> {
  if (running) return { ok: false, message: "A backup is already running." };
  running = true;
  const auto = by === "System Kiosk";
  let file = "";
  try {
    file = path.join(os.tmpdir(), "kiosk_secure_backup_" + manila().stamp + ".json");
    fs.writeFileSync(file, buildEncryptedBackup(), { mode: 0o600 });
    const up = await run("rclone", ["copy", file, REMOTE]);
    if (!up.ok) throw new Error(up.error);

    const ls = await run("rclone", ["lsf", REMOTE, "--files-only"]);   // keep only the newest KEEP files
    if (ls.ok) {
      const names = ls.out.split("\n").map(s => s.trim()).filter(n => /^kiosk_secure_backup_.*\.json$/.test(n)).sort();
      for (const n of names.slice(0, Math.max(0, names.length - KEEP))) await run("rclone", ["deletefile", REMOTE + "/" + n]);
    }
    log(by, "DRIVE_BACKUP", "Encrypted backup uploaded to Google Drive");
    return { ok: true, message: "Backup uploaded to Google Drive." };
  } catch (e: any) {
    let msg = String(e.message || e).slice(0, 300);
    if (/ENOENT/.test(msg)) msg = "rclone is not installed. Run: sudo apt install rclone";
    log(by, "DRIVE_BACKUP_FAILED", msg);
    if (auto && Date.now() - lastFailMail > 24 * 3600 * 1000) {
      lastFailMail = Date.now();
      sendMail("Backup failed", "The automatic Google Drive backup failed: " + msg + "\nCheck rclone on the Pi (rclone lsd gdrive:).");
    }
    return { ok: false, message: msg };
  } finally {
    if (file) fs.unlink(file, () => {});
    running = false;
  }
}

export function startBackupSchedule() {
  let nextTryAt = 0;
  setInterval(async () => {
    if (running || Date.now() < nextTryAt) return;
        const cfg = getBackupSettings();
    if (!cfg.enabled) return;
    const [h, mi] = cfg.time.split(":").map(Number);
    const m = manila();
    const ok = lastOk();
    const dueToday = (m.hour * 60 + m.minute) >= (h * 60 + mi) && (ok === null || manilaDate(ok) < m.date);
    const missedDay = ok !== null && Date.now() - ok > 26 * 3600 * 1000;   // Pi was off at 5 PM
    if (!dueToday && !missedDay) return;
    if (isKioskBusy()) return;                                             // try again in a minute
    const r = await runDriveBackup("System Kiosk");
    if (!r.ok) nextTryAt = Date.now() + 3 * 3600 * 1000;                   // retry in 3 hours
  }, 60000);
}