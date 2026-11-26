import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { db } from "../db";
import { exec } from "child_process";
import { clear as clearAlert, sendMail } from "../alerts";
import { runDriveBackup, getBackupStatus, getBackupSettings, saveBackupSettings } from "../driveBackup";
import { runEmailBackup, getEmailBackupStatus, getEmailBackupSettings, saveEmailBackupSettings } from "../emailBackup";
import { getControls, setControl, FEATURES } from "../kioskControls";
import type { Feature } from "../kioskControls";
import { isKioskBusy } from "../kioskState";
import { getSensorStatus } from "../sensorHealth";
import { getCalibration, updateCalibration, invalidateCalibrationCache } from "../sensorConfig";
import { requestTofCal } from "../tofCal";
import { clearVerified } from "../pinAuth";
import { getPrintPricing, isValidPrintRate, savePrintPricing } from "../printPricing";
import { anonymizeRfidHistory } from "../accountHistory";
import { clearJam, getJam, notifyJamTofEmpty, requestJamClear } from "../jam";
import { computeAdminAnalytics } from "../analytics";
import { computeAnalyticsSummary } from "../analyticsSummary";
import { saveSystemConfig, type SystemConfig } from "../systemConfig";
import {
  BASE_CASE_OPERATING_COSTS_PHP,
  BASE_CASE_PET_KG_PER_SEMESTER,
  CO2E_KG_PER_KG_PET,
  OPTIONAL_ORG_PAPER_MARGIN_PHP,
  REFERENCE_PET_PRICE_PHP_PER_KG,
  SEMESTER_WEEKS,
  createFinancialScenarios,
  forecastWeeklyDemand,
  type ForecastModel,
} from "../forecast";

const router = Router();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const resetTokens = new Map<string, { adminId: number; expiresAt: number }>();

const rawBackupSecret = process.env.BACKUP_SECRET_KEY || process.env.ADMIN_PASSWORD_HASH || "fallback_kiosk_backup_secret_key";
const BACKUP_SECRET_KEY = crypto.createHash("sha256").update(rawBackupSecret).digest();

try {
  db.exec(`ALTER TABLE admins ADD COLUMN password_changed INTEGER NOT NULL DEFAULT 1;`);
} catch (e) {}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user TEXT NOT NULL,
      action     TEXT NOT NULL,
      details    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch (e) {}

function logActivity(adminUsername: string, action: string, details: string) {
  try {
    db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)").run(adminUsername, action, details);
  } catch (e) {}
}

const LEGACY_ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
(function seedLegacySuperAdmin() {
  const count = (db.prepare("SELECT COUNT(*) as c FROM admins").get() as any).c;
  if (count === 0 && LEGACY_ADMIN_PASSWORD_HASH) {
    db.prepare(
      "INSERT INTO admins (username, password_hash, role, password_changed) VALUES (?, ?, 'super_admin', 1)"
    ).run("admin", LEGACY_ADMIN_PASSWORD_HASH);
  }
})();

interface Session { adminId: number; username: string; role: "admin" | "super_admin"; passwordChanged: boolean; }
const activeSessions = new Map<string, Session>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function issueToken(session: Session): string {
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.set(token, session);
  setTimeout(() => activeSessions.delete(token), SESSION_TTL_MS);
  return token;
}

function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const session = token ? activeSessions.get(token) : undefined;
  if (!session) return res.status(401).json({ error: "Not authenticated." });
  req.admin = session;
  next();
}

function requireSuperAdmin(req: any, res: any, next: any) {
  if (req.admin?.role !== "super_admin") return res.status(403).json({ error: "Super-admin access required." });
  next();
}

// Lockout is tracked per username (5 tries) and per device/IP (15 tries), 3 minutes each
const LOGIN_LOCK_MS = 3 * 60 * 1000;
const loginFails = new Map<string, { count: number; lockedUntil: number }>();

function lockedUntilFor(keys: string[]): number {
  const now = Date.now();
  let until = 0;
  for (const k of keys) {
    const e = loginFails.get(k);
    if (e && e.lockedUntil > now) until = Math.max(until, e.lockedUntil);
  }
  return until;
}

function recordFail(key: string, limit: number) {
  const e = loginFails.get(key) ?? { count: 0, lockedUntil: 0 };
  if (e.lockedUntil && e.lockedUntil <= Date.now()) { e.count = 0; e.lockedUntil = 0; }
  e.count++;
  if (e.count >= limit) { e.lockedUntil = Date.now() + LOGIN_LOCK_MS; e.count = 0; }
  loginFails.set(key, e);
}

router.post("/api/admin/check-username", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username required." });
  const admin = db.prepare("SELECT id FROM admins WHERE username = ?").get(username);
  if (!admin) return res.status(404).json({ error: "Username not found." });
  res.json({ exists: true });
});

