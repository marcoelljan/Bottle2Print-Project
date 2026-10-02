export type TofCalResult = { ok: true; mean: number; spread: number } | { ok: false };

let sender: (() => void) | null = null;
let pending: ((r: TofCalResult) => void) | null = null;

export function registerTofCalSender(fn: () => void) { sender = fn; }

export function requestTofCal(): Promise<TofCalResult> {
  return new Promise(resolve => {
    if (!sender || pending) return resolve({ ok: false });
    const timer = setTimeout(() => { pending = null; resolve({ ok: false }); }, 8000);
    pending = r => { clearTimeout(timer); pending = null; resolve(r); };
    sender();
  });
}

export function handleTofCalLine(line: string) {
  if (!pending) return;
  const [, status, mean, spread] = line.split(":");
  pending(status === "OK" ? { ok: true, mean: parseFloat(mean), spread: parseFloat(spread) } : { ok: false });
}