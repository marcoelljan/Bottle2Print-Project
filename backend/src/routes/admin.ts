import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "../db";

const router = Router();

// ── Database Schema Safeguard for password_changed flag ─────────────────────
try {
  db.exec(`ALTER TABLE admins ADD COLUMN password_changed INTEGER NOT NULL DEFAULT 1;`);
} catch (e) {
  // Column already exists, ignore safely
}

// ── one-time migration: seed a super_admin from the old ADMIN_PASSWORD_HASH ──
const LEGACY_ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
(function seedLegacySuperAdmin() {
  const count = (db.prepare("SELECT COUNT(*) as c FROM admins").get() as any).c;
  if (count === 0) {
    if (LEGACY_ADMIN_PASSWORD_HASH) {
      db.prepare(
        "INSERT INTO admins (username, password_hash, role, password_changed) VALUES (?, ?, 'super_admin', 1)"
      ).run("admin", LEGACY_ADMIN_PASSWORD_HASH);
      console.log("✅ Seeded initial super_admin account 'admin' from ADMIN_PASSWORD_HASH in .env.");
    } else {
      console.warn("⚠️  No admins exist and ADMIN_PASSWORD_HASH is not set — nobody can log in.");
    }
  }
})();

// ── in-memory session store ────────────────────────────────────────────────
interface Session { adminId: number; username: string; role: "admin" | "super_admin"; passwordChanged: boolean; }
const activeSessions = new Map<string, Session>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

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
  if (!session) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  req.admin = session;
  next();
}

function requireSuperAdmin(req: any, res: any, next: any) {
  if (req.admin?.role !== "super_admin") {
    return res.status(403).json({ error: "Super-admin access required." });
  }
  next();
}

// ── basic login rate limiting ──────────────────────────────────────────────
let failedAttempts = 0;
let lockoutUntil = 0;

// ── Check if username exists before prompting password ─────────────────────
router.post("/api/admin/check-username", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username required." });
  
  const admin = db.prepare("SELECT id FROM admins WHERE username = ?").get(username);
  if (!admin) {
    return res.status(404).json({ error: "Username not found." });
  }
  res.json({ exists: true });
});

// ── password login ──────────────────────────────────────────────────────────
// ── password login ──────────────────────────────────────────────────────────
router.post("/api/admin/login", async (req, res) => {
  if (Date.now() < lockoutUntil) {
    // UPDATE: Send the lockoutUntil timestamp to the frontend
    return res.status(429).json({ 
      error: "Too many failed attempts. Try again later.",
      lockoutUntil 
    });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password." });
  }

  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username) as any;
  const match = admin ? await bcrypt.compare(password, admin.password_hash) : false;

  if (!match) {
    failedAttempts++;
    if (failedAttempts >= 5) {
      // UPDATE: Changed from 5 * 60 * 1000 to 3 * 60 * 1000 (3 minutes)
      lockoutUntil = Date.now() + 3 * 60 * 1000; 
      failedAttempts = 0;
      
      // Send the lockout timestamp immediately on the 5th fail
      return res.status(429).json({ 
        error: "Too many failed attempts. Try again later.",
        lockoutUntil
      });
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
    success: true, 
    token, 
    adminId: admin.id,
    username: admin.username, 
    role: admin.role,
    passwordChanged: admin.password_changed === 1 
  });
});

// ── everything below this line requires a valid session token ──────────────
router.use(requireAuth);

router.get("/api/admin/me", (req: any, res) => {
  const admin = db.prepare("SELECT password_changed FROM admins WHERE id = ?").get(req.admin.adminId) as any;
  res.json({ 
    username: req.admin.username, 
    role: req.admin.role,
    passwordChanged: admin ? admin.password_changed === 1 : true
  });
});

// Any logged-in admin can change their own password
router.post("/api/admin/me/password", async (req: any, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Missing current or new password." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.adminId) as any;
  const match = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!match) return res.status(403).json({ error: "Current password is incorrect." });

  const newHash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE admins SET password_hash = ?, password_changed = 1 WHERE id = ?").run(newHash, req.admin.adminId);
  
  // Update active session state flag
  req.admin.passwordChanged = true;
  
  res.json({ success: true });
});

// ── admin account management (super_admin only) ─────────────────────────────
router.get("/api/admin/admins", requireSuperAdmin, (_req, res) => {
  res.json(
    db.prepare("SELECT id, username, role, password_changed, created_at FROM admins ORDER BY created_at ASC").all()
  );
});

