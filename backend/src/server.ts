import path from "path";
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
import { setWss } from "./wsHub";
import { isGuestActive, startGuestSession, addGuestCredit, getGuestCredits } from "./guestSession";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;
const ARDUINO_PORT = process.env.ARDUINO_PORT || "/dev/tty.usbmodem14101";
const BAUD_RATE = 9600;

// ── Size classification ───────────────────────────────────────────────────────
interface SizeSpec { label: string; minHeight: number; maxHeight: number; minWeight: number; maxWeight: number; }
const SIZE_SPECS: SizeSpec[] = [
  { label: "Small",  minHeight: 100, maxHeight: 150, minWeight: 14, maxWeight: 19 },
  { label: "Medium", minHeight: 151, maxHeight: 210, minWeight: 14, maxWeight: 19 },
  { label: "Large",  minHeight: 211, maxHeight: 280, minWeight: 18, maxWeight: 25 },
  { label: "XL",     minHeight: 281, maxHeight: 350, minWeight: 48, maxWeight: 57 },
];

const SIZE_CREDITS: Record<string, number> = {
  Small: 1,
  Medium: 2,
  Large: 3,
  XL: 4,
};

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
  step: "idle" | "identified" | "already_registered" | "unregistered" | "ir" | "capacitive" | "tof" | "loadcell" | "result";
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

const SENSOR_IN_PROGRESS_STEPS = ["ir", "capacitive", "tof", "loadcell"];
let guestStopRequested = false;

