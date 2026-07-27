import { WebSocketServer, WebSocket } from "ws";

let wssRef: WebSocketServer | null = null;

export function setWss(wss: WebSocketServer) {
  wssRef = wss;
}

export function broadcast(data: unknown) {
  if (!wssRef) return;
  const msg = JSON.stringify(data);
  wssRef.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}