import { Router } from "express";
import { db } from "../db";

const router = Router();

router.get("/api/user/:rfid", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(req.params.rfid);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(user);
});

router.get("/api/user/:rfid/transactions", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM transactions WHERE rfid = ? ORDER BY created_at DESC LIMIT 10"
  ).all(req.params.rfid);
  res.json(rows);
});

router.post("/api/user/register", (req, res) => {
  const { rfid, name, studentId } = req.body;
  if (!rfid || !name || !studentId) return res.status(400).json({ error: "Missing fields." });

  const existing = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  if (existing) {
    db.prepare("UPDATE users SET name = ?, studentId = ? WHERE rfid = ?").run(name, studentId, rfid);
  } else {
    db.prepare("INSERT INTO users (rfid, name, studentId) VALUES (?, ?, ?)").run(rfid, name, studentId);
  }
  res.json({ success: true });
});

export default router;