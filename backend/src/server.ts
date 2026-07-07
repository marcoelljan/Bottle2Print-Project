import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { db } from "./db";
import { upload } from "./upload";
import userRoutes from "./routes/user";
import printRoutes from "./routes/print";
import adminRoutes from "./routes/admin";
import feedbackRoutes from "./routes/feedback";

const PORT = 4000;
const ARDUINO_PORT = process.env.ARDUINO_PORT || "/dev/tty.usbmodem14101";
const BAUD_RATE = 9600;

// ── Size classification ───────────────────────────────────────────────────────
interface SizeSpec { label: string; minHeight: number; maxHeight: number; minWeight: number; maxWeight: number; }
const SIZE_SPECS: SizeSpec[] = [
  { label: "Small",  minHeight: 80,  maxHeight: 150, minWeight: 0,  maxWeight: 0 },
  { label: "Medium", minHeight: 151, maxHeight: 220, minWeight: 0, maxWeight: 0},
  { label: "Large",  minHeight: 221, maxHeight: 280, minWeight: 0, maxWeight: 0 },
  { label: "XL",     minHeight: 281, maxHeight: 320, minWeight: 0, maxWeight: 0 },
];

function classifyBottle(heightMm: number, weightG: number): SizeSpec | null {
  return SIZE_SPECS.find(
    s => heightMm >= s.minHeight && heightMm <= s.maxHeight
      && weightG  >= s.minWeight  && weightG  <= s.maxWeight
  ) ?? null;
}

// ── Validation state machine ──────────────────────────────────────────────────
type StepStatus = "pending" | "running" | "pass" | "fail";
interface ValidationStep { id: string; label: string; status: StepStatus; detail?: string; }

interface SessionState {
  rfid:        string | null;
  userName:    string | null;
  credits:     number;
 step: "idle" | "gate_open" | "identified" | "already_registered" | "unregistered" | "ir" | "capacitive" | "tof" | "loadcell" | "result";
  steps:       ValidationStep[];
  heightMm:    number | null;
  weightG:     number | null;
  size:        string | null;
  result:      "accepted" | "rejected" | null;
  errorMsg:    string | null;
  timestamp:   number; // ← NEW: tracks when session was last updated
  sessionId:   number;
}

function freshSteps(): ValidationStep[] {
  return [
    { id: "ir",        label: "Bottle detected",   status: "pending" },
    { id: "capacitive",label: "Presence confirmed", status: "pending" },
    { id: "tof",       label: "Height measured",    status: "pending" },
    { id: "loadcell",  label: "Weight verified",    status: "pending" },
  ];
}

let session: SessionState = {
  rfid: null, userName: null, credits: 0,
  step: "idle", steps: freshSteps(),
  heightMm: null, weightG: null, size: null,
  result: null, errorMsg: null,
  timestamp: 0, sessionId: 0,
};

function resetSession() {
  session = {
    rfid: null, userName: null, credits: 0,
    step: "idle", steps: freshSteps(),
    heightMm: null, weightG: null, size: null,
    result: null, errorMsg: null,
    timestamp: 0, sessionId: 0,
  };
  broadcastState();
}

function setStep(id: string, status: StepStatus, detail?: string) {
  const s = session.steps.find(s => s.id === id);
  if (s) { s.status = status; if (detail) s.detail = detail; }
}

// ── Express + WS ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

type KioskMode = "deposit" | "register" | "balance" | "print" | "admin" | "idle";
let kioskMode: KioskMode = "idle";

app.post("/api/mode", (req, res) => {
  kioskMode = req.body.mode as KioskMode;
  console.log("Kiosk mode:", kioskMode);
  if (kioskMode === "idle") {
    resetSession();
  }
  res.json({ success: true, mode: kioskMode });
});

app.get("/api/mode", (_req, res) => res.json({ mode: kioskMode }));
app.use(userRoutes);
app.use(printRoutes);
app.use(adminRoutes);
app.use(feedbackRoutes);

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

