import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "http";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// True only for the kiosk's own browser (Chromium on localhost).
// Tailscale Serve also connects from 127.0.0.1, but it adds forwarding headers,
// so a request that carries them came from a remote device and is refused.
export function isKioskRequest(req: Pick<IncomingMessage, "socket" | "headers">): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return false;
  return !req.headers["x-forwarded-for"] &&
         !req.headers["x-forwarded-host"] &&
         !req.headers["forwarded"];
}

export function localOnly(req: Request, res: Response, next: NextFunction) {
  if (isKioskRequest(req)) return next();
  res.status(403).json({ error: "This function is only available at the kiosk." });
}

// Refuses requests that came through a proxy (Tailscale Serve/Funnel).
// Kiosk screen (localhost) and phones on the hotspot connect directly, so they pass.
export function directOnly(req: Request, res: Response, next: NextFunction) {
  const proxied = !!(req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"] || req.headers["forwarded"]);
  if (!proxied) return next();
  res.status(403).json({ error: "Not available remotely." });
}