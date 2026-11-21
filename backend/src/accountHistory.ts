import crypto from "crypto";
import type Database from "better-sqlite3";

export interface DeletedUserIdentity {
  rfid: string;
}

export function anonymizeRfidHistory(
  db: Database.Database,
  identity: DeletedUserIdentity,
  beforeCreatedAt?: string,
): string {
  let token: string;
  do {
    token = `deleted_${crypto.randomUUID()}`;
  } while (
    db.prepare("SELECT 1 FROM users WHERE rfid = ?").get(token) ||
    db.prepare("SELECT 1 FROM transactions WHERE rfid = ? UNION SELECT 1 FROM feedback WHERE rfid = ?").get(token, token)
  );

  const transactionScope = beforeCreatedAt ? "AND created_at < ?" : "";
  const feedbackScope = beforeCreatedAt ? "AND created_at < ?" : "";
  const transactionParams = beforeCreatedAt
    ? [token, identity.rfid, token, identity.rfid, token, identity.rfid, beforeCreatedAt]
    : [token, identity.rfid, token, identity.rfid, token, identity.rfid];
  db.prepare(`
    UPDATE transactions
    SET rfid = ?,
        size = CASE
          WHEN type = 'register' THEN 'Deleted user'
          WHEN type IN ('transfer_in', 'transfer_out') THEN 'Transfer'
          WHEN type = 'adjust' THEN 'Credit adjustment'
          ELSE replace(size, ?, ?)
        END,
        reject_reason = replace(reject_reason, ?, ?)
    WHERE rfid = ? ${transactionScope}
  `).run(...transactionParams);

  db.prepare(`
    UPDATE feedback
    SET rfid = ?, comment = NULL
    WHERE rfid = ? ${feedbackScope}
  `).run(...(beforeCreatedAt ? [token, identity.rfid, beforeCreatedAt] : [token, identity.rfid]));

  const activityLogsExist = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'activity_logs'"
  ).get();
  if (activityLogsExist) {
    const activityScope = beforeCreatedAt ? "AND created_at < ?" : "";
    db.prepare(`
      UPDATE activity_logs
      SET details = 'Deleted user activity (anonymized)'
      WHERE instr(details, ?) > 0 ${activityScope}
    `).run(...(beforeCreatedAt ? [`RFID ${identity.rfid}`, beforeCreatedAt] : [`RFID ${identity.rfid}`]));
  }

  return token;
}

export function anonymizeExistingRfidHistory(db: Database.Database, identity: DeletedUserIdentity): string | null {
  const historyExists = db.prepare(`
    SELECT 1 FROM transactions WHERE rfid = ?
    UNION
    SELECT 1 FROM feedback WHERE rfid = ?
    LIMIT 1
  `).get(identity.rfid, identity.rfid);
  return historyExists ? anonymizeRfidHistory(db, identity) : null;
}
