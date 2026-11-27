import { Router } from "express";
import bcrypt from "bcrypt";
import { db } from "../db";
import { isVerified, markVerified } from "../pinAuth";
import { firstDisabled } from "../kioskControls";
import { anonymizeExistingRfidHistory } from "../accountHistory";
import {
  consumeRfidCredits,
  expireRfidCredits,
  getCreditExpirationDate,
  getReservedRewardCredits,
  grantRfidCredits,
  RFID_CREDIT_VALIDITY_DAYS,
  restoreRfidCredits,
} from "../rfidCredits";
import {
  createCardExpiryDate,
  expireCardIfOverdue,
  getCardRecord,
  getCardValidityDays,
  isCardExpiryDue,
  isRfidCardUsable,
} from "../cardExpiry";
import { broadcast } from "../wsHub";
import { calculateRewardPricing } from "../rewardPricing";

const router = Router();
const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 20 * 1000; // 20 second cooldown

// ── 1. SEARCH ROUTE PLACED FIRST (Must be before any :rfid dynamic routes) ──
router.get("/api/user/search", (req, res) => {
  const { query, senderRfid } = req.query;
  if (!query || !senderRfid) {
    return res.status(400).json({ error: "Missing search parameters." });
  }
  if (String(query).trim().length < 2) return res.json([]);

  const searchTerm = `%${query}%`;
  const users = db.prepare(`
    SELECT rfid, TRIM(firstname || ' ' || COALESCE(middlename, '') || ' ' || surname) AS name, studentId
    FROM users 
    WHERE rfid != ? AND (surname LIKE ? OR firstname LIKE ? OR middlename LIKE ? OR studentId LIKE ?)
    LIMIT 5
  `).all(senderRfid, searchTerm, searchTerm, searchTerm, searchTerm);

  res.json(users);
});

