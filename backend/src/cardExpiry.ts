import type Database from "better-sqlite3";

export type CardStatus = "active" | "expired" | "flagged";

export interface CardExpiryEvent {
  uid: string;
  status: CardStatus;
  reason: "auto_expired";
  expiresAt: string;
}

export interface CardRecord {
  rfid: string;
  card_status: CardStatus;
  expires_at: string | null;
  flagged_reason: "auto_expired" | "admin_flagged" | null;
  flagged_at: string | null;
  reactivated_at: string | null;
  reactivation_count: number;
  credits: number;
}

export function getCardValidityDays(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'card_validity_days'").get() as { value: string } | undefined;
  const configured = Number(row?.value);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3650 ? configured : 180;
}

export function createCardExpiryDate(now: Date, validityDays: number): string {
  return new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

export function isCardExpiryDue(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt.replace(" ", "T") + (expiresAt.includes("Z") ? "" : "Z")).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime();
}

function expireCard(db: Database.Database, rfid: string, now: Date): CardExpiryEvent | null {
  const nowSql = now.toISOString().slice(0, 19).replace("T", " ");
  const card = db.prepare(`
    SELECT rfid, expires_at AS expiresAt, credits
    FROM users
    WHERE rfid = ? AND card_status = 'active'
      AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)
  `).get(rfid, nowSql) as { rfid: string; expiresAt: string; credits: number } | undefined;
  if (!card) return null;

  const updated = db.prepare(`
    UPDATE users
    SET card_status = 'expired', flagged_reason = 'auto_expired',
        flagged_at = ?, credits = 0
    WHERE rfid = ? AND card_status = 'active'
      AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)
  `).run(nowSql, rfid, nowSql);
  if (updated.changes !== 1) return null;

  db.prepare("UPDATE rfid_credit_lots SET remaining_credits = 0 WHERE rfid = ?").run(rfid);
  db.prepare(`
    UPDATE rfid_credit_allocations
    SET status = 'expired'
    WHERE rfid = ? AND status = 'reserved'
  `).run(rfid);
  if (card.credits > 0) {
    db.prepare(`
      INSERT INTO transactions (rfid, type, size, credits, created_at)
      VALUES (?, 'expiry', ?, ?, ?)
    `).run(rfid, `Card auto-expired; ${card.credits} credits wiped`, -card.credits, nowSql);
  } else {
    db.prepare(`
      INSERT INTO transactions (rfid, type, size, credits, created_at)
      VALUES (?, 'expiry', 'Card auto-expired; no credits to wipe', 0, ?)
    `).run(rfid, nowSql);
  }
  return { uid: rfid, status: "expired", reason: "auto_expired", expiresAt: card.expiresAt };
}

export function expireCardIfOverdue(db: Database.Database, rfid: string, now = new Date()): CardExpiryEvent | null {
  return db.transaction(() => expireCard(db, rfid, now))();
}

export function expireOverdueCards(db: Database.Database, now = new Date()): CardExpiryEvent[] {
  return db.transaction(() => {
    const overdue = db.prepare(`
      SELECT rfid
      FROM users
      WHERE card_status = 'active' AND expires_at IS NOT NULL
        AND datetime(expires_at) <= datetime(?)
      ORDER BY expires_at, rfid
    `).all(now.toISOString().slice(0, 19).replace("T", " ")) as Array<{ rfid: string }>;
    const events: CardExpiryEvent[] = [];
    for (const card of overdue) {
      const event = expireCard(db, card.rfid, now);
      if (event) events.push(event);
    }
    return events;
  })();
}

export function getCardRecord(db: Database.Database, rfid: string): CardRecord | undefined {
  return db.prepare(`
    SELECT rfid, card_status, expires_at, flagged_reason, flagged_at,
           reactivated_at, reactivation_count, credits
    FROM users WHERE rfid = ?
  `).get(rfid) as CardRecord | undefined;
}

export function isRfidCardUsable(db: Database.Database, rfid: string): boolean {
  expireCardIfOverdue(db, rfid);
  const row = db.prepare(`
    SELECT 1 FROM users
    WHERE rfid = ? AND card_status = 'active'
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
  `).get(rfid);
  return !!row;
}

export function forceExpireCard(db: Database.Database, rfid: string, now = new Date()): CardExpiryEvent | null {
  const nowSql = now.toISOString().slice(0, 19).replace("T", " ");
  return db.transaction(() => {
    const card = db.prepare(`
      SELECT rfid, expires_at AS expiresAt, card_status AS status, credits
      FROM users WHERE rfid = ?
    `).get(rfid) as { rfid: string; expiresAt: string | null; status: CardStatus; credits: number } | undefined;
    if (!card || (card.status === "expired" && card.credits === 0)) return null;

    db.prepare(`
      UPDATE users
      SET card_status = 'expired', expires_at = ?, flagged_reason = 'auto_expired',
          flagged_at = ?, credits = 0
      WHERE rfid = ?
    `).run(nowSql, nowSql, rfid);
    db.prepare("UPDATE rfid_credit_lots SET remaining_credits = 0 WHERE rfid = ?").run(rfid);
    db.prepare("UPDATE rfid_credit_allocations SET status = 'expired' WHERE rfid = ? AND status = 'reserved'").run(rfid);
    db.prepare(`
      INSERT INTO transactions (rfid, type, size, credits, created_at)
      VALUES (?, 'expiry', ?, ?, ?)
    `).run(rfid, `Card force-expired for demo; ${card.credits} credits wiped`, -card.credits, nowSql);
    const event: CardExpiryEvent = {
      uid: rfid,
      status: "expired",
      reason: "auto_expired",
      expiresAt: nowSql,
    };
    return event;
  })();
}
