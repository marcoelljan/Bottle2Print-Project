interface QrSession {
  rfid: string;
  status: "waiting" | "uploaded";
  filePath?: string;
  fileName?: string;
  pageCount?: number;
  createdAt: number;
}

const sessions = new Map<string, QrSession>();

export function createSession(rfid: string): string {
  const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessions.set(sessionId, { rfid, status: "waiting", createdAt: Date.now() });

  setTimeout(() => {
    const s = sessions.get(sessionId);
    if (s && s.status === "waiting") sessions.delete(sessionId);
  }, 5 * 60 * 1000);

  return sessionId;
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId);
}

export function updateSession(sessionId: string, data: Partial<QrSession>) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  Object.assign(s, data);
  return s;
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId);
}