function rewardConfig(key: string, fallback: number): number {
  const row = db.prepare("SELECT value FROM system_config WHERE key = ?").get(key) as { value: string } | undefined;
  const value = Number(row?.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requireRewardRfid(rfid: unknown, res: import("express").Response): rfid is string {
  if (typeof rfid !== "string" || !rfid.trim() || !isVerified(rfid)) {
    res.status(403).json({ error: "A verified RFID session is required to view or redeem rewards." });
    return false;
  }
  const expiryEvent = expireCardIfOverdue(db, rfid);
  if (expiryEvent) broadcast({ type: "card_status_changed", card: expiryEvent });
  if (!isRfidCardUsable(db, rfid)) {
    res.status(403).json({ error: "This RFID card is expired or flagged and cannot use rewards." });
    return false;
  }
  return true;
}

function getActiveReward(id: number) {
  return db.prepare(`
    SELECT id, title, description, terms, image, price_php AS pricePhp,
           quantity_available AS quantityAvailable, max_per_user AS maxPerUser,
           starts_on AS startsOn, ends_on AS endsOn, listed_at AS listedAt
    FROM reward_offers
    WHERE id = ? AND status = 'active'
      AND (starts_on IS NULL OR starts_on <= date('now', '+8 hours'))
      AND (ends_on IS NULL OR ends_on >= date('now', '+8 hours'))
      AND (quantity_available IS NULL OR quantity_available > 0)
  `).get(id) as {
    id: number; title: string; description: string; terms: string; image: string | null;
    pricePhp: number; quantityAvailable: number | null; maxPerUser: number;
    startsOn: string | null; endsOn: string | null; listedAt: string | null;
  } | undefined;
}

router.get("/api/user/rewards/offers", (_req, res) => {
  res.status(403).json({ error: "Rewards are available only inside a verified RFID balance session." });
});

router.get("/api/user/:rfid/rewards", (req, res) => {
  res.status(410).json({ error: "This rewards endpoint has been replaced. Load /api/rewards from a verified RFID session." });
});

router.post("/api/user/:rfid/rewards/:offerId/request", (_req, res) => {
  res.status(410).json({ error: "The fixed-credit reward request flow is no longer supported." });
});

router.get("/api/rewards", (req, res) => {
  const rfid = req.query.rfid;
  if (!requireRewardRfid(rfid, res)) return;
  expireRfidCredits(db);
  const user = db.prepare(`
    SELECT credits, card_status AS cardStatus, expires_at AS cardExpiresAt
    FROM users WHERE rfid = ?
  `).get(rfid) as { credits: number; cardStatus: string; cardExpiresAt: string | null } | undefined;
  if (!user) return res.status(404).json({ error: "User not found." });

  const creditsPerPeso = rewardConfig("credits_per_peso", 10);
  const newBadgeDays = rewardConfig("reward_new_badge_days", 7);
  const offers = db.prepare(`
    SELECT id, title, description, terms, image, price_php AS pricePhp,
           quantity_available AS quantityAvailable, max_per_user AS maxPerUser,
           starts_on AS startsOn, ends_on AS endsOn, listed_at AS listedAt,
           CASE WHEN listed_at IS NOT NULL
             AND datetime(listed_at, '+' || ? || ' days') >= datetime('now')
             THEN 1 ELSE 0 END AS isNew
    FROM reward_offers
    WHERE status = 'active'
      AND (starts_on IS NULL OR starts_on <= date('now', '+8 hours'))
      AND (ends_on IS NULL OR ends_on >= date('now', '+8 hours'))
      AND (quantity_available IS NULL OR quantity_available > 0)
    ORDER BY created_at DESC, id DESC
  `).all(newBadgeDays) as Array<{
    id: number; title: string; description: string; terms: string; image: string | null;
    pricePhp: number; quantityAvailable: number | null; maxPerUser: number;
    startsOn: string | null; endsOn: string | null; listedAt: string | null; isNew: number;
  }>;
  const redemptions = db.prepare(`
    SELECT id, reward_title AS rewardTitle, price_php AS pricePhp,
           credits_applied AS creditsApplied, discount_php AS discountPhp,
           amount_due_php AS amountDuePhp, credits_per_peso_used AS creditsPerPesoUsed,
           status, requested_at AS requestedAt, resolution_note AS resolutionNote
    FROM reward_redemptions WHERE rfid = ?
    ORDER BY requested_at DESC, id DESC LIMIT 100
  `).all(rfid);
  res.json({
    availableCredits: user.cardStatus === "active" ? user.credits : 0,
    creditExpirationDate: getCreditExpirationDate(db, rfid),
    creditValidityDays: RFID_CREDIT_VALIDITY_DAYS,
    cardStatus: user.cardStatus,
    cardExpiresAt: user.cardExpiresAt,
    creditsPerPeso,
    newBadgeDays,
    offers: offers.map(offer => ({
      ...offer,
      price_php: offer.pricePhp,
      listed_at: offer.listedAt,
      maxCreditsUsable: calculateRewardPricing(offer.pricePhp, 0, creditsPerPeso, user.credits).maxCreditsUsable,
      isNew: offer.isNew === 1,
    })),
    credits_per_peso: creditsPerPeso,
    redemptions,
  });
});

router.post("/api/rewards/:id/preview", (req, res) => {
  const rfid = req.query.rfid;
  if (!requireRewardRfid(rfid, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid reward." });
  const creditsApplied = req.body?.credits_applied;
  if (!Number.isSafeInteger(creditsApplied) || creditsApplied < 0) {
    return res.status(400).json({ error: "Credits applied must be a non-negative whole number." });
  }
  expireRfidCredits(db);
  const user = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid) as { credits: number } | undefined;
  if (!user) return res.status(404).json({ error: "User not found." });
  const offer = getActiveReward(id);
  if (!offer) return res.status(404).json({ error: "This reward is no longer available." });
  try {
    const pricing = calculateRewardPricing(offer.pricePhp, creditsApplied, rewardConfig("credits_per_peso", 10), user.credits);
    return res.json({
      ...pricing,
      price_php: pricing.pricePhp,
      credits_applied: pricing.creditsApplied,
      discount_php: pricing.discountPhp,
      amount_due_php: pricing.amountDuePhp,
      max_credits_usable: pricing.maxCreditsUsable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not calculate reward pricing.";
    return res.status(400).json({ error: message });
  }
});

router.post("/api/rewards/:id/redeem", (req, res) => {
  const rfid = req.query.rfid;
  if (!requireRewardRfid(rfid, res)) return;
  const id = Number(req.params.id);
  const sessionId = req.body?.sessionId;
  const creditsApplied = req.body?.credits_applied;
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid reward." });
  if (typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 128) {
    return res.status(400).json({ error: "A valid redemption sessionId is required." });
  }
  if (!Number.isSafeInteger(creditsApplied) || creditsApplied < 0) {
    return res.status(400).json({ error: "Credits applied must be a non-negative whole number." });
  }

  expireRfidCredits(db);
  try {
    const result = db.transaction(() => {
      const previous = db.prepare("SELECT * FROM reward_redemptions WHERE session_id = ?").get(sessionId) as any;
      if (previous) {
        if (previous.rfid !== rfid || previous.reward_id !== id) throw new Error("REDEMPTION_SESSION_CONFLICT");
        return { row: previous, idempotent: true };
      }

      const card = db.prepare("SELECT credits, card_status AS cardStatus, expires_at AS expiresAt FROM users WHERE rfid = ?")
        .get(rfid) as { credits: number; cardStatus: string; expiresAt: string | null } | undefined;
      if (!card) throw new Error("USER_NOT_FOUND");
      if (card.cardStatus !== "active" || isCardExpiryDue(card.expiresAt, new Date())) {
        throw new Error("CARD_BLOCKED");
      }
      const offer = getActiveReward(id);
      if (!offer) throw new Error("REWARD_UNAVAILABLE");
      const count = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM reward_redemptions
           WHERE rfid = ? AND reward_id = ? AND status IN ('pending', 'approved', 'ready', 'fulfilled')) +
          (SELECT COUNT(*) FROM reward_requests
           WHERE rfid = ? AND offer_id = ? AND status IN ('pending', 'approved', 'ready', 'fulfilled')) AS count
      `).get(rfid, id, rfid, id) as { count: number };
      if (count.count >= offer.maxPerUser) throw new Error("REWARD_LIMIT_REACHED");

      const creditsPerPeso = rewardConfig("credits_per_peso", 10);
      const pricing = calculateRewardPricing(offer.pricePhp, creditsApplied, creditsPerPeso, card.credits);
      if (creditsApplied > 0) consumeRfidCredits(db, rfid, creditsApplied, "reward_redemption", sessionId, "spent");
      const charged = db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ? AND credits >= ?")
        .run(creditsApplied, rfid, creditsApplied);
      if (charged.changes !== 1) throw new Error("INSUFFICIENT_CREDITS");
      if (offer.quantityAvailable !== null) {
        const stock = db.prepare(`
          UPDATE reward_offers SET quantity_available = quantity_available - 1, updated_at = datetime('now')
          WHERE id = ? AND status = 'active' AND quantity_available > 0
        `).run(id);
        if (stock.changes !== 1) throw new Error("REWARD_UNAVAILABLE");
      }
      const inserted = db.prepare(`
        INSERT INTO reward_redemptions
          (session_id, reward_id, user_id, rfid, reward_title, price_php, credits_applied,
           discount_php, amount_due_php, credits_per_peso_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, id, rfid, rfid, offer.title, pricing.pricePhp, creditsApplied,
        pricing.discountPhp, pricing.amountDuePhp, creditsPerPeso);
      const redemptionId = Number(inserted.lastInsertRowid);
      db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'reward_redeem', ?, ?)")
        .run(rfid, `Reward redemption #${redemptionId}: ${offer.title}`, -creditsApplied);
      const row = db.prepare("SELECT * FROM reward_redemptions WHERE id = ?").get(redemptionId) as any;
      return { row, idempotent: false };
    })();
    const row = result.row;
    const available = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid) as { credits: number };
    return res.status(result.idempotent ? 200 : 201).json({
      success: true,
      idempotent: result.idempotent,
      receipt: {
        id: row.id,
        rewardId: row.reward_id,
        rewardTitle: row.reward_title,
        pricePhp: row.price_php,
        creditsApplied: row.credits_applied,
        discountPhp: row.discount_php,
        amountDuePhp: row.amount_due_php,
        creditsPerPesoUsed: row.credits_per_peso_used,
        status: row.status,
        requestedAt: row.requested_at,
      },
      availableCredits: available.credits,
    });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "REDEMPTION_FAILED";
    const code = rawCode === "Insufficient unexpired credits." ? "INSUFFICIENT_CREDITS" : rawCode;
    const status = code === "USER_NOT_FOUND" ? 404
      : code === "CARD_BLOCKED" ? 403
      : code === "REWARD_UNAVAILABLE" || code === "REWARD_LIMIT_REACHED" || code === "INSUFFICIENT_CREDITS" || code === "REDEMPTION_SESSION_CONFLICT" ? 409
      : 400;
    const messages: Record<string, string> = {
      USER_NOT_FOUND: "RFID user not found.",
      CARD_BLOCKED: "This RFID card is expired or flagged and cannot redeem rewards.",
      REWARD_UNAVAILABLE: "This reward is no longer available.",
      REWARD_LIMIT_REACHED: "You have reached the redemption limit for this reward.",
      INSUFFICIENT_CREDITS: "Your credit balance changed. Please review the reward and try again.",
      REDEMPTION_SESSION_CONFLICT: "This sessionId was already used for a different redemption.",
    };
    return res.status(status).json({ code, error: messages[code] ?? code });
  }
});

router.post("/api/user/:rfid/rewards/requests/:requestId/cancel", (req, res) => {
  const rfid = req.params.rfid;
  if (!isVerified(rfid)) return res.status(403).json({ error: "Verify your card PIN before cancelling a reward request." });
  const requestId = Number(req.params.requestId);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) return res.status(400).json({ error: "Invalid reward request." });
  expireRfidCredits(db);
  try {
    const result = db.transaction(() => {
      const request = db.prepare(`
        SELECT id, offer_id, credit_cost, status FROM reward_requests
        WHERE id = ? AND rfid = ?
      `).get(requestId, rfid) as { id: number; offer_id: number | null; credit_cost: number; status: string } | undefined;
      if (!request) throw new Error("Reward request not found.");
      if (request.status !== "pending" && request.status !== "approved") throw new Error("This request can no longer be cancelled.");
      const restoration = restoreRfidCredits(db, rfid, "reward_request", String(requestId));
      db.prepare(`
        UPDATE reward_requests SET status = 'cancelled', updated_at = datetime('now')
        WHERE id = ? AND rfid = ? AND status IN ('pending', 'approved')
      `).run(requestId, rfid);
      if (request.offer_id !== null) {
        db.prepare("UPDATE reward_offers SET quantity_available = quantity_available + 1 WHERE id = ? AND quantity_available IS NOT NULL")
          .run(request.offer_id);
      }
      if (restoration.returned > 0) {
        db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'reward_return', ?, ?)")
          .run(rfid, `Reward request cancelled (#${requestId})`, restoration.returned);
      }
      if (restoration.expired > 0) {
        db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'adjust', ?, ?)")
          .run(rfid, `RFID credits expired while reward request was pending (#${requestId})`, -restoration.expired);
      }
      return restoration;
    })();
    const balance = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(rfid) as { credits: number };
    res.json({ success: true, ...result, availableCredits: balance.credits });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel reward request.";
    return res.status(message === "Reward request not found." ? 404 : 409).json({ error: message });
  }
});

