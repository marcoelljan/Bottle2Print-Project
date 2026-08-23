import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "../db";

const router = Router();

// ── simple in-memory session store (fine for a single-admin kiosk) ─────────
const activeSessions = new Set<string>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function issueToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.add(token);
  setTimeout(() => activeSessions.delete(token), SESSION_TTL_MS);
  return token;
}

function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  next();
}

// ── basic login rate limiting (per-process, resets on restart) ─────────────
let failedAttempts = 0;
let lockoutUntil = 0;

// ── password login (primary path — used for remote/Tailscale access) ───────
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
if (!ADMIN_PASSWORD_HASH) {
  console.warn("⚠️  ADMIN_PASSWORD_HASH not set in .env — password login will reject everything.");
}

router.post("/api/admin/login", async (req, res) => {
  if (Date.now() < lockoutUntil) {
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });
  }

  const { password } = req.body;
  if (!password || !ADMIN_PASSWORD_HASH) {
    return res.status(400).json({ error: "Missing password or server not configured." });
  }

  const match = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  if (!match) {
    failedAttempts++;
    if (failedAttempts >= 5) {
      lockoutUntil = Date.now() + 5 * 60 * 1000; // 5 min lockout
      failedAttempts = 0;
    }
    return res.status(403).json({ error: "Incorrect password." });
  }

  failedAttempts = 0;
  const token = issueToken();
  res.json({ success: true, token });
});

// ── RFID tap login (kept for on-site convenience at the physical kiosk) ─────
const ADMIN_RFID = process.env.ADMIN_RFID || "";
if (!ADMIN_RFID) {
  console.warn("⚠️  ADMIN_RFID not set in .env — RFID admin login will reject all cards.");
}

router.post("/api/admin/verify", (req, res) => {
  const { rfid } = req.body;
  if (!rfid) return res.status(400).json({ error: "No RFID provided." });
  if (!ADMIN_RFID || rfid.toUpperCase() !== ADMIN_RFID.toUpperCase()) {
    return res.status(403).json({ error: "Not an admin card." });
  }
  const token = issueToken();
  res.json({ success: true, token });
});

// ── everything below this line requires a valid session token ──────────────
router.use(requireAuth);

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

// add credits manually to a user
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