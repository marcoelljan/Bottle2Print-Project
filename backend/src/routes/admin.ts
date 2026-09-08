import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { db } from "../db";

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

let failedAttempts = 0;
let lockoutUntil = 0;

router.post("/api/admin/check-username", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username required." });
  const admin = db.prepare("SELECT id FROM admins WHERE username = ?").get(username);
  if (!admin) return res.status(404).json({ error: "Username not found." });
  res.json({ exists: true });
});

// ── Secure Forgot Password Route (Exact Email Validation) ──────────────────
router.post("/api/admin/forgot-password", async (req, res) => {
  const { username, email } = req.body;
  if (!username || !email) {
    return res.status(400).json({ error: "Both username and registered email are required." });
  }

  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username.trim()) as any;
  
  // Verify user exists and the provided email matches the exact email saved in their account
  if (!admin || !admin.email || admin.email.toLowerCase() !== email.trim().toLowerCase()) {
    return res.status(400).json({ error: "Username or registered email does not match our records." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins
  resetTokens.set(token, { adminId: admin.id, expiresAt });

  const resetLink = `http://localhost:5173/?reset_token=${token}`;

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
  if (Date.now() < lockoutUntil) {
    return res.status(429).json({ error: "Too many failed attempts. Try again later.", lockoutUntil });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing username or password." });

  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username) as any;
  const match = admin ? await bcrypt.compare(password, admin.password_hash) : false;

  if (!match) {
    failedAttempts++;
    if (failedAttempts >= 5) {
      lockoutUntil = Date.now() + 3 * 60 * 1000; 
      failedAttempts = 0;
      return res.status(429).json({ error: "Too many failed attempts. Try again later.", lockoutUntil });
    }
    return res.status(403).json({ error: "Incorrect username or password." });
  }

  failedAttempts = 0;
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

router.use(requireAuth);

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

router.get("/api/admin/admins", requireSuperAdmin, (_req, res) => {
  res.json(db.prepare("SELECT id, username, email, role, password_changed, created_at FROM admins ORDER BY created_at ASC").all());
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
  const { username, email, password, role } = req.body;

  if (req.admin.role !== "super_admin" && req.admin.adminId !== targetId) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  const target = db.prepare("SELECT * FROM admins WHERE id = ?").get(targetId) as any;
  if (!target) return res.status(404).json({ error: "Admin not found." });

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
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const hash = await bcrypt.hash(password, 10);
    db.prepare("UPDATE admins SET password_hash = ?, password_changed = 1 WHERE id = ?").run(hash, targetId);
  }

  logActivity(req.admin.username, "EDIT_ADMIN", `Updated admin account ID ${targetId}`);
  res.json({ success: true });
});

router.delete("/api/admin/admins/:id", requireSuperAdmin, (req: any, res) => {
  const id = parseInt(req.params.id);
  if (id === req.admin.adminId) return res.status(400).json({ error: "Cannot delete your own account." });

  db.prepare("DELETE FROM admins WHERE id = ?").run(id);
  logActivity(req.admin.username, "DELETE_ADMIN", `Deleted admin account ID ${id}`);
  res.json({ success: true });
});

router.get("/api/admin/users", (_req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY created_at DESC").all());
});

router.get("/api/admin/transactions", (_req, res) => {
  res.json(db.prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100").all());
});

router.get("/api/admin/activity-logs", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100").all());
});

router.get("/api/admin/feedback", (_req, res) => {
  res.json(db.prepare("SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100").all());
});

export default router;