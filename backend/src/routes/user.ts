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
    "SELECT * FROM transactions WHERE rfid = ? ORDER BY created_at DESC"
  ).all(req.params.rfid);
  res.json(rows);
});

// ── Search user by name or student ID for transfers ──
router.get("/api/user/search", (req, res) => {
  const { query, senderRfid } = req.query;
  if (!query || !senderRfid) {
    return res.status(400).json({ error: "Missing search parameters." });
  }

  const searchTerm = `%${query}%`;
  const users = db.prepare(`
    SELECT rfid, name, studentId, credits 
    FROM users 
    WHERE rfid != ? AND (name LIKE ? OR studentId LIKE ?)
    LIMIT 5
  `).all(senderRfid, searchTerm, searchTerm);

  res.json(users);
});

router.post("/api/user/register", (req, res) => {
  const { rfid, name, studentId } = req.body;
  if (!rfid || !name || !studentId) return res.status(400).json({ error: "Missing fields." });

  const existing = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  
  const registerTxn = db.transaction(() => {
    if (existing) {
      db.prepare("UPDATE users SET name = ?, studentId = ? WHERE rfid = ?").run(name, studentId, rfid);
    } else {
      db.prepare("INSERT INTO users (rfid, name, studentId) VALUES (?, ?, ?)").run(rfid, name, studentId);
      // Include name and student ID in the registration log detail
      const detailText = `Registered: ${name} (${studentId})`;
      db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'register', ?, 0)").run(rfid, detailText);
    }
  });

  try {
    registerTxn();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Registration failed: " + err.message });
  }
});

// ── Deposit route with Fraud Prevention & Environmental Impact Tracking ──
router.post("/api/user/deposit", (req, res) => {
  const { rfid, size, height_mm, weight_g, credits } = req.body;
  if (!rfid || weight_g === undefined || height_mm === undefined) {
    return res.status(400).json({ error: "Missing deposit parameters." });
  }

  // 1. Fraud Prevention: Check for rapid duplicate scans of the exact same bottle profile (within 10 seconds)
  const recentDuplicate = db.prepare(`
    SELECT id FROM transactions 
    WHERE rfid = ? AND type = 'deposit' 
      AND ABS(weight_g - ?) < 2 
      AND ABS(height_mm - ?) < 5 
      AND datetime(created_at) >= datetime('now', '-10 seconds')
  `).get(rfid, weight_g, height_mm);

  if (recentDuplicate) {
    return res.status(400).json({ 
      error: "Fraud Prevention: Duplicate bottle detected. Please insert a different bottle." 
    });
  }

  // 2. Environmental Impact Calculation (PET plastic recycling: ~3kg CO2 saved per 1kg of plastic)
  const plasticKg = weight_g / 1000;
  const co2SavedG = plasticKg * 3000; // CO2 saved in grams

  // 3. Record transaction and update user credits
  const creditAmount = credits ?? 1;

  const insertTxn = db.prepare(`
    INSERT INTO transactions (rfid, type, size, height_mm, weight_g, co2_saved_g, credits)
    VALUES (?, 'deposit', ?, ?, ?, ?, ?)
  `);
  
  const updateUser = db.prepare(`
    UPDATE users SET credits = credits + ? WHERE rfid = ?
  `);

  const transaction = db.transaction(() => {
    insertTxn.run(rfid, size ?? "Standard", height_mm, weight_g, co2SavedG, creditAmount);
    updateUser.run(creditAmount, rfid);
  });

  try {
    transaction();
    const updatedUser = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid) as any;
    res.json({ 
      success: true, 
      credits: updatedUser.credits,
      environmentalImpact: {
        plasticKg: plasticKg.toFixed(3),
        co2SavedG: co2SavedG.toFixed(1)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to process deposit: " + err.message });
  }
});

// ── Credit Transfer Route ──────────────────────────────────────────────────
router.post("/api/user/transfer", (req, res) => {
  const { senderRfid, recipientRfid, amount } = req.body;
  const transferAmount = parseInt(amount);

  if (!senderRfid || !recipientRfid || isNaN(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ error: "Invalid transfer parameters." });
  }

  if (senderRfid === recipientRfid) {
    return res.status(400).json({ error: "You cannot transfer credits to yourself." });
  }

  const sender = db.prepare("SELECT * FROM users WHERE rfid = ?").get(senderRfid) as any;
  const recipient = db.prepare("SELECT * FROM users WHERE rfid = ?").get(recipientRfid) as any;

  if (!sender) return res.status(404).json({ error: "Sender account not found." });
  if (!recipient) return res.status(404).json({ error: "Recipient account not found." });

  if (sender.credits < transferAmount) {
    return res.status(400).json({ error: "Insufficient credits for transfer." });
  }

  const deductSender = db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ?");
  const addRecipient = db.prepare("UPDATE users SET credits = credits + ? WHERE rfid = ?");
  const logSenderTxn = db.prepare(`
    INSERT INTO transactions (rfid, type, credits) VALUES (?, 'transfer_out', ?)
  `);
  const logRecipientTxn = db.prepare(`
    INSERT INTO transactions (rfid, type, credits) VALUES (?, 'transfer_in', ?)
  `);

  const transferTxn = db.transaction(() => {
    deductSender.run(transferAmount, senderRfid);
    addRecipient.run(transferAmount, recipientRfid);
    logSenderTxn.run(senderRfid, transferAmount);
    logRecipientTxn.run(recipientRfid, transferAmount);
  });

  try {
    transferTxn();
    const updatedSender = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(senderRfid) as any;
    res.json({ success: true, newCredits: updatedSender.credits });
  } catch (err: any) {
    res.status(500).json({ error: "Transfer failed: " + err.message });
  }
});

export default router;