type BusyCheck = () => boolean;

let busyCheck: BusyCheck = () => false;

export function registerBusyCheck(fn: BusyCheck) {
  busyCheck = fn;
}

export function isKioskBusy(): boolean {
  try {
    return busyCheck();
  } catch (err) {
    console.error("[kioskState] busy check failed:", err);
    return false;
  }
}