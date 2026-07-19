import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { db } from "./db";
import userRoutes from "./routes/user";
import printRoutes from "./routes/print";
import adminRoutes from "./routes/admin";
import feedbackRoutes from "./routes/feedback";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;
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
  timestamp:   number;
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

// The sensor states where a bottle is actively being validated.
// We must never silently wipe rfid/session data while one of these is active,
// or in-flight serial events (like LOADCELL:WEIGHT) will crash trying to
// write a null rfid to the transactions table.
const SENSOR_IN_PROGRESS_STEPS = ["ir", "capacitive", "tof", "loadcell"];

// CHANGE 1: resetSession now takes a `force` flag.
// - force=false (default): used by internal/automatic timeouts. Will NOT
//   reset if a bottle validation is actively in progress.
// - force=true: used when the kiosk operator explicitly changes screens/mode.
//   Always resets, guaranteeing every screen starts from a clean session.
function resetSession(force = false) {
  if (!force && SENSOR_IN_PROGRESS_STEPS.includes(session.step)) {
    // A bottle is mid-validation (IR/CAP/TOF/LOADCELL) — don't clobber it.
    console.log(`resetSession skipped: validation in progress (step=${session.step})`);
    return;
  }

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

// CHANGE 2: every mode switch — not just switching to "idle" — now force-resets
// the session. This guarantees a screen never inherits stale state from a
// previous tap (this was the cause of Register skipping the RFID prompt).
app.post("/api/mode", (req, res) => {
  kioskMode = req.body.mode as KioskMode;
  console.log("Kiosk mode:", kioskMode);
  resetSession(true);
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
  const data = JSON.stringify({ type: "state", session: { ...session, timestamp: Date.now() } });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "state", session: { ...session, timestamp: 0 } }));
});

// ── Serial ────────────────────────────────────────────────────────────────────
const serial = new SerialPort({ path: ARDUINO_PORT, baudRate: BAUD_RATE });
const parser = serial.pipe(new ReadlineParser({ delimiter: "\r\n" }));

serial.on("open", () => {
  console.log(`Serial open: ${ARDUINO_PORT}`);
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

  if (line === "READY") {
    console.log("✅ Arduino boot sequence complete and ready for commands.");
  }
  if (line === "RESET:OK") {
    console.log("✅ Arduino acknowledged RESET command.");
  }

  if (line === "RFID:TIMEOUT") {
    console.log("Arduino reported internal RFID timeout (no OPEN_GATE sent) — ignoring, not a real tap.");
    return;
  }

 if (line.startsWith("RFID:")) {
    const rfid = line.split(":")[1];
    const newSessionId = Date.now();
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

      // CHANGE 3: removed the blanket 5s auto-reset after tapping in register
      // mode. It was wiping session.rfid out from under the person while they
      // were still filling out the name/studentId form. The register screen
      // itself already resets the session on unmount (via /api/mode: idle),
      // so we don't need a server-side timer racing against the form here.
      // We keep a short auto-reset ONLY for the "already registered" dead-end,
      // since there's no form to fill out there.
      if (isFullyRegistered) {
        setTimeout(() => resetSession(), 3000);
      }
      return;
    }

    if (kioskMode === "admin") {
      session.rfid      = rfid;
      session.userName  = user?.name ?? null;
      session.credits   = 0;
      session.steps     = freshSteps();
      session.result    = null;
      session.errorMsg  = null;
      session.timestamp = Date.now();
      session.sessionId = newSessionId;
      session.step      = "identified";
      broadcastState();
      setTimeout(() => resetSession(), 3000);
      return;
    }

    if (!user || !user.studentId || user.studentId.trim() === "") {
      session.rfid      = rfid;
      session.step      = "unregistered";
      session.timestamp = Date.now();
      session.sessionId = newSessionId;
      broadcastState();
      sendToArduino("IGNORE");
      setTimeout(() => resetSession(), 3000);
      return;
    }

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
    setTimeout(() => resetSession(), 2000);
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
    setTimeout(() => resetSession(), 3000);
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
      setTimeout(() => resetSession(), 5000);
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
    setTimeout(() => resetSession(), 5000);
    return;
  }

  // Load cell weight
  if (line.startsWith("LOADCELL:WEIGHT:")) {
    // CHANGE 4 (defensive backstop): if session.rfid somehow got wiped out
    // from under us (e.g. an unexpected mode switch mid-validation), don't
    // crash the server trying to insert a null rfid — just log and bail.
    if (!session.rfid) {
      console.warn("LOADCELL:WEIGHT received but session.rfid is null — ignoring reading, resetting.");
      sendToArduino("REJECT");
      resetSession(true);
      return;
    }

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
      setTimeout(() => resetSession(), 5000);
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
      setTimeout(() => resetSession(), 6000);
    }
    return;
  }
});

// ── REST ──────────────────────────────────────────────────────────────────────
app.get("/api/session", (_req, res) => res.json(session));

httpServer.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));