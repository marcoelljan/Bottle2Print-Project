import { db } from "./db";

export const JAM_DETECTION_ENABLED = process.env.JAM_DETECTION_ENABLED === "true";

export type JamSource = "chamber" | "intake";
export type JamState = { active: boolean; since: string | null; source: JamSource | null; mm: number | null };

export type JamClearResult =
  | { ok: true }
  | { ok: false; busy: true; mm: number }
  | { ok: false; timeout: true };

db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`);

export function getJam(): JamState {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'jam_active'").get() as any;
    if (!row) return { active: false, since: null, source: null, mm: null };
    const parsed = JSON.parse(row.value);
    if (!parsed || parsed.active === false) return { active: false, since: null, source: null, mm: null };
    return {
      active: true,
      since: typeof parsed.since === "string" ? parsed.since : null,
      source: parsed.source === "intake" ? "intake" : "chamber",
      mm: Number.isFinite(parsed.mm) ? parsed.mm : null,
    };
  } catch {
    return { active: false, since: null, source: null, mm: null };
  }
}

export function setJam(source: JamSource, mm: number | null, since = new Date().toISOString()) {
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('jam_active', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ since, source, mm }));
  return getJam();
}

export function clearJam() {
  db.prepare("DELETE FROM app_settings WHERE key = 'jam_active'").run();
  return getJam();
}

let tofEmptySender: ((mm: number) => void) | null = null;
export function registerJamTofEmptySender(fn: (mm: number) => void) { tofEmptySender = fn; }
export function notifyJamTofEmpty(mm: number) { if (tofEmptySender) tofEmptySender(mm); }

let clearSender: (() => void) | null = null;
let clearPending: ((result: JamClearResult) => void) | null = null;

export function registerJamClearSender(fn: () => void) { clearSender = fn; }

export function requestJamClear(): Promise<JamClearResult> {
  return new Promise(resolve => {
    if (!clearSender || clearPending) { resolve({ ok: false, timeout: true }); return; }
    const timer = setTimeout(() => {
      clearPending = null;
      resolve({ ok: false, timeout: true });
    }, 5000);
    clearPending = result => {
      clearTimeout(timer);
      clearPending = null;
      resolve(result);
    };
    clearSender();
  });
}

export function handleJamClearLine(line: string) {
  if (!clearPending) return;
  if (line === "JAMCLEAR:OK") clearPending({ ok: true });
  else {
    const match = line.match(/^JAMCLEAR:BUSY:([0-9]+(?:\.[0-9]+)?)/);
    if (match) clearPending({ ok: false, busy: true, mm: parseFloat(match[1]) });
  }
}
