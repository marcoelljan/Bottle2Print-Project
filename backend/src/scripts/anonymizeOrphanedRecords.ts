import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { anonymizeRfidHistory } from "../accountHistory";

export function anonymizeOrphanedRecords(db: Database.Database): number {
  const orphanedRfids = db.prepare(`
    SELECT rfid FROM transactions
    WHERE rfid IS NOT NULL AND rfid != '' AND rfid != 'GUEST'
      AND substr(rfid, 1, 8) != 'deleted_'
      AND NOT EXISTS (SELECT 1 FROM users WHERE users.rfid = transactions.rfid)
    UNION
    SELECT rfid FROM feedback
    WHERE rfid IS NOT NULL AND rfid != '' AND rfid != 'GUEST'
      AND substr(rfid, 1, 8) != 'deleted_'
      AND NOT EXISTS (SELECT 1 FROM users WHERE users.rfid = feedback.rfid)
  `).all() as Array<{ rfid: string }>;

  const legacyReusedRfids = db.prepare(`
    SELECT users.rfid, users.created_at
    FROM users
    WHERE EXISTS (
      SELECT 1 FROM transactions registration
      WHERE registration.rfid = users.rfid
        AND registration.type = 'register'
        AND registration.created_at >= users.created_at
    )
    AND (
      EXISTS (SELECT 1 FROM transactions old_tx WHERE old_tx.rfid = users.rfid AND old_tx.created_at < users.created_at)
      OR EXISTS (SELECT 1 FROM feedback old_feedback WHERE old_feedback.rfid = users.rfid AND old_feedback.created_at < users.created_at)
    )
  `).all() as Array<{ rfid: string; created_at: string }>;

  const anonymize = db.transaction(() => {
    for (const { rfid } of orphanedRfids) anonymizeRfidHistory(db, { rfid });
    for (const { rfid, created_at } of legacyReusedRfids) {
      anonymizeRfidHistory(db, { rfid }, created_at);
    }
  });
  anonymize();
  return orphanedRfids.length + legacyReusedRfids.length;
}

async function main() {
  const dbPath = path.resolve(process.env.BOTTLE2PRINT_DB_PATH ?? path.join(__dirname, "../../bottle2print.db"));
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let backupPath = `${dbPath}.before-anonymize-${timestamp}.bak`;
  for (let suffix = 1; fs.existsSync(backupPath); suffix++) {
    backupPath = `${dbPath}.before-anonymize-${timestamp}-${suffix}.bak`;
  }
  const db = new Database(dbPath);
  try {
    await db.backup(backupPath);
    const count = anonymizeOrphanedRecords(db);
    console.log(`Anonymized records for ${count} legacy RFID group(s).`);
    console.log(`Database backup: ${backupPath}`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error("Orphaned-record anonymization failed:", error);
    process.exitCode = 1;
  });
}
