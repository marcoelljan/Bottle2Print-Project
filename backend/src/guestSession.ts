// In-memory guest session. Deliberately separate from the per-screen
// `session` object in server.ts, which gets wiped on every /api/mode call.
// This is what lets a guest walk from Deposit -> Print without losing
// their accumulated credits.

interface GuestSessionState {
  active: boolean;
  credits: number;
  lastActivity: number;
}

const GUEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 min idle = treat as abandoned

let guestSession: GuestSessionState = { active: false, credits: 0, lastActivity: 0 };

export function isGuestActive(): boolean {
  if (!guestSession.active) return false;
  if (Date.now() - guestSession.lastActivity > GUEST_TIMEOUT_MS) {
    guestSession = { active: false, credits: 0, lastActivity: 0 };
    return false;
  }
  return true;
}

export function startGuestSession() {
  // Reuse an already-active session (e.g. guest returning from Print's
  // deposit sub-flow) instead of wiping banked credits.
  if (guestSession.active) {
    guestSession.lastActivity = Date.now();
    return;
  }
  guestSession = { active: true, credits: 0, lastActivity: Date.now() };
}

export function addGuestCredit(amount: number = 1) {
  guestSession.credits += amount;
  guestSession.lastActivity = Date.now();
}

export function getGuestCredits(): number {
  return guestSession.credits;
}

export function deductGuestCredits(amount: number) {
  guestSession.credits = Math.max(0, guestSession.credits - amount);
  guestSession.lastActivity = Date.now();
}

export function endGuestSession() {
  guestSession = { active: false, credits: 0, lastActivity: 0 };
}