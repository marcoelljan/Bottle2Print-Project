import { db } from "./db";

export type Feature = "deposit" | "print" | "balance" | "register" | "rfid";
export const FEATURES: Feature[] = ["deposit", "print", "balance", "register", "rfid"];
const GENERIC = "This service is temporarily unavailable. Please ask staff.";
const DEFAULTS: Partial<Record<Feature, string>> = {
  rfid: "The card reader is unavailable. Please continue as a guest or pay with bottles.",
};
const defaultFor = (f: Feature) => DEFAULTS[f] ?? GENERIC;

db.exec(`CREATE TABLE IF NOT EXISTS kiosk_controls (
  feature    TEXT PRIMARY KEY,
  disabled   INTEGER NOT NULL DEFAULT 0,
  message    TEXT NOT NULL DEFAULT '',
  changed_by TEXT,
  changed_at TEXT
)`);

export function getControls() {
  const rows = db.prepare("SELECT * FROM kiosk_controls").all() as any[];
  return FEATURES.map(f => {
    const r = rows.find(x => x.feature === f);
    return {
      feature: f,
      disabled: !!r?.disabled,
      message: (r?.message as string) || defaultFor(f),
      changedBy: (r?.changed_by as string) ?? null,
      changedAt: (r?.changed_at as string) ?? null,
    };
  });
}

export function isDisabled(f: Feature): boolean {
  const r = db.prepare("SELECT disabled FROM kiosk_controls WHERE feature = ?").get(f) as any;
  return !!r?.disabled;
}

// The message users see while a part is off (null when it is on)
export function disabledMessage(f: Feature): string | null {
  const r = db.prepare("SELECT disabled, message FROM kiosk_controls WHERE feature = ?").get(f) as any;
  return r?.disabled ? (r.message || defaultFor(f)) : null;
}

// Message of the first switched-off part among the given ones, or null when all are on
export function firstDisabled(...fs: Feature[]): string | null {
  for (const f of fs) { const m = disabledMessage(f); if (m) return m; }
  return null;
}

export function setControl(f: Feature, disabled: boolean, message: string, by: string) {
  const msg = message.trim().slice(0, 140) || defaultFor(f);
  db.prepare(`
    INSERT INTO kiosk_controls (feature, disabled, message, changed_by, changed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(feature) DO UPDATE SET disabled = excluded.disabled, message = excluded.message,
      changed_by = excluded.changed_by, changed_at = excluded.changed_at
  `).run(f, disabled ? 1 : 0, msg, by);
}