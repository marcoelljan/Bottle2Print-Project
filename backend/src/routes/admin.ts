import { Router } from "express";
import { db } from "../db";

const router = Router();

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

const ADMIN_RFID = "C9137114"; // replace with your actual card value

// verify if a tapped card is admin
router.post("/api/admin/verify", (req, res) => {
  const { rfid } = req.body;
  if (!rfid) return res.status(400).json({ error: "No RFID provided." });
  if (rfid.toUpperCase() !== ADMIN_RFID.toUpperCase()) {
    return res.status(403).json({ error: "Not an admin card." });
  }
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