// ── 2. DYNAMIC ROUTES COME AFTER SPECIFIC ROUTES ──
router.get("/api/user/:rfid", (req, res) => {
  const user = db.prepare(`
    SELECT *, TRIM(firstname || ' ' || COALESCE(middlename, '') || ' ' || surname) AS name 
    FROM users 
    WHERE rfid = ?
  `).get(req.params.rfid) as any;

  if (!user) return res.status(404).json({ error: "Not found" });
  expireRfidCredits(db);
  const freshUser = db.prepare(`
    SELECT *, TRIM(firstname || ' ' || COALESCE(middlename, '') || ' ' || surname) AS name
    FROM users WHERE rfid = ?
  `).get(req.params.rfid) as any;
  const { pin_hash, ...safe } = freshUser;
  res.json({ ...safe, hasPin: !!pin_hash && freshUser.pin_needs_reset !== 1 });
});

router.get("/api/user/:rfid/transactions", (req, res) => {
  const activeUser = db.prepare("SELECT 1 FROM users WHERE rfid = ?").get(req.params.rfid);
  if (!activeUser) return res.status(404).json({ error: "Not found" });
  const rows = db.prepare(
    "SELECT * FROM transactions WHERE rfid = ? AND type != 'reject' ORDER BY created_at DESC"
  ).all(req.params.rfid);
  res.json(rows);
});

