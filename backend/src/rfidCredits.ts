import type Database from "better-sqlite3";

export const RFID_CREDIT_VALIDITY_DAYS = 180;

export interface CreditLotAllocation {
  lotId: number;
  credits: number;
  expiresOn: string | null;
}

function manilaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addDaysToIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1000 && new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

export function getCreditExpirationDate(db: Database.Database, rfid: string): string | null {
  const row = db.prepare(`
    SELECT MIN(expires_on) AS expiresOn
    FROM rfid_credit_lots lot
    WHERE lot.rfid = ? AND lot.expires_on IS NOT NULL
      AND (
        lot.remaining_credits > 0
        OR EXISTS (
          SELECT 1 FROM rfid_credit_allocations allocation
          WHERE allocation.lot_id = lot.id AND allocation.status = 'reserved'
        )
      )
  `).get(rfid) as { expiresOn: string | null };
  return row.expiresOn;
}

export function expireRfidCredits(db: Database.Database, now = new Date()): number {
  const today = manilaDate(now);
  const expiredLots = db.prepare(`
    SELECT rfid, expires_on, SUM(remaining_credits) AS credits
    FROM rfid_credit_lots
    WHERE remaining_credits > 0 AND expires_on IS NOT NULL AND expires_on < ?
    GROUP BY rfid, expires_on
  `).all(today) as Array<{ rfid: string; expires_on: string; credits: number }>;
  if (expiredLots.length === 0) return 0;

  const expireTxn = db.transaction(() => {
    const expireLots = db.prepare(`
      UPDATE rfid_credit_lots
      SET remaining_credits = 0
      WHERE rfid = ? AND expires_on = ? AND remaining_credits > 0
    `);
    const subtractBalance = db.prepare(`
      UPDATE users SET credits = MAX(0, credits - ?) WHERE rfid = ?
    `);
    const logExpiry = db.prepare(`
      INSERT INTO transactions (rfid, type, size, credits)
      VALUES (?, 'adjust', ?, ?)
    `);

    for (const lot of expiredLots) {
      expireLots.run(lot.rfid, lot.expires_on);
      subtractBalance.run(lot.credits, lot.rfid);
      logExpiry.run(lot.rfid, `RFID credits expired (${lot.expires_on})`, -lot.credits);
    }
  });
  expireTxn();
  return expiredLots.reduce((sum, lot) => sum + lot.credits, 0);
}

export function grantRfidCredits(
  db: Database.Database,
  rfid: string,
  credits: number,
  sourceType: string,
  sourceKey: string,
  expiresOn?: string | null,
): void {
  if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error("Credit grant must be a positive whole number.");
  const expiry = expiresOn === undefined
    ? addDaysToIsoDate(manilaDate(), RFID_CREDIT_VALIDITY_DAYS)
    : expiresOn;
  const update = db.prepare("UPDATE users SET credits = credits + ? WHERE rfid = ?").run(credits, rfid);
  if (update.changes !== 1) throw new Error("RFID account was not found while granting credits.");
  db.prepare(`
    INSERT INTO rfid_credit_lots (rfid, initial_credits, remaining_credits, expires_on, source_type, source_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(rfid, credits, credits, expiry, sourceType, sourceKey);
}

export function consumeRfidCredits(
  db: Database.Database,
  rfid: string,
  credits: number,
  referenceType: string,
  referenceId: string,
  allocationStatus: "spent" | "reserved" = "spent",
): CreditLotAllocation[] {
  if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error("Credit cost must be a positive whole number.");
  const today = manilaDate();
  const lots = db.prepare(`
    SELECT id, remaining_credits, expires_on
    FROM rfid_credit_lots
    WHERE rfid = ? AND remaining_credits > 0
      AND (expires_on IS NULL OR expires_on >= ?)
    ORDER BY expires_on IS NULL, expires_on, created_at, id
  `).all(rfid, today) as Array<{ id: number; remaining_credits: number; expires_on: string | null }>;
  const available = lots.reduce((sum, lot) => sum + lot.remaining_credits, 0);
  if (available < credits) throw new Error("Insufficient unexpired credits.");

  let remaining = credits;
  const allocations: CreditLotAllocation[] = [];
  const consumeLot = db.prepare(`
    UPDATE rfid_credit_lots SET remaining_credits = remaining_credits - ?
    WHERE id = ? AND remaining_credits >= ?
  `);
  const saveAllocation = db.prepare(`
    INSERT INTO rfid_credit_allocations
      (rfid, lot_id, reference_type, reference_id, credits, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const lot of lots) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, lot.remaining_credits);
    const updated = consumeLot.run(amount, lot.id, amount);
    if (updated.changes !== 1) throw new Error("Credit balance changed while processing the transaction.");
    saveAllocation.run(rfid, lot.id, referenceType, referenceId, amount, allocationStatus);
    allocations.push({ lotId: lot.id, credits: amount, expiresOn: lot.expires_on });
    remaining -= amount;
  }
  return allocations;
}

export function restoreRfidCredits(
  db: Database.Database,
  rfid: string,
  referenceType: string,
  referenceId: string,
): { returned: number; expired: number } {
  const today = manilaDate();
  const allocations = db.prepare(`
    SELECT a.id, a.lot_id, a.credits, l.expires_on
    FROM rfid_credit_allocations a
    JOIN rfid_credit_lots l ON l.id = a.lot_id
    WHERE a.rfid = ? AND a.reference_type = ? AND a.reference_id = ?
      AND a.status IN ('spent', 'reserved')
  `).all(rfid, referenceType, referenceId) as Array<{
    id: number; lot_id: number; credits: number; expires_on: string | null;
  }>;
  const restoreLot = db.prepare("UPDATE rfid_credit_lots SET remaining_credits = remaining_credits + ? WHERE id = ?");
  const updateAllocation = db.prepare("UPDATE rfid_credit_allocations SET status = ? WHERE id = ?");
  let returned = 0;
  let expired = 0;

  for (const allocation of allocations) {
    if (allocation.expires_on && allocation.expires_on < today) {
      updateAllocation.run("expired", allocation.id);
      expired += allocation.credits;
    } else {
      restoreLot.run(allocation.credits, allocation.lot_id);
      updateAllocation.run("restored", allocation.id);
      returned += allocation.credits;
    }
  }
  if (returned > 0) {
    db.prepare("UPDATE users SET credits = credits + ? WHERE rfid = ?").run(returned, rfid);
  }
  return { returned, expired };
}

export function commitRfidCreditReservation(
  db: Database.Database,
  rfid: string,
  referenceType: string,
  referenceId: string,
): number {
  const result = db.prepare(`
    UPDATE rfid_credit_allocations
    SET status = 'committed'
    WHERE rfid = ? AND reference_type = ? AND reference_id = ? AND status = 'reserved'
  `).run(rfid, referenceType, referenceId);
  return result.changes;
}

export function getReservedRewardCredits(db: Database.Database, rfid: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(credit_cost), 0) AS credits
    FROM reward_requests
    WHERE rfid = ? AND status IN ('pending', 'approved', 'ready')
  `).get(rfid) as { credits: number };
  return row.credits;
}
