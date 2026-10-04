// Remembers which cards had their PIN entered correctly in the last 10 minutes.
const VERIFIED_TTL_MS = 10 * 60 * 1000;
const verified = new Map<string, number>();

export function markVerified(rfid: string) {
  verified.set(rfid, Date.now());
}

export function isVerified(rfid: string): boolean {
  const at = verified.get(rfid);
  if (at === undefined) return false;
  if (Date.now() - at > VERIFIED_TTL_MS) { verified.delete(rfid); return false; }
  return true;
}