router.post("/api/admin/forgot-password", async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email) {
    return res.status(400).json({ error: "Both username and registered email are required." });
  }

  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username.trim()) as any;
  if (!admin || !admin.email || admin.email.toLowerCase() !== email.trim().toLowerCase()) {
    return res.status(400).json({ error: "Username or registered email does not match our records." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000;
  resetTokens.set(token, { adminId: admin.id, expiresAt });

  const baseUrl = process.env.FRONTEND_URL || `${req.headers['x-forwarded-proto'] || req.protocol || 'http'}://${req.get('host')}`;
  const resetLink = `${baseUrl}/?reset_token=${token}`;
  try {
    await transporter.sendMail({
      from: `"Bottle2Print Kiosk" <${process.env.SMTP_USER}>`,
      to: admin.email,
      subject: "Password Reset Request - Bottle2Print Kiosk",
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; padding: 20px; background: #f9f9f9; border-radius: 8px;">
          <h2 style="color: #f0a500;">Password Reset Request</h2>
          <p>Hello <strong>${admin.username}</strong>,</p>
          <p>We received a request to reset your admin password. Click the button below to proceed:</p>
          <p><a href="${resetLink}" style="background: #f0a500; color: #000; padding: 12px 20px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Reset Password</a></p>
          <p style="font-size: 12px; color: #666; margin-top: 20px;">If you didn't request this, ignore this email. This link expires in 15 minutes.</p>
        </div>
      `,
    });

    logActivity(admin.username, "REQUEST_PASSWORD_RESET", `Sent password reset token to ${admin.email}`);
    res.json({ success: true, message: "Password reset link sent to your registered email." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to send reset email: " + err.message });
  }
});

router.post("/api/admin/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: "Missing token or new password." });
  if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });

  const record = resetTokens.get(token);
  if (!record || Date.now() > record.expiresAt) {
    resetTokens.delete(token);
    return res.status(400).json({ error: "Invalid or expired reset token." });
  }

  try {
    const newHash = await bcrypt.hash(newPassword, 10);
    db.prepare("UPDATE admins SET password_hash = ?, password_changed = 1 WHERE id = ?").run(newHash, record.adminId);
    resetTokens.delete(token);
    
    const admin = db.prepare("SELECT username FROM admins WHERE id = ?").get(record.adminId) as any;
    logActivity(admin ? admin.username : "unknown", "RESET_PASSWORD", "Successfully reset password via Gmail token");

    res.json({ success: true, message: "Password successfully updated. You can now log in." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to reset password: " + err.message });
  }
});

router.post("/api/admin/login", async (req, res) => {
    const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing username or password." });

  const userKey = "u:" + String(username).trim().toLowerCase();
  const ipKey = "ip:" + (req.ip ?? "unknown");
  const lockedUntil = lockedUntilFor([userKey, ipKey]);
  if (lockedUntil) {
    return res.status(429).json({ error: "Too many failed attempts. Try again later.", lockoutUntil: lockedUntil });
  }
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username) as any;
  const match = admin ? await bcrypt.compare(password, admin.password_hash) : false;

    if (!match) {
    recordFail(userKey, 5);
    recordFail(ipKey, 15);
    const until = lockedUntilFor([userKey, ipKey]);
    if (until) return res.status(429).json({ error: "Too many failed attempts. Try again later.", lockoutUntil: until });
    return res.status(403).json({ error: "Incorrect username or password." });
  }

    loginFails.delete(userKey);

  const token = issueToken({
    adminId: admin.id,
    username: admin.username,
    role: admin.role,
    passwordChanged: admin.password_changed === 1
  });
  
  res.json({ 
    success: true, token, adminId: admin.id,
    username: admin.username, email: admin.email || "",
    role: admin.role, passwordChanged: admin.password_changed === 1 
  });
});

router.use("/api/admin", requireAuth);

// ── Badge Count Routes ─────────────────────────────────────────────────────
router.get("/api/admin/badges", (req: any, res) => {
  const { adminId, username, role } = req.admin;
  const seedStmt = db.prepare("INSERT OR IGNORE INTO admin_seen (admin_id, tab) VALUES (?, ?)");
  const out: Record<string, number> = {};

  for (const [tab, sql] of Object.entries(BADGE_SQL)) {
    if (tab === "admins" && role !== "super_admin") { out[tab] = 0; continue; }
    seedStmt.run(adminId, tab); // first time ever: starts at "now", no flood
    const { seen_at } = db.prepare("SELECT seen_at FROM admin_seen WHERE admin_id = ? AND tab = ?").get(adminId, tab) as any;
    const params = tab === "logs" ? { since: seen_at, me: username } : { since: seen_at };
    out[tab] = (db.prepare(sql).get(params) as any).n;
  }
  res.json(out);
});

router.post("/api/admin/badges/seen", (req: any, res) => {
  const { tab } = req.body;
  if (!BADGE_SQL[tab]) return res.status(400).json({ error: "Unknown tab." });
  db.prepare(`
    INSERT INTO admin_seen (admin_id, tab, seen_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(admin_id, tab) DO UPDATE SET seen_at = datetime('now')
  `).run(req.admin.adminId, tab);
  res.json({ success: true });
});

router.get("/api/admin/me", (req: any, res) => {
  const admin = db.prepare("SELECT email, password_changed FROM admins WHERE id = ?").get(req.admin.adminId) as any;
  res.json({ username: req.admin.username, email: admin ? admin.email : "", role: req.admin.role, passwordChanged: admin ? admin.password_changed === 1 : true });
});

router.post("/api/admin/me/password", async (req: any, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Missing current or new password." });
  if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  
  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.adminId) as any;
  const match = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!match) return res.status(403).json({ error: "Current password is incorrect." });

  const newHash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE admins SET password_hash = ?, password_changed = 1 WHERE id = ?").run(newHash, req.admin.adminId);
  req.admin.passwordChanged = true;
  res.json({ success: true });
});

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_seen (
    admin_id INTEGER NOT NULL,
    tab      TEXT NOT NULL,
    seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (admin_id, tab)
  );
`);

const BADGE_SQL: Record<string, string> = {
  logs: `SELECT (SELECT COUNT(*) FROM activity_logs WHERE created_at > @since AND admin_user != @me)
              + (SELECT COUNT(*) FROM transactions WHERE type = 'register' AND created_at > @since) AS n`,
  users: `SELECT COUNT(*) AS n FROM users WHERE created_at > @since`,
  transactions: `SELECT COUNT(*) AS n FROM transactions WHERE type != 'register' AND created_at > @since`,
  feedback: `SELECT COUNT(*) AS n FROM feedback WHERE created_at > @since`,
  admins: `SELECT COUNT(*) AS n FROM admins WHERE created_at > @since`,
};


// ── Overall System Statistics Route ────────────────────────────────────────
router.get("/api/admin/stats", requireAuth, (_req, res) => {
  try {
    const totals = db.prepare(`
      SELECT 
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) as total_bottles,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(weight_g, 0) ELSE 0 END) as total_weight_g,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(weight_g, 0) * ${CO2E_KG_PER_KG_PET} ELSE 0 END) as total_co2_g,
        SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) as total_prints,
        COUNT(DISTINCT CASE WHEN type != 'reject' AND rfid != 'GUEST' THEN rfid END) as total_users
      FROM transactions
    `).get() as any;

    res.json({
      totalBottles: totals.total_bottles || 0,
      totalPlasticKg: ((totals.total_weight_g || 0) / 1000).toFixed(2),
      totalCo2G: Math.round((totals.total_co2_g || 0) * 10) / 10,
      totalPrints: totals.total_prints || 0,
      totalUsers: totals.total_users || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch system stats: " + err.message });
  }
});

router.get("/api/admin/analytics", requireAuth, (req, res) => {
  try {
    const currentBinFillPercent = getSensorStatus().bin?.fillPercent ?? null;
    res.json(computeAdminAnalytics(db, {
      range: req.query.range,
      currentBinFillPercent,
    }));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch analytics: " + err.message });
  }
});

router.get("/api/analytics/summary", requireAuth, (req, res) => {
  try {
    const currentBinFillPercent = getSensorStatus().bin?.fillPercent ?? null;
    res.json(computeAnalyticsSummary(db, {
      range: req.query.range,
      series: req.query.series,
      date: req.query.date,
      resalePerKg: req.query.resalePerKg,
      binFillPercent: currentBinFillPercent,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not compute analytics.";
    res.status(
      message.startsWith("Resale price") ||
      message.startsWith("A valid date") ||
      message.startsWith("The selected date") ||
      message.startsWith("A future date")
        ? 400
        : 500
    ).json({ error: message });
  }
});

router.put("/api/analytics/config", requireAuth, (req, res) => {
  const allowedFields: Array<keyof SystemConfig> = [
    "inkCostBwPerPage",
    "inkCostColorPerPage",
    "resalePricePerKg",
    "bottleWeightG1_5L",
    "bottleWeightGSmall",
    "binMaxBottles1_5L",
    "binMaxBottlesSmall",
  ];
  const updates: Partial<SystemConfig> = {};
  for (const field of allowedFields) {
    if (req.body?.[field] === undefined) continue;
    const value = Number(req.body[field]);
    if (!Number.isFinite(value)) return res.status(400).json({ error: `${field} must be a number.` });
    updates[field] = value;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Provide at least one analytics setting to update." });
  }
  try {
    res.json({ config: saveSystemConfig(updates) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save analytics settings.";
    res.status(400).json({ error: message });
  }
});

router.get("/api/admin/forecast", requireAuth, (req, res) => {
  const requestedModel = String(req.query.model ?? "holt");
  const model: ForecastModel = requestedModel === "regression" ? "regression" : "holt";
  const offsetMs = 8 * 60 * 60 * 1000;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const historyWeeks = 12;
  const manilaNow = new Date(Date.now() + offsetMs);
  const dayStart = Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate());
  const daysSinceMonday = (new Date(dayStart).getUTCDay() + 6) % 7;
  const currentWeekStart = new Date(dayStart - daysSinceMonday * 24 * 60 * 60 * 1000);
  const historyStart = new Date(currentWeekStart.getTime() - historyWeeks * weekMs);
  const forecastStart = new Date(currentWeekStart.getTime() + weekMs);
  const toUtcSql = (manilaDate: Date) => new Date(manilaDate.getTime() - offsetMs)
    .toISOString().slice(0, 19).replace("T", " ");

  try {
    const rows = db.prepare(`
      SELECT
        date(created_at, '+8 hours', '-' || ((CAST(strftime('%w', created_at, '+8 hours') AS INTEGER) + 6) % 7) || ' days') AS week_start,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(weight_g, 0) ELSE 0 END) AS weight_g,
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS bottles,
        SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) AS print_jobs
      FROM transactions
      WHERE created_at >= ? AND created_at < ? AND type IN ('deposit', 'print')
      GROUP BY week_start
      ORDER BY week_start
    `).all(toUtcSql(historyStart), toUtcSql(currentWeekStart)) as Array<{
      week_start: string;
      weight_g: number;
      bottles: number;
      print_jobs: number;
    }>;

    const weekToDateRow = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(weight_g, 0) ELSE 0 END) AS weight_g,
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS bottles,
        SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) AS print_jobs
      FROM transactions
      WHERE created_at >= ? AND created_at < ? AND type IN ('deposit', 'print')
    `).get(toUtcSql(currentWeekStart), toUtcSql(new Date(Date.now() + offsetMs))) as {
      weight_g: number | null;
      bottles: number | null;
      print_jobs: number | null;
    };

    const lifetime = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS bottles,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(weight_g, 0) ELSE 0 END) AS weight_g,
        SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) AS print_jobs
      FROM transactions
      WHERE type IN ('deposit', 'print')
    `).get() as { bottles: number | null; weight_g: number | null; print_jobs: number | null };
    const actualPetKg = Math.round(((lifetime.weight_g ?? 0) / 1000) * 100) / 100;
    const actual = {
      bottles: lifetime.bottles ?? 0,
      petKg: actualPetKg,
      co2eKg: Math.round(actualPetKg * CO2E_KG_PER_KG_PET * 100) / 100,
      printJobsSubmitted: lifetime.print_jobs ?? 0,
    };

    const byWeek = new Map(rows.map(row => [row.week_start, row]));
    const history = Array.from({ length: historyWeeks }, (_, index) => {
      const week = new Date(historyStart.getTime() + index * weekMs);
      const weekStart = week.toISOString().slice(0, 10);
      const row = byWeek.get(weekStart);
      const petKg = (row?.weight_g ?? 0) / 1000;
      return {
        weekStart,
        bottles: row?.bottles ?? 0,
        petKg: Math.round(petKg * 100) / 100,
        co2eKg: Math.round(petKg * CO2E_KG_PER_KG_PET * 100) / 100,
        printJobsSubmitted: row?.print_jobs ?? 0,
      };
    });

    const activeWeeks = history.filter(week => week.petKg > 0).length;
    const usesObservedHistory = activeWeeks >= 6;
    const reportBaseline = Array(SEMESTER_WEEKS).fill(BASE_CASE_PET_KG_PER_SEMESTER / SEMESTER_WEEKS);
    const holtPetForecast = usesObservedHistory
      ? forecastWeeklyDemand(history.map(week => week.petKg), SEMESTER_WEEKS, "holt")
      : reportBaseline;
    const regressionPetForecast = usesObservedHistory
      ? forecastWeeklyDemand(history.map(week => week.petKg), SEMESTER_WEEKS, "regression")
      : reportBaseline;
    const petForecast = model === "holt" ? holtPetForecast : regressionPetForecast;
    const totalPetKg = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
    const modelComparison = {
      holt: totalPetKg(holtPetForecast),
      regression: totalPetKg(regressionPetForecast),
    };
    const jobsForecast = usesObservedHistory
      ? forecastWeeklyDemand(history.map(week => week.printJobsSubmitted), SEMESTER_WEEKS, model)
      : null;
    const projectedPetKg = Math.round(petForecast.reduce((sum, value) => sum + value, 0) * 100) / 100;
    const projectedPrintJobs = jobsForecast
      ? Math.round(jobsForecast.reduce((sum, value) => sum + value, 0))
      : null;

    const weeklyForecast = petForecast.map((petKg, index) => {
      const weekStart = new Date(forecastStart.getTime() + index * weekMs).toISOString().slice(0, 10);
      return {
        weekStart,
        petKg: Math.round(petKg * 100) / 100,
        co2eKg: Math.round(petKg * CO2E_KG_PER_KG_PET * 100) / 100,
        printJobsSubmitted: jobsForecast ? Math.round(jobsForecast[index]) : null,
      };
    });

    res.json({
      model: usesObservedHistory ? model : "report_baseline",
      requestedModel: model,
      basis: usesObservedHistory ? "observed_history" : "report_base_case",
      confidence: usesObservedHistory ? "provisional" : "baseline_only",
      historyWeeks,
      activeWeeks,
      semesterWeeks: SEMESTER_WEEKS,
      referencePricePerKg: REFERENCE_PET_PRICE_PHP_PER_KG,
      modelComparison,
      actual,
      weekToDate: {
        bottles: weekToDateRow.bottles ?? 0,
        petKg: Math.round(((weekToDateRow.weight_g ?? 0) / 1000) * 100) / 100,
        printJobsSubmitted: weekToDateRow.print_jobs ?? 0,
      },
      co2eKgPerKgPet: CO2E_KG_PER_KG_PET,
      assumptions: {
        baseCasePetKg: BASE_CASE_PET_KG_PER_SEMESTER,
        operatingCostsPhp: BASE_CASE_OPERATING_COSTS_PHP,
        optionalOrganizationPaperMarginPhp: OPTIONAL_ORG_PAPER_MARGIN_PHP,
      },
      projected: {
        petKg: model === "holt" ? modelComparison.holt : modelComparison.regression,
        co2eKg: Math.round(projectedPetKg * CO2E_KG_PER_KG_PET * 100) / 100,
        printJobsSubmitted: projectedPrintJobs,
        bottleRevenueAtSixPhpKg: Math.round(projectedPetKg * 6 * 100) / 100,
        kioskNetAtSixPhpKg: Math.round((projectedPetKg * 6 - BASE_CASE_OPERATING_COSTS_PHP) * 100) / 100,
      },
      scenarios: createFinancialScenarios(projectedPetKg, actualPetKg),
      history,
      weeklyForecast,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to calculate forecast: " + err.message });
  }
});

// ── Sensor Status (any authenticated admin) ────────────────────────────────
router.get("/api/admin/sensors/status", (_req, res) => {
  res.json(getSensorStatus());
});

// ── Sensor Calibration (any authenticated admin) ───────────────────────────
router.get("/api/admin/sensors/config", (_req, res) => {
  res.json(getCalibration());
});

router.get("/api/admin/print-pricing", (_req, res) => {
  res.json(getPrintPricing());
});

router.patch("/api/admin/print-pricing", requireSuperAdmin, (req: any, res) => {
  const { bwCreditsPerPage, colorCreditsPerPage } = req.body;
  if (!isValidPrintRate(bwCreditsPerPage) || !isValidPrintRate(colorCreditsPerPage)) {
    return res.status(400).json({ error: "Each print rate must be a whole number from 1 to 1,000,000 credits per page." });
  }

  const pricing = savePrintPricing({ bwCreditsPerPage, colorCreditsPerPage });
  logActivity(req.admin.username, "UPDATE_PRINT_PRICING",
    `Black-and-white: ${pricing.bwCreditsPerPage} credits/page; color: ${pricing.colorCreditsPerPage} credits/page`);
  res.json({ success: true, pricing });
});

router.patch("/api/admin/sensors/config", requireSuperAdmin, (req: any, res) => {
  try {
    const updated = updateCalibration(req.body);
    if (process.env.JAM_DETECTION_ENABLED === "true") notifyJamTofEmpty(updated.tofMountMm);
    logActivity(req.admin.username, "UPDATE_SENSOR_CONFIG", "Updated sensor calibration thresholds");
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid calibration data." });
  }
});
router.post("/api/admin/sensors/tof-calibrate", requireSuperAdmin, async (req: any, res) => {
  if (isKioskBusy()) return res.status(409).json({ error: "A deposit is in progress. Try again when the kiosk is idle." });
  const r = await requestTofCal();
  if (!r.ok) return res.status(500).json({ error: "No reading from the Arduino. Check the ToF sensor and that the kiosk is idle." });
  if (r.spread > 60) return res.status(422).json({ error: `Readings are unstable (spread ${(r.spread / 10).toFixed(1)} cm). Check the mount and try again.` });
  try {
    const config = updateCalibration({ tofMountMm: r.mean });
    if (process.env.JAM_DETECTION_ENABLED === "true") notifyJamTofEmpty(r.mean);
    logActivity(req.admin.username, "UPDATE_SENSOR_CONFIG", `Recalibrated ToF empty reading to ${(r.mean / 10).toFixed(1)} cm (spread ${(r.spread / 10).toFixed(1)} cm)`);
    res.json({ success: true, mean: r.mean, spread: r.spread, config });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/api/admin/user/:rfid/reset-pin", (req: any, res) => {
  const { rfid } = req.params;
  if (!db.prepare("SELECT rfid FROM users WHERE rfid = ?").get(rfid)) return res.status(404).json({ error: "User not found." });
  db.prepare("UPDATE users SET pin_needs_reset = 1, pin_fail_count = 0, pin_locked_until = NULL WHERE rfid = ?").run(rfid); clearVerified(rfid); 
  logActivity(req.admin.username, "RESET_USER_PIN", "Reset PIN for RFID " + rfid + " (user sets a new PIN on next tap)");
  res.json({ success: true });
});

router.post("/api/admin/backup/drive", requireSuperAdmin, async (req: any, res) => {
  const r = await runDriveBackup(req.admin.username);
  if (r.ok) res.json({ success: true }); else res.status(500).json({ error: r.message });
});

router.get("/api/admin/backup/drive-status", requireSuperAdmin, (_req, res) => {
  res.json(getBackupStatus());
});

router.get("/api/admin/backup/settings", requireSuperAdmin, (_req, res) => {
  res.json(getBackupSettings());
});

router.patch("/api/admin/backup/settings", requireSuperAdmin, (req: any, res) => {
  try {
    const time = String(req.body.time ?? "");
    const enabled = req.body.enabled !== false;
    saveBackupSettings(time, enabled);
    logActivity(req.admin.username, "UPDATE_BACKUP_SCHEDULE", enabled ? "Automatic Drive backup set to " + time + " (Manila time)" : "Automatic Drive backup turned off");
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/api/admin/backup/email", requireSuperAdmin, async (req: any, res) => {
  const r = await runEmailBackup(req.admin.username);
  if (r.ok) res.json({ success: true, message: r.message }); else res.status(500).json({ error: r.message });
});

router.get("/api/admin/backup/email-status", requireSuperAdmin, (_req, res) => {
  res.json(getEmailBackupStatus());
});

router.get("/api/admin/backup/email-settings", requireSuperAdmin, (_req, res) => {
  res.json(getEmailBackupSettings());
});

router.patch("/api/admin/backup/email-settings", requireSuperAdmin, (req: any, res) => {
  try {
    const time = String(req.body.time ?? "");
    const enabled = req.body.enabled !== false;
    saveEmailBackupSettings(time, enabled);
    logActivity(req.admin.username, "UPDATE_BACKUP_SCHEDULE", enabled ? "Automatic email backup set to " + time + " (Manila time)" : "Automatic email backup turned off");
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/api/admin/kiosk-controls", (_req, res) => {
  res.json(getControls());
});

router.get("/api/admin/jam", (_req, res) => {
  const jam = getJam();
  res.json({ ...jam, message: jam.active ? "Bottle jam detected" : "" });
});

router.post("/api/admin/jam/clear", async (req: any, res) => {
  const jam = getJam();
  if (!jam.active) return res.json({ success: true, cleared: true });

  const tofFaulted = getSensorStatus().sensors.tof?.state === "fault";
  if (req.body?.force === true) {
    if (!tofFaulted) return res.status(409).json({ error: "Force clearing is only allowed while ToF is faulted." });
    clearJam();
    setControl("deposit", false, "", req.admin.username);
    logActivity(req.admin.username, "JAM_CLEARED_FORCED", `Forced jam clear; source=${jam.source ?? "unknown"}; ToF unavailable`);
    void clearAlert("jam", "Bottle jam cleared", "The bottle jam was forcibly cleared by staff. Deposits are available again.");
    return res.json({ success: true, forced: true });
  }

  const result = await requestJamClear();
  if (!result.ok) {
    if ("busy" in result) {
      const cm = (result.mm / 10).toFixed(1);
      return res.status(409).json({ error: `Something is still detected in the chamber (${cm} cm). Remove it and try again.` });
    }
    if (tofFaulted) return res.status(409).json({ error: "ToF is unavailable. Use force only after checking that the chute is clear.", tofFaulted: true });
    return res.status(504).json({ error: "Could not confirm the chamber with ToF. Try again." });
  }

  clearJam();
  setControl("deposit", false, "", req.admin.username);
  logActivity(req.admin.username, "JAM_CLEARED", `Jam cleared after ToF chamber check; source=${jam.source ?? "unknown"}`);
  void clearAlert("jam", "Bottle jam cleared", "The bottle jam was cleared by staff. The chamber is empty and deposits are available again.");
  res.json({ success: true, cleared: true });
});

router.patch("/api/admin/kiosk-controls/:feature", requireSuperAdmin, (req: any, res) => {
  const feature = req.params.feature as Feature;
  if (!FEATURES.includes(feature)) return res.status(400).json({ error: "Unknown feature." });
  const disabled = req.body.disabled === true;
  const message = String(req.body.message ?? "");
  setControl(feature, disabled, message, req.admin.username);
  logActivity(req.admin.username, disabled ? "KIOSK_PART_DISABLED" : "KIOSK_PART_ENABLED",
    feature + (disabled ? " switched off. Message: " + (message.trim() || "(default)") : " switched back on"));
  res.json({ success: true, controls: getControls() });
});

// ── Power Control (Super Admin Only) ───────────────────────────────────────
const POWER_ARGS = {
  shutdown: "/usr/sbin/shutdown -h now",
  reboot:   "/usr/sbin/shutdown -r now",
} as const;

function handlePower(action: "shutdown" | "reboot") {
  return (req: any, res: any) => {
    if (isKioskBusy()) {
      return res.status(409).json({ error: "A deposit is in progress. Wait until the kiosk is idle and try again." });
    }

    // Pre-flight: confirm the sudoers rule exists BEFORE telling the panel it's shutting down.
    exec(`sudo -n -l ${POWER_ARGS[action]}`, (checkErr) => {
      if (checkErr) {
        return res.status(500).json({ error: "Power control isn't set up on this Pi (sudoers rule missing or path mismatch)." });
      }

      // Log first: once the command runs, this process is killed.
      logActivity(
        req.admin.username,
        action === "shutdown" ? "SHUTDOWN_PI" : "REBOOT_PI",
        `Requested ${action} from the admin panel`
      );

      // Reply first, then run the command after a short delay so the reply actually reaches the browser.
      res.json({ success: true, action });
      setTimeout(() => {
        exec(`sudo -n ${POWER_ARGS[action]}`, (err, _stdout, stderr) => {
          if (err) console.error(`[power] ${action} failed:`, stderr || err.message);
        });
      }, 2000);
    });
  };
}

router.post("/api/admin/system/shutdown", requireSuperAdmin, handlePower("shutdown"));
router.post("/api/admin/system/reboot",   requireSuperAdmin, handlePower("reboot"));

// ── Encrypted Backup Route (Super Admin Only) ──────────────────────────────
router.get("/api/admin/backup", requireSuperAdmin, (req: any, res) => {
  try {
    const rawData = {
      users: db.prepare("SELECT * FROM users").all(),
      transactions: db.prepare("SELECT * FROM transactions").all(),
      feedback: db.prepare("SELECT * FROM feedback").all(),
      activity_logs: db.prepare("SELECT * FROM activity_logs").all(),
      sensor_config: db.prepare("SELECT * FROM sensor_config").all(),
      print_pricing: db.prepare("SELECT * FROM print_pricing").all(),
      version: 1,
      exported_at: new Date().toISOString()
    };

    const plaintext = JSON.stringify(rawData);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", BACKUP_SECRET_KEY, iv);
    
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = JSON.stringify({
      iv: iv.toString("hex"),
      encrypted: encrypted.toString("hex"),
      tag: authTag.toString("hex")
    });

    logActivity(req.admin.username, "EXPORT_BACKUP", "Downloaded encrypted system backup");
    res.setHeader("Content-Type", "application/json");
    res.send(payload);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate backup: " + err.message });
  }
});

// ── Encrypted Restore Route (Super Admin Only) ─────────────────────────────
router.post("/api/admin/restore", requireSuperAdmin, (req: any, res) => {
  const { iv, encrypted, tag } = req.body;
  if (!iv || !encrypted || !tag) {
    return res.status(400).json({ error: "Invalid backup file structure." });
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm", 
      BACKUP_SECRET_KEY, 
      Buffer.from(iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "hex")),
      decipher.final()
    ]);

    const data = JSON.parse(decrypted.toString("utf8"));

    db.transaction(() => {
      db.prepare("DELETE FROM activity_logs").run();
      db.prepare("DELETE FROM feedback").run();
      db.prepare("DELETE FROM transactions").run();
      db.prepare("DELETE FROM users").run();
      db.prepare("DELETE FROM sensor_config").run();

      if (Array.isArray(data.users) && data.users.length > 0) {
        const sample = data.users[0];
        const cols = Object.keys(sample);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT INTO users (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.users) {
          stmt.run(cols.map(c => row[c]));
        }
      }

      if (Array.isArray(data.transactions) && data.transactions.length > 0) {
        const sample = data.transactions[0];
        const cols = Object.keys(sample);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT INTO transactions (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.transactions) {
          stmt.run(cols.map(c => row[c]));
        }
      }

      if (Array.isArray(data.feedback) && data.feedback.length > 0) {
        const sample = data.feedback[0];
        const cols = Object.keys(sample);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT INTO feedback (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.feedback) {
          stmt.run(cols.map(c => row[c]));
        }
      }

      if (Array.isArray(data.activity_logs) && data.activity_logs.length > 0) {
        const sample = data.activity_logs[0];
        const cols = Object.keys(sample);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT INTO activity_logs (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.activity_logs) {
          stmt.run(cols.map(c => row[c]));
        }
      }

      if (Array.isArray(data.sensor_config) && data.sensor_config.length > 0) {
        const sample = data.sensor_config[0];
        const cols = Object.keys(sample);
        const placeholders = cols.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT INTO sensor_config (${cols.join(", ")}) VALUES (${placeholders})`);
        for (const row of data.sensor_config) {
          stmt.run(cols.map(c => row[c]));
        }
      }

      if (Array.isArray(data.print_pricing) && data.print_pricing.length > 0) {
        const pricing = data.print_pricing[0];
        if (!isValidPrintRate(pricing.bw_credits_per_page) || !isValidPrintRate(pricing.color_credits_per_page)) {
          throw new Error("Backup contains invalid print pricing.");
        }
        db.prepare(`
          UPDATE print_pricing
          SET bw_credits_per_page = ?, color_credits_per_page = ?
          WHERE id = 1
        `).run(pricing.bw_credits_per_page, pricing.color_credits_per_page);
      }
    })();

    invalidateCalibrationCache();

    logActivity(req.admin.username, "RESTORE_BACKUP", "Successfully restored system state from backup file");
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: "Restore failed (file may be corrupted or secret key mismatch): " + err.message });
  }
});

// ── User Management Routes ────────────────────────────────────────────────
function pageLimit(req: any, def = 100) {
  const n = parseInt(String(req.query.limit ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50000) : def;
}

function listParams(req: any) {
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  const rawDate = String(req.query.date ?? "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : "";
  const filter = String(req.query.filter ?? "all").slice(0, 40);
  const like = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  return { q, like, date, filter, limit: pageLimit(req) };
}

router.get("/api/admin/users", (req, res) => {
  try {
    const { q, like, filter, limit } = listParams(req);
    const order =
      filter === "credits_asc"  ? "credits ASC, created_at DESC" :
      filter === "credits_desc" ? "credits DESC, created_at DESC" :
      "created_at DESC";
    res.json(db.prepare(`
      SELECT * FROM (
        SELECT rfid, surname, firstname, middlename, studentId, credits, created_at,
        TRIM(COALESCE(firstname, '') || ' ' || CASE WHEN middlename = '' THEN '' ELSE middlename || ' ' END || COALESCE(surname, '')) AS name
        FROM users
      )
      WHERE (@q = '' OR name LIKE @like ESCAPE '\\' OR studentId LIKE @like ESCAPE '\\' OR rfid LIKE @like ESCAPE '\\')
      ORDER BY ${order}
      LIMIT @limit
    `).all({ q, like, limit }));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch users: " + err.message });
  }
});

router.patch("/api/admin/user/:rfid", requireAuth, (req: any, res) => {
  const { rfid } = req.params;
  const { name, studentId } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid);
  if (!user) return res.status(404).json({ error: "User not found." });

  const nameParts = (name || "").trim().split(/\s+/);
  const firstname = nameParts[0] || "";
  const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
  const middlename = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "";

  db.prepare("UPDATE users SET firstname = ?, middlename = ?, surname = ?, studentId = ? WHERE rfid = ?")
    .run(firstname, middlename, surname, studentId || "", rfid);

  logActivity(req.admin.username, "EDIT_USER", `Updated user RFID ${rfid} (${name})`);
  res.json({ success: true });
});

router.post("/api/admin/user/:rfid/credits", requireSuperAdmin, (req: any, res) => {
  const { rfid } = req.params;
  const amount = Math.floor(Number(req.body.amount));
  const mode = req.body.mode === "remove" ? "remove" : "add";
  const reasonInput = String(req.body.reason ?? "").trim();

  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    return res.status(400).json({ error: "Enter a whole number of credits above 0." });
  }
  if (!reasonInput) return res.status(400).json({ error: "A reason is required for credit adjustments." });
  const reason = reasonInput.slice(0, 80);
  const user = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid) as any;
  if (!user) return res.status(404).json({ error: "User not found." });
  if (mode === "remove" && user.credits < amount) {
    return res.status(400).json({ error: `User only has ${user.credits} credits.` });
  }

  const delta = mode === "add" ? amount : -amount;
  const note = `Admin ${mode === "add" ? "added" : "removed"} credits${reason ? ": " + reason : ""} (by ${req.admin.username})`;
  try {
    db.transaction(() => {
      db.prepare("UPDATE users SET credits = credits + ? WHERE rfid = ?").run(delta, rfid);
      db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'adjust', ?, ?)").run(rfid, note, delta);
    })();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
  const updated = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid) as any;
  logActivity(req.admin.username, "ADJUST_CREDITS", `${delta > 0 ? "+" : ""}${delta} credits for RFID ${rfid}${reason ? " (" + reason + ")" : ""}`);
  res.json({ success: true, credits: updated.credits });
});

router.delete("/api/admin/user/:rfid", requireSuperAdmin, (req: any, res) => {
  const { rfid } = req.params;
  const user = db.prepare("SELECT rfid FROM users WHERE rfid = ?").get(rfid) as { rfid: string } | undefined;
  if (!user) return res.status(404).json({ error: "User not found." });

  db.transaction(() => {
    anonymizeRfidHistory(db, user);
    db.prepare("DELETE FROM users WHERE rfid = ?").run(rfid);
    db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)")
      .run(req.admin.username, "DELETE_USER", "Deleted user account; historical records were anonymized and preserved");
  })();
  res.json({ success: true });
});

router.get("/api/admin/transactions", (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT * FROM (
        SELECT t.*,
        CASE
          WHEN substr(t.rfid, 1, 8) = 'deleted_' THEN 'Deleted user'
          ELSE TRIM(COALESCE(u.firstname, '') || ' ' || CASE WHEN u.middlename = '' THEN '' ELSE u.middlename || ' ' END || COALESCE(u.surname, ''))
        END AS user_name
        FROM transactions t
        LEFT JOIN users u ON t.rfid = u.rfid
        WHERE t.type != 'register'
      )
      WHERE (@q = '' OR user_name LIKE @like ESCAPE '\\' OR rfid LIKE @like ESCAPE '\\' OR type LIKE @like ESCAPE '\\'
             OR size LIKE @like ESCAPE '\\' OR reject_reason LIKE @like ESCAPE '\\')
        AND (@filter = 'all'
             OR (@filter = 'deposit' AND type = 'deposit')
             OR (@filter = 'print' AND type = 'print')
             OR (@filter = 'transfer' AND type IN ('transfer_out', 'transfer_in'))
             OR (@filter = 'reject' AND type = 'reject'))
        AND (@date = '' OR date(created_at, '+8 hours') = @date)
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all(listParams(req)));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch transactions: " + err.message });
  }
});
// Automatically blend registration transactions into the Activity Logs feed
router.get("/api/admin/activity-logs", requireAuth, (req, res) => {
  try {
    const { q, like, date, limit } = listParams(req);
    const actions = String(req.query.actions ?? "")
      .split(",").map(a => a.trim()).filter(a => /^[A-Z_]+$/.test(a)).slice(0, 30);
    const params: Record<string, any> = { q, like, date, limit };
    actions.forEach((a, i) => { params["a" + i] = a; });
    const actionClause = actions.length
      ? `AND action IN (${actions.map((_, i) => "@a" + i).join(", ")})`
      : "";

    const rows = db.prepare(`
      SELECT * FROM (
        SELECT id, admin_user, action, details, created_at FROM activity_logs
        UNION ALL
        SELECT t.id + 100000, 'System Kiosk', 'REGISTER_USER',
               COALESCE(t.size, 'New user registered (RFID: ' || t.rfid || ')'), t.created_at
        FROM transactions t WHERE t.type = 'register'
      )
      WHERE (@q = '' OR admin_user LIKE @like ESCAPE '\\' OR action LIKE @like ESCAPE '\\' OR details LIKE @like ESCAPE '\\')
        AND (@date = '' OR date(created_at, '+8 hours') = @date)
        ${actionClause}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all(params);

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch activity logs: " + err.message });
  }
});
router.get("/api/admin/feedback", (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT id,
             CASE WHEN substr(rfid, 1, 8) = 'deleted_' THEN 'Deleted user' ELSE rfid END AS rfid,
             context, rating, comment, created_at
      FROM feedback
      WHERE (@q = '' OR context LIKE @like ESCAPE '\\' OR comment LIKE @like ESCAPE '\\' OR rfid LIKE @like ESCAPE '\\')
        AND (@filter = 'all' OR (@filter = '1' AND rating <= 2) OR CAST(rating AS TEXT) = @filter)
        AND (@date = '' OR date(created_at, '+8 hours') = @date)
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all(listParams(req)));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch feedback: " + err.message });
  }
});

router.get("/api/admin/admins", requireSuperAdmin, (req, res) => {
  try {
    const { q, like, filter, limit } = listParams(req);
    res.json(db.prepare(`
      SELECT id, username, email, role, password_changed, created_at FROM admins
      WHERE (@q = '' OR username LIKE @like ESCAPE '\\' OR email LIKE @like ESCAPE '\\')
        AND (@filter = 'all' OR role = @filter)
      ORDER BY created_at ASC, id ASC
      LIMIT @limit
    `).all({ q, like, filter, limit }));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch admins: " + err.message });
  }
});

router.post("/api/admin/admins", requireSuperAdmin, async (req: any, res) => {
  const { username, email, role } = req.body;
  if (!username) return res.status(400).json({ error: "Missing username." });
  
  const defaultPassword = "DefaultPass123!";
  const finalRole = role === "super_admin" ? "super_admin" : "admin";

  const existing = db.prepare("SELECT id FROM admins WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "Username already taken." });

  const hash = await bcrypt.hash(defaultPassword, 10);
  const info = db.prepare(
    "INSERT INTO admins (username, email, password_hash, role, password_changed) VALUES (?, ?, ?, ?, 0)"
  ).run(username, email ? email.trim() : "", hash, finalRole);

  logActivity(req.admin.username, "CREATE_ADMIN", `Created admin account "${username}" (${finalRole})`);
  res.json({ success: true, id: info.lastInsertRowid, defaultPassword });
});

router.patch("/api/admin/admins/:id", requireAuth, async (req: any, res) => {
  const targetId = parseInt(req.params.id);
  const { username, email, password, currentPassword, role } = req.body;

  if (req.admin.role !== "super_admin" && req.admin.adminId !== targetId) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  const target = db.prepare("SELECT * FROM admins WHERE id = ?").get(targetId) as any;
  if (!target) return res.status(404).json({ error: "Admin not found." });

  if (password) {
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (req.admin.adminId === targetId) {
      if (!currentPassword) return res.status(400).json({ error: "Enter your current password to change it." });
      const currentPasswordMatches = await bcrypt.compare(currentPassword, target.password_hash);
      if (!currentPasswordMatches) return res.status(403).json({ error: "Current password is incorrect." });
    }
  }

  if (username && username !== target.username) {
    const clash = db.prepare("SELECT id FROM admins WHERE username = ? AND id != ?").get(username, targetId);
    if (clash) return res.status(409).json({ error: "Username already taken." });
    db.prepare("UPDATE admins SET username = ? WHERE id = ?").run(username, targetId);
  }

  if (email !== undefined) {
    db.prepare("UPDATE admins SET email = ? WHERE id = ?").run(email ? email.trim() : "", targetId);
  }

  if (role && req.admin.role === "super_admin") {
    db.prepare("UPDATE admins SET role = ? WHERE id = ?").run(role === "super_admin" ? "super_admin" : "admin", targetId);
  }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare("UPDATE admins SET password_hash = ?, password_changed = 1 WHERE id = ?").run(hash, targetId);
  }

  logActivity(req.admin.username, "EDIT_ADMIN", `Updated admin account ID ${targetId}`);
  res.json({ success: true });
});

router.delete("/api/admin/admins/:id", requireSuperAdmin, (req: any, res: any) => {
  const id = parseInt(req.params.id);
  if (id === req.admin.adminId) return res.status(400).json({ error: "Cannot delete your own account." });

  db.prepare("DELETE FROM admins WHERE id = ?").run(id);
  logActivity(req.admin.username, "DELETE_ADMIN", `Deleted admin account ID ${id}`);
  res.json({ success: true });
});

export default router;