router.post("/api/admin/admins", requireSuperAdmin, async (req, res) => {
  const { username, role } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Missing username." });
  }
  
  const defaultPassword = "DefaultPass123!";
  const finalRole = role === "super_admin" ? "super_admin" : "admin";

  const existing = db.prepare("SELECT id FROM admins WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "Username already taken." });

  const hash = await bcrypt.hash(defaultPassword, 10);
  const info = db.prepare(
    "INSERT INTO admins (username, password_hash, role, password_changed) VALUES (?, ?, ?, 0)"
  ).run(username, hash, finalRole);

  res.json({ success: true, id: info.lastInsertRowid });
});

router.patch("/api/admin/admins/:id", requireAuth, async (req: any, res) => {
  const targetId = parseInt(req.params.id);
  const { username, password, role } = req.body;

  // Rule: Regular admins can ONLY edit their own account, super_admin can edit anyone
  if (req.admin.role !== "super_admin" && req.admin.adminId !== targetId) {
    return res.status(403).json({ error: "Unauthorized: You can only edit your own account." });
  }

  const target = db.prepare("SELECT * FROM admins WHERE id = ?").get(targetId) as any;
  if (!target) return res.status(404).json({ error: "Admin not found." });

  // Regular admins cannot change roles
  if (req.admin.role !== "super_admin" && role && role !== target.role) {
    return res.status(403).json({ error: "Unauthorized: Only super admins can modify roles." });
  }

  if (role && role !== "super_admin" && target.role === "super_admin") {
    const superAdminCount = (db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super_admin'").get() as any).c;
    if (superAdminCount <= 1) {
      return res.status(400).json({ error: "Cannot demote the last remaining super-admin." });
    }
  }

  if (username && username !== target.username) {
    const clash = db.prepare("SELECT id FROM admins WHERE username = ? AND id != ?").get(username, targetId);
    if (clash) return res.status(409).json({ error: "Username already taken." });
    db.prepare("UPDATE admins SET username = ? WHERE id = ?").run(username, targetId);
  }

  if (role && req.admin.role === "super_admin") {
    db.prepare("UPDATE admins SET role = ? WHERE id = ?").run(role === "super_admin" ? "super_admin" : "admin", targetId);
  }

  if (password) {
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const hash = await bcrypt.hash(password, 10);
    db.prepare("UPDATE admins SET password_hash = ?, password_changed = 1 WHERE id = ?").run(hash, targetId);
  }

  res.json({ success: true });
});

router.delete("/api/admin/admins/:id", requireSuperAdmin, (req: any, res) => {
  const id = parseInt(req.params.id);

  if (id === req.admin.adminId) {
    return res.status(400).json({ error: "You can't delete your own account while logged in." });
  }

  const target = db.prepare("SELECT * FROM admins WHERE id = ?").get(id) as any;
  if (!target) return res.status(404).json({ error: "Admin not found." });

  if (target.role === "super_admin") {
    const superAdminCount = (db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super_admin'").get() as any).c;
    if (superAdminCount <= 1) {
      return res.status(400).json({ error: "Cannot delete the last remaining super-admin." });
    }
  }

  db.prepare("DELETE FROM admins WHERE id = ?").run(id);
  res.json({ success: true });
});

// ── Super-Admin Database Backup Export Route ──────────────────────────────
router.get("/api/admin/backup", requireSuperAdmin, (_req, res) => {
  try {
    const users = db.prepare("SELECT * FROM users").all();
    const transactions = db.prepare("SELECT * FROM transactions").all();
    const feedback = db.prepare("SELECT * FROM feedback").all();
    const admins = db.prepare("SELECT id, username, password_hash, role, password_changed, created_at FROM admins").all();

    const backupData = {
      exportDate: new Date().toISOString(),
      system: "Bottle2Print Kiosk",
      counts: {
        users: users.length,
        transactions: transactions.length,
        feedback: feedback.length,
        admins: admins.length
      },
      data: {
        users,
        transactions,
        feedback,
        admins
      }
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=kiosk_backup_${Date.now()}.json`);
    res.status(200).send(JSON.stringify(backupData, null, 2));
  } catch (err: any) {
    res.status(500).json({ error: "Backup failed: " + err.message });
  }
});

// ── Super-Admin Database Restore / Import Route (Safeguarded) ─────────────
router.post("/api/admin/restore", requireSuperAdmin, (req: any, res) => {
  const { data } = req.body;
  if (!data || !data.users || !data.transactions) {
    return res.status(400).json({ error: "Invalid backup file structure." });
  }

  const restoreTxn = db.transaction(() => {
    // 1. Clear core application data tables safely
    db.prepare("DELETE FROM transactions").run();
    db.prepare("DELETE FROM users").run();
    db.prepare("DELETE FROM feedback").run();

    // 2. Restore Users
    const insertUser = db.prepare("INSERT INTO users (rfid, name, studentId, credits, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const u of data.users) {
      insertUser.run(u.rfid, u.name, u.studentId, u.credits, u.created_at);
    }

    // 3. Restore Transactions
    const insertTxn = db.prepare("INSERT INTO transactions (id, rfid, type, size, height_mm, weight_g, co2_saved_g, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const t of data.transactions) {
      insertTxn.run(t.id, t.rfid, t.type, t.size ?? null, t.height_mm ?? null, t.weight_g ?? null, t.co2_saved_g ?? null, t.credits, t.created_at);
    }

    // 4. Restore Feedback
    if (data.feedback && data.feedback.length > 0) {
      const insertFb = db.prepare("INSERT INTO feedback (id, rfid, context, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const f of data.feedback) {
        insertFb.run(f.id, f.rfid, f.context, f.rating, f.comment, f.created_at);
      }
    }

    // 5. Restore Admins (Preserve the currently logged-in super admin session if not present in backup)
    if (data.admins && data.admins.length > 0) {
      db.prepare("DELETE FROM admins").run();
      const insertAdmin = db.prepare("INSERT INTO admins (id, username, password_hash, role, password_changed, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const a of data.admins) {
        insertAdmin.run(a.id, a.username, a.password_hash, a.role, a.password_changed ?? 1, a.created_at);
      }
    }
  });

  try {
    restoreTxn();
    // Ensure the currently logged-in super admin is still guaranteed to exist in the database after restore
    const currentAdminExists = db.prepare("SELECT id FROM admins WHERE id = ?").get(req.admin.adminId);
    if (!currentAdminExists) {
      // Re-insert current session admin as a failsafe so they don't get locked out
      db.prepare(
        "INSERT OR IGNORE INTO admins (id, username, password_hash, role, password_changed) VALUES (?, ?, 'super_admin', 1)"
      ).run(req.admin.adminId, req.admin.username);
    }

    res.json({ success: true, message: "System successfully restored from backup." });
  } catch (err: any) {
    res.status(500).json({ error: "Restore failed: " + err.message });
  }
});

// ── existing kiosk data routes ──────────────────────────────────────────────
router.get("/api/admin/users", (_req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY created_at DESC").all());
});

router.get("/api/admin/transactions", (_req, res) => {
  res.json(db.prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100").all());
});

router.get("/api/admin/feedback", (_req, res) => {
  res.json(db.prepare("SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100").all());
});

router.post("/api/admin/user/:rfid/reset-credits", (req, res) => {
  db.prepare("UPDATE users SET credits = 0 WHERE rfid = ?").run(req.params.rfid);
  res.json({ success: true });
});

router.delete("/api/admin/user/:rfid", (req, res) => {
  db.prepare("DELETE FROM users WHERE rfid = ?").run(req.params.rfid);
  db.prepare("DELETE FROM transactions WHERE rfid = ?").run(req.params.rfid);
  res.json({ success: true });
});

router.post("/api/admin/user/:rfid/add-credits", (req, res) => {
  const { amount } = req.body;
  const parsed = parseInt(amount);
  if (isNaN(parsed) || parsed <= 0)
    return res.status(400).json({ error: "Invalid amount." });

  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(req.params.rfid) as any;
  if (!user) return res.status(404).json({ error: "User not found." });

  db.prepare("UPDATE users SET credits = credits + ? WHERE rfid = ?").run(parsed, req.params.rfid);
  db.prepare(`
    INSERT INTO transactions (rfid, type, credits)
    VALUES (?, 'admin_credit', ?)
  `).run(req.params.rfid, parsed);

  const updated = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(req.params.rfid) as any;
  res.json({ success: true, credits: updated.credits });
});

export default router;