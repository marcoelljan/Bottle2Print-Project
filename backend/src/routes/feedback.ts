import { Router } from "express";
import { db } from "../db";

const router = Router();

router.post("/api/feedback", (req, res) => {
  const { rfid, context, rating, comment } = req.body;
  if (!context || !rating) return res.status(400).json({ error: "Missing context or rating." });

  db.prepare(`
    INSERT INTO feedback (rfid, context, rating, comment)
    VALUES (?, ?, ?, ?)
  `).run(rfid ?? null, context, rating, comment ?? "");

  res.json({ success: true });
});

export default router;