// Centralized API/WS base URLs.
// Uses the current page's hostname so this works whether you're on
// localhost (dev), the Pi's own screen (kiosk), or another device on
// the same network hitting the Pi's IP directly.
//
// When accessed over HTTPS (e.g. via Tailscale Serve), the backend is
// reverse-proxied on the same origin/port (443), so we use relative
// URLs instead of hardcoding :4000 — avoids mixed-content blocking.
const HOST = window.location.hostname;
const PORT = 4000;
const isSecure = window.location.protocol === 'https:';

export const API = isSecure ? '' : `http://${HOST}:${PORT}`;
export const WS_URL = isSecure ? `wss://${HOST}` : `ws://${HOST}:${PORT}`;