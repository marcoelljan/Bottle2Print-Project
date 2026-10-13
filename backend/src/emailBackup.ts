import crypto from "crypto";
import nodemailer from "nodemailer";
import { db } from "./db";
import { isKioskBusy } from "./kioskState";

const MAX_BYTES = 20 * 1024 * 1024;   // Gmail allows 25 MB per email; leave room for encoding
let running = false;

db.exec("CREATE TABLE IF NOT EXISTS email_backup_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

const SECRET = crypto.createHash("sha256")
  .update(process.env.BACKUP_SECRET_KEY || process.env.ADMIN_PASSWORD_HASH || "fallback_kiosk_backup_secret_key").digest();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

function manila(ms = Date.now()) {
  const s = new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Manila" });   // 2026-10-09 17:00:12
  return {
    date: s.slice(0, 10),
    minutes: parseInt(s.slice(11, 13), 10) * 60 + parseInt(s.slice(14, 16), 10),
    stamp: s.slice(0, 10) + "_" + s.slice(11, 16).replace(":", ""),
  };
}

// Every admin with an email saved, plus the kiosk mailbox. BACKUP_EMAIL_TO (comma separated) overrides the list.
function recipients(): string[] {
  const override = (process.env.BACKUP_EMAIL_TO || "").split(",").map(s => s.trim()).filter(Boolean);
  if (override.length) return override;
  let list: string[] = [];
  try {
    list = (db.prepare("SELECT email FROM admins WHERE email IS NOT NULL AND TRIM(email) != ''").all() as any[]).map(r => String(r.email).trim());
  } catch {}
  if (process.env.SMTP_USER) list.push(process.env.SMTP_USER);
  return Array.from(new Set(list.map(e => e.toLowerCase())));
}

export function getEmailBackupSettings() {
  const row = (k: string) => (db.prepare("SELECT value FROM email_backup_settings WHERE key = ?").get(k) as any)?.value;
  const t = row("time"), e = row("enabled");
  return { time: t && /^\d{2}:\d{2}$/.test(t) ? t : "17:00", enabled: e !== "0" };
}

export function saveEmailBackupSettings(time: string, enabled: boolean) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Time must look like 17:00.");
  const up = db.prepare("INSERT INTO email_backup_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  up.run("time", time);
  up.run("enabled", enabled ? "1" : "0");
}

function log(by: string, action: string, details: string) {
  try { db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)").run(by, action, details); } catch {}
}

export function getEmailBackupStatus() {
  try {
    return db.prepare("SELECT action, details, created_at FROM activity_logs WHERE action IN ('EMAIL_BACKUP','EMAIL_BACKUP_FAILED') ORDER BY id DESC LIMIT 1").get() ?? null;
  } catch { return null; }
}

function lastOkAt(): number | null {
  try {
    const r = db.prepare("SELECT created_at FROM activity_logs WHERE action = 'EMAIL_BACKUP' ORDER BY id DESC LIMIT 1").get() as any;
    return r ? Date.parse(r.created_at.replace(" ", "T") + "Z") : null;
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

export async function runEmailBackup(by: string): Promise<{ ok: boolean; message: string }> {
  if (running) return { ok: false, message: "A backup is already running." };
  running = true;
  try {
    const key = process.env.BACKUP_SECRET_KEY || "";
    if (key.length < 16) throw new Error("Set a BACKUP_SECRET_KEY of at least 16 random characters in .env before emailing backups.");
    const to = recipients();
    if (to.length === 0) throw new Error("No recipient. Save a Gmail address for an admin, or set SMTP_USER.");

    const content = buildEncryptedBackup();
    const bytes = Buffer.byteLength(content);
    const kb = Math.round(bytes / 1024);
    if (bytes > MAX_BYTES) throw new Error("Backup is " + kb + " KB, too large to email. Use Download Backup.");

    const m = manila();
    await transporter.sendMail({
      from: `"Bottle2Print Kiosk" <${process.env.SMTP_USER}>`,
      to: to.join(","),
      subject: "[Bottle2Print] Backup " + m.date,
      text: "Encrypted kiosk backup attached (" + kb + " KB).\n\nRestore: Admin panel, Settings, System Maintenance, Restore Backup.\nThe file can only be opened with BACKUP_SECRET_KEY. Do not forward it.",
      attachments: [{ filename: "kiosk_secure_backup_" + m.stamp + ".json", content, contentType: "application/json" }],
    });
    log(by, "EMAIL_BACKUP", "Encrypted backup emailed to " + to.length + " address(es) (" + kb + " KB)");
    return { ok: true, message: "Backup emailed to " + to.length + " address(es)." };
  } catch (e: any) {
    const msg = String(e.message || e).slice(0, 300);
    log(by, "EMAIL_BACKUP_FAILED", msg);
    return { ok: false, message: msg };
  } finally {
    running = false;
  }
}

export function startEmailBackupSchedule() {
  let nextTryAt = 0;
  setInterval(async () => {
    if (running || Date.now() < nextTryAt) return;
    const cfg = getEmailBackupSettings();
    if (!cfg.enabled) return;
    const [h, mi] = cfg.time.split(":").map(Number);
    const m = manila();
    const ok = lastOkAt();
    const dueToday = m.minutes >= h * 60 + mi && (ok === null || manila(ok).date < m.date);
    const missedDay = ok !== null && Date.now() - ok > 26 * 3600 * 1000;   // Pi was off at the set time
    if (!dueToday && !missedDay) return;
    if (isKioskBusy()) return;                                              // try again in a minute
    const r = await runEmailBackup("System Kiosk");
    if (!r.ok) nextTryAt = Date.now() + 3 * 3600 * 1000;                    // retry in 3 hours
  }, 60000);
}