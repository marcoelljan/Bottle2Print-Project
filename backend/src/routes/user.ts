import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "../db";

const router = Router();

const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 20 * 1000; // 20 second cooldown

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

// ── Search user by name components or student ID for transfers ──
router.get("/api/user/search", (req, res) => {
  const { query, senderRfid } = req.query;
  if (!query || !senderRfid) {
    return res.status(400).json({ error: "Missing search parameters." });
  }

  const searchTerm = `%${query}%`;
  const users = db.prepare(`
    SELECT rfid, surname, firstname, middlename, studentId, credits 
    FROM users 
    WHERE rfid != ? AND (surname LIKE ? OR firstname LIKE ? OR middlename LIKE ? OR studentId LIKE ?)
    LIMIT 5
  `).all(senderRfid, searchTerm, searchTerm, searchTerm, searchTerm);

  res.json(users);
});

// ── Registration — supports separated name columns & 6-digit PIN hashing ──
router.post("/api/user/register", async (req, res) => {
  const { rfid, surname, firstname, middlename, studentId, pin } = req.body;
  if (!rfid || !surname || !firstname || !studentId) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  if (!pin || !/^\d{6}$/.test(String(pin))) {
    return res.status(400).json({ error: "PIN must be exactly 6 digits." });
  }

  const existing = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;

  let pinHash: string;
  try {
    pinHash = await bcrypt.hash(String(pin), 10);
  } catch (err: any) {
    return res.status(500).json({ error: "Could not process PIN: " + err.message });
  }

  const cleanSurname = String(surname).trim();
  const cleanFirstname = String(firstname).trim();
  const cleanMiddlename = middlename ? String(middlename).trim() : "";
  const cleanStudentId = String(studentId).trim();

  const registerTxn = db.transaction((hash: string) => {
    if (existing) {
      db.prepare(`
        UPDATE users
        SET surname = ?, firstname = ?, middlename = ?, studentId = ?, pin_hash = ?, pin_fail_count = 0, pin_locked_until = NULL
        WHERE rfid = ?
      `).run(cleanSurname, cleanFirstname, cleanMiddlename, cleanStudentId, hash, rfid);
    } else {
      db.prepare(
        "INSERT INTO users (rfid, surname, firstname, middlename, studentId, pin_hash) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(rfid, cleanSurname, cleanFirstname, cleanMiddlename, cleanStudentId, hash);
      
      const detailText = `Registered: ${cleanSurname}, ${cleanFirstname} ${cleanMiddlename} (${cleanStudentId})`.trim();
      db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'register', ?, 0)").run(rfid, detailText);
    }
  });

  try {
    registerTxn(pinHash);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Registration failed: " + err.message });
  }
});

// ── PIN verification — 3 attempts, then a 20-second cooldown ───────────────
router.post("/api/user/verify-pin", async (req, res) => {
  const { rfid, pin } = req.body;
  if (!rfid || !pin) return res.status(400).json({ error: "Missing rfid or pin." });

  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  if (!user) return res.status(404).json({ error: "User not found." });

  if (!user.pin_hash) {
    return res.status(400).json({ error: "No PIN set for this account. Please contact an admin." });
  }

  if (user.pin_locked_until) {
    const remainingMs = new Date(user.pin_locked_until).getTime() - Date.now();
    if (remainingMs > 0) {
      return res.status(423).json({
        error: "Too many incorrect attempts. Please wait before trying again.",
        lockedOut: true,
        secondsRemaining: Math.ceil(remainingMs / 1000),
      });
    }
  }

  let match = false;
  try {
    match = await bcrypt.compare(String(pin), user.pin_hash);
  } catch {
    return res.status(500).json({ error: "Could not verify PIN." });
  }

  if (match) {
    db.prepare("UPDATE users SET pin_fail_count = 0, pin_locked_until = NULL WHERE rfid = ?").run(rfid);
    return res.json({ success: true });
  }

  const newFailCount = (user.pin_fail_count ?? 0) + 1;

  if (newFailCount >= PIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
    db.prepare("UPDATE users SET pin_fail_count = 0, pin_locked_until = ? WHERE rfid = ?").run(lockedUntil, rfid);
    return res.status(423).json({
      error: "Too many incorrect attempts. Please wait 20 seconds before trying again.",
      lockedOut: true,
      secondsRemaining: 20,
    });
  }

  db.prepare("UPDATE users SET pin_fail_count = ? WHERE rfid = ?").run(newFailCount, rfid);
  return res.status(401).json({
    error: "Incorrect PIN.",
    attemptsRemaining: PIN_MAX_ATTEMPTS - newFailCount,
  });
});

// ── Deposit route with Fraud Prevention & Environmental Impact Tracking ──
router.post("/api/user/deposit", (req, res) => {
  const { rfid, size, height_mm, weight_g, credits } = req.body;
  if (!rfid || weight_g === undefined || height_mm === undefined) {
    return res.status(400).json({ error: "Missing deposit parameters." });
  }

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

  const plasticKg = weight_g / 1000;
  const co2SavedG = plasticKg * 3000;

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