function broadcastState() {
  // ← NEW: always include fresh timestamp when broadcasting
  const data = JSON.stringify({ type: "state", session: { ...session, timestamp: Date.now() } });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

wss.on("connection", ws => {
  // ← NEW: send timestamp:0 on initial connect so frontend ignores it as stale
  ws.send(JSON.stringify({ type: "state", session: { ...session, timestamp: 0 } }));
});

// ── Serial ────────────────────────────────────────────────────────────────────
const serial = new SerialPort({ path: ARDUINO_PORT, baudRate: BAUD_RATE });
const parser = serial.pipe(new ReadlineParser({ delimiter: "\r\n" }));

serial.on("open", () => {
  console.log(`Serial open: ${ARDUINO_PORT}`);
  // give Arduino 2 seconds to initialize then send a reset command
  setTimeout(() => {
    serial.write("RESET\n");
    console.log("Sent RESET to Arduino");
  }, 2000);
});
serial.on("error", err => console.error("Serial error:", err.message));

function sendToArduino(cmd: string) {
  serial.write(cmd + "\n");
}

parser.on("data", (raw: string) => {
  const line = raw.trim();
  console.log("Arduino →", line);

 if (line.startsWith("RFID:")) {
  const rfid = line.split(":")[1];
  const newSessionId = Date.now();
  // reset previous session
  session.rfid      = null;
  session.userName  = null;
  session.credits   = 0;
  session.step      = "idle";
  session.steps     = freshSteps();
  session.result    = null;
  session.errorMsg  = null;
  session.timestamp = 0;
  session.sessionId = 0;

  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;

 if (kioskMode === "register") {
  // a card is fully registered only if it has a non-empty studentId
  const isFullyRegistered = !!(
    user &&
    user.studentId !== null &&
    user.studentId !== undefined &&
    String(user.studentId).trim().length > 0
  );

  session.rfid      = rfid;
  session.userName  = user?.name ?? null;
  session.credits   = user?.credits ?? 0;
  session.steps     = freshSteps();
  session.result    = null;
  session.errorMsg  = null;
  session.timestamp = Date.now();
  session.sessionId = newSessionId;
  session.step      = isFullyRegistered ? "already_registered" : "identified";
  broadcastState();
  setTimeout(resetSession, 5000);
  return;  
}
// admin mode — don't check studentId, just identify and let AdminScreen verify
  if (kioskMode === "admin") {
    session.rfid      = rfid;
    session.userName  = user?.name ?? null;
    session.credits   = 0;
    session.steps     = freshSteps();
    session.result    = null;
    session.errorMsg  = null;
    session.timestamp = Date.now();
    session.sessionId = newSessionId; // ← assign
    session.step      = "identified"; // always identified in admin mode
    broadcastState();
    setTimeout(resetSession, 5000); // ← 10 seconds for admin to verify
    return;
  }
  // all other modes — reject if not registered
  if (!user || !user.studentId || user.studentId.trim() === "") {
    session.rfid      = rfid;
    session.step      = "unregistered"; // ← new step
    session.timestamp = Date.now();
    session.sessionId = newSessionId;
    broadcastState();
    sendToArduino("IGNORE");
    setTimeout(resetSession, 2000); // ← reset after 2 seconds
    return;
  }

  // registered user — proceed normally
  session.rfid      = rfid;
  session.userName  = user.name;
  session.credits   = user.credits;
  session.steps     = freshSteps();
  session.result    = null;
  session.errorMsg  = null;
  session.timestamp = Date.now();
  session.sessionId = newSessionId;

  if (kioskMode === "deposit") {
    session.step = "gate_open";
    sendToArduino("OPEN_GATE");
  } else {
    session.step = "identified";
  }

  broadcastState();
  return;
}
  // Timeout — no bottle inserted
  if (line === "TIMEOUT") {
    session.step     = "idle";
    session.errorMsg = "No bottle inserted. Gate closed.";
    broadcastState();
    setTimeout(resetSession, 4000);
    return;
  }

  // IR detected
  if (line === "IR:DETECTED") {
    session.step = "ir";
    setStep("ir", "running");
    broadcastState();
    setTimeout(() => {
      setStep("ir", "pass", "Bottle insertion confirmed");
      session.step = "capacitive";
      setStep("capacitive", "running");
      broadcastState();
    }, 500);
    return;
  }

  // Capacitive
  if (line === "CAP:PASS") {
    setStep("capacitive", "pass", "Physical presence confirmed");
    session.step = "tof";
    setStep("tof", "running");
    broadcastState();
    return;
  }
  if (line === "CAP:FAIL") {
    setStep("capacitive", "fail", "No bottle detected at sensor");
    session.step     = "result";
    session.result   = "rejected";
    session.errorMsg = "Capacitive sensor found no bottle. Try again.";
    broadcastState();
    sendToArduino("REJECT");
    setTimeout(resetSession, 5000);
    return;
  }

  // ToF height
  if (line.startsWith("TOF:HEIGHT:")) {
    const heightMm = parseFloat(line.split(":")[2]);
    session.heightMm = heightMm;
    if (heightMm < 80 || heightMm > 320) {
      setStep("tof", "fail", `Height ${heightMm}mm out of range`);
      session.step     = "result";
      session.result   = "rejected";
      session.errorMsg = `Invalid bottle size (height ${heightMm}mm). Only PET bottles accepted.`;
      broadcastState();
      sendToArduino("REJECT");
      setTimeout(resetSession, 5000);
    } else {
      setStep("tof", "pass", `Height: ${heightMm}mm`);
      session.step = "loadcell";
      setStep("loadcell", "running");
      broadcastState();
    }
    return;
  }
  if (line === "TOF:FAIL:TIMEOUT") {
    setStep("tof", "fail", "Sensor timeout");
    session.step     = "result";
    session.result   = "rejected";
    session.errorMsg = "Height sensor timed out. Try again.";
    broadcastState();
    sendToArduino("REJECT");
    setTimeout(resetSession, 5000);
    return;
  }

  // Load cell weight
  if (line.startsWith("LOADCELL:WEIGHT:")) {
    const weightG = parseFloat(line.split(":")[2]);
    session.weightG = weightG;
    const match = classifyBottle(session.heightMm!, weightG);

    if (!match) {
      setStep("loadcell", "fail", `Weight ${weightG}g doesn't match height`);
      session.step     = "result";
      session.result   = "rejected";
      session.errorMsg = `Size mismatch — height and weight don't match a valid bottle type.`;
      broadcastState();
      sendToArduino("REJECT");
      setTimeout(resetSession, 5000);
    } else {
      setStep("loadcell", "pass", `Weight: ${weightG}g — ${match.label}`);
      session.size   = match.label;
      session.step   = "result";
      session.result = "accepted";

      db.prepare(`
        INSERT INTO transactions (rfid, type, size, height_mm, weight_g, credits)
        VALUES (?, 'deposit', ?, ?, ?, 1)
      `).run(session.rfid, match.label, session.heightMm, weightG);
      db.prepare(`UPDATE users SET credits = credits + 1 WHERE rfid = ?`).run(session.rfid);

      const updated = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(session.rfid) as any;
      session.credits = updated.credits;

      broadcastState();
      sendToArduino("ACCEPT");
      setTimeout(resetSession, 6000);
    }
    return;
  }
});

// ── REST ──────────────────────────────────────────────────────────────────────
app.get("/api/session", (_req, res) => res.json(session));

httpServer.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));