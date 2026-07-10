// Centralized API/WS base URLs.
// Uses the current page's hostname so this works whether you're on
// localhost (dev), the Pi's own screen (kiosk), or another device on
// the same network hitting the Pi's IP directly.
const HOST = window.location.hostname;
const PORT = 4000;

export const API = `http://${HOST}:${PORT}`;
export const WS_URL = `ws://${HOST}:${PORT}`;