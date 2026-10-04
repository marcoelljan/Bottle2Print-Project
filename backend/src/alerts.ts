import nodemailer from "nodemailer";
import { db } from "./db";
import { getSensorStatus } from "./sensorHealth";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const STARTUP_QUIET_MS = 3 * 60 * 1000;
const OFFLINE_AFTER_MS = 5 * 60 * 1000;
const FAULT_AFTER_MS = 2 * 60 * 1000;
const startedAt = Date.now();
const active = new Set<string>();
const sending = new Set<string>();
const lastSent = new Map<string, number>();
const retryAt = new Map<string, number>();

const LABELS: Record<string, string> = {
  ir: "IR sensor", capacitive: "Capacitive sensor", tof: "ToF sensor", loadcell: "Load cell",
  rfid: "RFID reader", photoelectric: "Photoelectric sensor", ultrasonic: "Ultrasonic sensor", servo: "Servo gate",
};
const label = (id: string) => LABELS[id] ?? id;
const nowText = () => new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" });

function logAlert(action: string, details: string) {
  try { db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)").run("System Kiosk", action, details); } catch {}
}

function recipients(): string[] {
  try {
    return (db.prepare("SELECT email FROM admins WHERE email IS NOT NULL AND TRIM(email) != ''").all() as any[]).map(r => r.email);
  } catch { return []; }
}

export async function sendMail(subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const to = recipients();
  if (to.length === 0) return { ok: false, error: "No admin has a Gmail address saved." };
  try {
    await transporter.sendMail({ from: `"Bottle2Print Kiosk" <${process.env.SMTP_USER}>`, to: to.join(","), subject: "[Bottle2Print] " + subject, text });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function raise(key: string, subject: string, detail: string, reminderMs?: number) {
  const now = Date.now();
  if (now - startedAt < STARTUP_QUIET_MS || sending.has(key) || (retryAt.get(key) ?? 0) > now) return;
  if (active.has(key) && (!reminderMs || now - (lastSent.get(key) ?? 0) < reminderMs)) return;
  sending.add(key);
  try {
    const r = await sendMail(subject, detail + "\n\nTime: " + nowText());
    if (r.ok) { active.add(key); lastSent.set(key, now); retryAt.delete(key); logAlert("ALERT_SENT", subject); }
    else { retryAt.set(key, now + 10 * 60 * 1000); logAlert("ALERT_FAILED", subject + ": " + r.error); }
  } finally { sending.delete(key); }
}

async function clear(key: string, subject: string, detail: string) {
  if (!active.has(key)) return;
  active.delete(key); lastSent.delete(key);
  const r = await sendMail(subject, detail + "\n\nTime: " + nowText());
  logAlert(r.ok ? "ALERT_SENT" : "ALERT_FAILED", r.ok ? subject : subject + ": " + r.error);
}

let offlineSince: number | null = null;
const faultSince: Record<string, number> = {};

function checkAlerts() {
  try {
    const st = getSensorStatus();
    const now = Date.now();

    if (st.overall === "online") {
      offlineSince = null;
      clear("arduino", "Arduino back online", "The Arduino is connected and responding again.");
    } else {
      if (offlineSince === null) offlineSince = now;
      if (now - offlineSince >= OFFLINE_AFTER_MS) {
        raise("arduino", "Arduino " + st.overall,
          "The Arduino has been " + st.overall + " for over 5 minutes." + (st.serial.error ? " Error: " + st.serial.error : "") +
          " Bottle deposits are not possible until it reconnects.");
      }
    }

    if (st.overall === "online") {
      for (const [id, h] of Object.entries(st.sensors)) {
        if (h.state === "fault") {
          if (faultSince[id] === undefined) faultSince[id] = now;
          if (now - faultSince[id] >= FAULT_AFTER_MS) {
            raise("sensor:" + id, label(id) + " problem", label(id) + " has reported a problem for over 2 minutes: " + (h.lastDetail ?? "no details") + ".");
          }
        } else {
          delete faultSince[id];
          clear("sensor:" + id, label(id) + " recovered", label(id) + " is reading normally again.");
        }
      }
    }

    const pct = st.bin.fillPercent;
    if (pct !== null) {
      if (pct >= 90) raise("bin", "Bin " + pct + "% full", "The collection bin is " + pct + "% full. Please empty it.", 24 * 60 * 60 * 1000);
      else if (pct < 80) clear("bin", "Bin emptied", "The bin level is now " + pct + "%.");
    }
  } catch (e) { console.error("alert check failed:", e); }
}

export function startAlertWatch() {
  if (process.env.ALERTS_ENABLED === "false") { console.log("Email alerts are off (ALERTS_ENABLED=false)."); return; }
  setInterval(checkAlerts, 30000);
}