// ── Registration — supports separated name columns & 6-digit PIN hashing ──
router.post("/api/user/register", async (req, res) => {
  const regBlocked = firstDisabled("register", "rfid");
  if (regBlocked) return res.status(503).json({ error: regBlocked });
  const { rfid, surname, firstname, middlename, studentId, pin } = req.body;
  if (!rfid || !surname || !firstname || !studentId) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  if (!pin || !/^\d{6}$/.test(String(pin))) {
    return res.status(400).json({ error: "PIN must be exactly 6 digits." });
  }

  const existing = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  if (existing && existing.pin_hash && existing.pin_needs_reset !== 1) {
    return res.status(409).json({ error: "This card is already registered." });
  }
  const dupe = db.prepare("SELECT rfid FROM users WHERE studentId = ? AND rfid != ?").get(String(studentId).trim(), rfid);
  if (dupe) return res.status(409).json({ error: "That student ID is already registered to another card." });

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
    const expiresAt = createCardExpiryDate(new Date(), getCardValidityDays(db));
    if (existing) {
      db.prepare(`
        UPDATE users
        SET surname = ?, firstname = ?, middlename = ?, studentId = ?, pin_hash = ?, pin_fail_count = 0,
            pin_locked_until = NULL, card_status = 'active', expires_at = ?,
            flagged_reason = NULL, flagged_at = NULL
        WHERE rfid = ?
      `).run(cleanSurname, cleanFirstname, cleanMiddlename, cleanStudentId, hash, expiresAt, rfid);
    } else {
      anonymizeExistingRfidHistory(db, { rfid });
      db.prepare(
        "INSERT INTO users (rfid, surname, firstname, middlename, studentId, pin_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(rfid, cleanSurname, cleanFirstname, cleanMiddlename, cleanStudentId, hash, expiresAt);
      
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
  if (!isRfidCardUsable(db, rfid)) return res.status(403).json({ error: "This RFID card is expired or flagged." });

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
    markVerified(rfid);
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

// (The old POST /api/user/deposit route was removed: real deposits are written in server.ts
//  only after the Arduino confirms the bottle reached storage.)

// ── Credit Transfer Route ──────────────────────────────────────────────────
// Checks a user's PIN with the same lockout rules as /api/user/verify-pin
async function verifyUserPin(rfid: string, pin: unknown): Promise<{ ok: true } | { ok: false; status: number; body: any }> {
  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  if (!user) return { ok: false, status: 404, body: { error: "Sender account not found." } };
  if (!user.pin_hash) return { ok: false, status: 400, body: { error: "No PIN set for this account. Please contact an admin." } };

  if (user.pin_locked_until) {
    const remainingMs = new Date(user.pin_locked_until).getTime() - Date.now();
    if (remainingMs > 0) {
      return { ok: false, status: 423, body: { error: "Too many incorrect attempts. Please wait before trying again.", lockedOut: true, secondsRemaining: Math.ceil(remainingMs / 1000) } };
    }
  }

  let match = false;
  try { match = await bcrypt.compare(String(pin ?? ""), user.pin_hash); }
  catch { return { ok: false, status: 500, body: { error: "Could not verify PIN." } }; }

  if (match) {
    db.prepare("UPDATE users SET pin_fail_count = 0, pin_locked_until = NULL WHERE rfid = ?").run(rfid);
    return { ok: true };
  }

  const fails = (user.pin_fail_count ?? 0) + 1;
  if (fails >= PIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
    db.prepare("UPDATE users SET pin_fail_count = 0, pin_locked_until = ? WHERE rfid = ?").run(lockedUntil, rfid);
    return { ok: false, status: 423, body: { error: "Too many incorrect attempts. Please wait 20 seconds before trying again.", lockedOut: true, secondsRemaining: 20 } };
  }
  db.prepare("UPDATE users SET pin_fail_count = ? WHERE rfid = ?").run(fails, rfid);
  return { ok: false, status: 401, body: { error: "Incorrect PIN.", attemptsRemaining: PIN_MAX_ATTEMPTS - fails } };
}

// ── Credit Transfer Route (PIN checked here, not by the browser) ───────────
router.post("/api/user/transfer", async (req, res) => {
  const balBlocked = firstDisabled("balance", "rfid");
  if (balBlocked) return res.status(503).json({ error: balBlocked });
  const { senderRfid, recipientRfid, amount, pin } = req.body;
  const transferAmount = parseInt(amount);

  if (!senderRfid || !recipientRfid || isNaN(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ error: "Invalid transfer parameters." });
  }
  if (senderRfid === recipientRfid) {
    return res.status(400).json({ error: "You cannot transfer credits to yourself." });
  }
  if (!pin) return res.status(400).json({ error: "PIN required." });

  const sender = db.prepare("SELECT * FROM users WHERE rfid = ?").get(senderRfid) as any;
  const recipient = db.prepare("SELECT * FROM users WHERE rfid = ?").get(recipientRfid) as any;
  if (!sender) return res.status(404).json({ error: "Sender account not found." });
  if (!recipient) return res.status(404).json({ error: "Recipient account not found." });
  if (!isRfidCardUsable(db, senderRfid)) return res.status(403).json({ error: "Sender RFID card is expired or flagged." });
  if (!isRfidCardUsable(db, recipientRfid)) return res.status(403).json({ error: "Recipient RFID card is expired or flagged." });

  const check = await verifyUserPin(senderRfid, pin);
  if (!check.ok) return res.status(check.status).json(check.body);

  // No awaits from here on, so the balance check and the update can't be interleaved
  expireRfidCredits(db);
  const fresh = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(senderRfid) as any;
  if (fresh.credits < transferAmount) {
    return res.status(400).json({ error: "Insufficient credits for transfer." });
  }

  const nm = (u: any) => `${u.firstname ?? ""} ${u.surname ?? ""}`.trim();
  try {
    db.transaction(() => {
      const out = db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'transfer_out', ?, ?)")
        .run(senderRfid, `To: ${nm(recipient)}`, transferAmount);
      const allocations = consumeRfidCredits(db, senderRfid, transferAmount, "transfer", String(out.lastInsertRowid));
      db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ?").run(transferAmount, senderRfid);
      const incoming = db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'transfer_in', ?, ?)")
        .run(recipientRfid, `From: ${nm(sender)}`, transferAmount);
      allocations.forEach((allocation, index) => {
        grantRfidCredits(
          db,
          recipientRfid,
          allocation.credits,
          "transfer",
          `transaction:${incoming.lastInsertRowid}:${index}`,
          allocation.expiresOn,
        );
      });
    })();
    const updatedSender = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(senderRfid) as any;
    res.json({ success: true, newCredits: updatedSender.credits });
  } catch (err: any) {
    res.status(500).json({ error: "Transfer failed: " + err.message });
  }
});

export default router;