function resetSession(force = false) {
  if (!force && SENSOR_IN_PROGRESS_STEPS.includes(session.step)) {
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

const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
app.use(express.static(frontendDist));

app.post("/api/mode", (req, res) => {
  kioskMode = req.body.mode as KioskMode;
  console.log("Kiosk mode:", kioskMode);
  resetSession(true);
  res.json({ success: true, mode: kioskMode });
});

function continueGuestLoop() {
  if (guestStopRequested || !isGuestActive()) {
    guestStopRequested = false;
    resetSession(true);
    return;
  }
  session.steps    = freshSteps();
  session.result   = null;
  session.errorMsg = null;
  session.heightMm = null;
  session.weightG  = null;
  session.size     = null;
  session.step     = "ir"; // Waiting for bottle insertion
  broadcastState();
}

app.get("/api/mode", (_req, res) => res.json({ mode: kioskMode }));

app.post("/api/deposit/guest-start", (_req, res) => {
  guestStopRequested = false;
  startGuestSession();

  session.rfid      = "GUEST";
  session.userName  = "Guest";
  session.credits   = getGuestCredits();
  session.steps     = freshSteps();
  session.result    = null;
  session.errorMsg  = null;
  session.timestamp = Date.now();
  session.sessionId = Date.now();
  session.step      = "ir";

  broadcastState();
  res.json({ success: true, credits: getGuestCredits() });
});

app.get("/api/deposit/guest-status", (_req, res) => {
  res.json({ active: isGuestActive(), credits: getGuestCredits() });
});

app.post("/api/deposit/guest-stop", (_req, res) => {
  guestStopRequested = true;
  resetSession(true);
  res.json({ success: true, credits: getGuestCredits() });
});

app.get("/api/session", (_req, res) => res.json(session));

app.use(userRoutes);
app.use(printRoutes);
app.use(adminRoutes);
app.use(feedbackRoutes);

app.get(/^(?!\/api|\/upload).*/, (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
setWss(wss);

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
    console.log("Arduino reported RFID timeout — ignoring.");
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
      session.step = "ir"; // Waiting for bottle to pass IR pre-chamber sensor
    } else {
      session.step = "identified";
    }

    broadcastState();
    return;
  }

  if (line === "TIMEOUT") {
    if (session.step === "result") return;
    session.step     = "idle";
    session.errorMsg = "No bottle inserted.";
    broadcastState();
    setTimeout(() => {
      if (session.rfid === "GUEST") continueGuestLoop();
      else resetSession();
    }, 2000);
    return;
  }

  // IR detected (Step 2)
  if (line === "IR:DETECTED") {
    if (session.step === "result") return;
    session.step = "ir";
    setStep("ir", "running");
    broadcastState();
    setTimeout(() => {
      if (session.step === "result") return;
      setStep("ir", "pass", "Bottle insertion confirmed");
      session.step = "capacitive";
      setStep("capacitive", "running");
      broadcastState();
    }, 300);
    return;
  }

  // Capacitive (Step 5)
  if (line === "CAP:PASS") {
    if (session.step === "result") return;
    setStep("capacitive", "pass", "Physical presence confirmed");
    session.step = "tof";
    setStep("tof", "running");
    broadcastState();
    return;
  }
  if (line === "CAP:FAIL") {
    if (session.step === "result") return;
    setStep("capacitive", "fail", "No bottle detected");
    session.step     = "result";
    session.result   = "rejected";
    session.errorMsg = "Capacitive sensor found no bottle. Try again.";
    broadcastState();
    sendToArduino("REJECT");
    setTimeout(() => {
      if (session.rfid === "GUEST") continueGuestLoop();
      else resetSession();
    }, 3000);
    return;
  }

  // ToF height (Step 4)
  if (line.startsWith("TOF:HEIGHT:")) {
    if (session.step === "result") return;
    const heightMm = parseFloat(line.split(":")[2]);
    session.heightMm = heightMm;
    if (heightMm < 80 || heightMm > 350) {
      setStep("tof", "fail", `Height ${heightMm}mm out of range`);
      session.step     = "result";
      session.result   = "rejected";
      session.errorMsg = `Invalid bottle size (height ${heightMm}mm). Only PET accepted.`;
      broadcastState();
      sendToArduino("REJECT");
      setTimeout(() => {
        if (session.rfid === "GUEST") continueGuestLoop();
        else resetSession();
      }, 5000);
    } else {
      setStep("tof", "pass", `Height: ${heightMm}mm`);
      session.step = "loadcell";
      setStep("loadcell", "running");
      broadcastState();
    }
    return;
  }
  if (line === "TOF:FAIL:TIMEOUT") {
    if (session.step === "result") return;
    setStep("tof", "fail", "Sensor timeout");
    session.step     = "result";
    session.result   = "rejected";
    session.errorMsg = "Height sensor timed out.";
    broadcastState();
    sendToArduino("REJECT");
    setTimeout(() => {
      if (session.rfid === "GUEST") continueGuestLoop();
      else resetSession();
    }, 5000);
    return;
  }

  // Load cell weight (Step 3)
  if (line.startsWith("LOADCELL:WEIGHT:")) {
    if (!session.rfid || session.step === "result") {
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
    } else {
      const creditsEarned = SIZE_CREDITS[match.label] ?? 1;

      setStep("loadcell", "pass", `Weight: ${weightG}g — ${match.label} (+${creditsEarned})`);
      session.size   = match.label;
      session.step   = "result";
      session.result = "accepted";

      if (session.rfid === "GUEST") {
        addGuestCredit(creditsEarned);
        session.credits = getGuestCredits();
      } else {
        db.prepare(`
          INSERT INTO transactions (rfid, type, size, height_mm, weight_g, credits)
          VALUES (?, 'deposit', ?, ?, ?, ?)
        `).run(session.rfid, match.label, session.heightMm, weightG, creditsEarned);
        db.prepare(`UPDATE users SET credits = credits + ? WHERE rfid = ?`).run(creditsEarned, session.rfid);

        const updated = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(session.rfid) as any;
        session.credits = updated.credits;
      }

      broadcastState();
      sendToArduino("ACCEPT"); // Triggers Step 6 Diverter Servo Sorting
    }
    return;
  }

  // Step 7: Storage Confirmation (Photoelectric Sensor)
  if (line === "CONFIRM:STORAGE_OK") {
    console.log("✅ Step 7: Bottle confirmed passing into storage successfully.");
    return;
  }

  if (line === "CONFIRM:JAM_DETECTED") {
    console.warn("⚠️ Step 7: Storage jam detected!");
    session.errorMsg = "Warning: Bottle jam detected in storage chute.";
    broadcastState();
    return;
  }

  // Step 8: Post-Deposit Bin Fill Level (Ultrasonic Sensor)
  if (line.startsWith("BIN:FILL_LEVEL_CM:")) {
    const fillDistanceCm = parseInt(line.split(":")[2], 10);
    console.log(`🗑️ Step 8: Recycling bin fill distance: ${fillDistanceCm}cm from sensor.`);
    
    setTimeout(() => {
      if (session.rfid === "GUEST") continueGuestLoop();
      else resetSession();
    }, 2000);
    return;
  }
});

httpServer.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));