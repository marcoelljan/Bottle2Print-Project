import path from "path";
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
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

// ── PIN policy ─────────────────────────────────────────────────────────────
const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 20 * 1000; // 20 second cooldown

// ── Size classification based on real physical testing (250ml - 1500ml) ────────
interface SizeSpec { label: string; minWeight: number; maxWeight: number; }
const SIZE_SPECS: SizeSpec[] = [
  { label: "Small",  minWeight: 11, maxWeight: 14 },
  { label: "Medium", minWeight: 15, maxWeight: 19 },
  { label: "Large",  minWeight: 20, maxWeight: 25 },
  { label: "XL",     minWeight: 40, maxWeight: 60 },
];
const SIZE_CREDITS: Record<string, number> = {
  Small: 1,
  Medium: 2,
  Large: 3,
  XL: 4,
};

function classifyBottleSecure(heightMm: number, weightG: number): SizeSpec | null {
  // 🚫 ANTI-WATER / TAMPER GUARD:
  // 1. Absolute ceiling: Standard empty bottles max out at 60g (XL). Anything above 68g is liquid/rocks.
  if (weightG > 68) return null;

  // 2. Proportional sanity check: A short bottle (height < 100mm) cannot weigh more than 35g.
  if (heightMm < 100 && weightG > 35) return null;

  // Match strictly to your tested weight tiers
  return SIZE_SPECS.find(
    s => weightG >= s.minWeight && weightG <= s.maxWeight
  ) ?? null;
}

function co2SavedGrams(weightG: number): number {
  return (weightG / 1000) * 3000;
}

// ── Validation state machine ──────────────────────────────────────────────────
type StepStatus = "pending" | "running" | "pass" | "fail";
interface ValidationStep { id: string; label: string; status: StepStatus; detail?: string; }

interface SessionState {
  rfid:        string | null;
  userName:    string | null;
  credits:     number;
  step: "idle" | "awaiting_pin" | "awaiting_new_pin" | "identified" | "already_registered" | "unregistered"
      | "ir" | "capacitive" | "tof" | "loadcell" | "result" | "session_summary";
  steps:       ValidationStep[];
  heightMm:    number | null;
  weightG:     number | null;
  size:        string | null;
  result:      "accepted" | "rejected" | null;
  errorMsg:    string | null;
  timestamp:   number;
  sessionId:   number;
  depositBottleCount:   number;
  depositCreditsEarned: number;
  depositCo2Grams:      number;
}

function freshSteps(): ValidationStep[] {
  return [
    { id: "ir",        label: "Bottle detected",   status: "pending" },
    { id: "capacitive",label: "Presence confirmed", status: "pending" },
    { id: "tof",       label: "Height measured",    status: "pending" },
    { id: "loadcell",  label: "Weight verified",    status: "pending" },
  ];
}

function freshDepositTotals() {
  return { depositBottleCount: 0, depositCreditsEarned: 0, depositCo2Grams: 0 };
}

let session: SessionState = {
  rfid: null, userName: null, credits: 0,
  step: "idle", steps: freshSteps(),
  heightMm: null, weightG: null, size: null,
  result: null, errorMsg: null,
  timestamp: 0, sessionId: 0,
  ...freshDepositTotals(),
};

const SENSOR_IN_PROGRESS_STEPS = ["ir", "capacitive", "tof", "loadcell"];

let rfidDepositSessionActive = false;
let depositStopRequested = false;

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
    ...freshDepositTotals(),
  };
  rfidDepositSessionActive = false;
  depositStopRequested = false;
  broadcastState();
}

function setStep(id: string, status: StepStatus, detail?: string) {
  const s = session.steps.find(s => s.id === id);
  if (s) { s.status = status; if (detail) s.detail = detail; }
}

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

function continueDepositLoop() {
  const stillActive = session.rfid === "GUEST" ? isGuestActive() : rfidDepositSessionActive;

  if (depositStopRequested || !stillActive) {
    finalizeDepositSession();
    return;
  }

  session.steps    = freshSteps();
  session.result   = null;
  session.errorMsg = null;
  session.heightMm = null;
  session.weightG  = null;
  session.size     = null;
  session.step     = "ir";
  broadcastState();
}

function finalizeDepositSession() {
  depositStopRequested = false;
  rfidDepositSessionActive = false;
  session.step = "session_summary";
  broadcastState();
  setTimeout(() => {
    if (session.step === "session_summary") resetSession(true);
  }, 15000);
}

app.get("/api/mode", (_req, res) => res.json({ mode: kioskMode }));

// ── PIN verification — handles reset flagging workflow ─────────────────────
app.post("/api/session/verify-pin", async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "Missing pin." });
  if (session.step !== "awaiting_pin" || !session.rfid) {
    return res.status(400).json({ error: "No active PIN request." });
  }

  const rfid = session.rfid;
  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  if (!user || !user.pin_hash) {
    return res.status(400).json({ error: "No PIN set for this account." });
  }

  if (user.pin_locked_until) {
    const remainingMs = new Date(user.pin_locked_until).getTime() - Date.now();
    if (remainingMs > 0) {
      return res.status(423).json({
        error: "Too many incorrect attempts. Please wait before trying again.",
        lockedOut: true,
        secondsRemaining: Math.ceil(remainingMs / 1000),
      });
    }
  }

  let match = false;
  try {
    match = await bcrypt.compare(String(pin), user.pin_hash);
  } catch {
    return res.status(500).json({ error: "Could not verify PIN." });
  }

  if (!match) {
    const newFailCount = (user.pin_fail_count ?? 0) + 1;

    if (newFailCount >= PIN_MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
      db.prepare("UPDATE users SET pin_fail_count = 0, pin_locked_until = ? WHERE rfid = ?").run(lockedUntil, rfid);
      return res.status(423).json({
        error: "Too many incorrect attempts. Please wait 20 seconds before trying again.",
        lockedOut: true,
        secondsRemaining: 20,
      });
    }

    db.prepare("UPDATE users SET pin_fail_count = ? WHERE rfid = ?").run(newFailCount, rfid);
    return res.status(401).json({
      error: "Incorrect PIN.",
      attemptsRemaining: PIN_MAX_ATTEMPTS - newFailCount,
    });
  }

  db.prepare("UPDATE users SET pin_fail_count = 0, pin_locked_until = NULL WHERE rfid = ?").run(rfid);

  // If user account was flagged by admin reset, force them to set a new PIN
  if (user.pin_needs_reset === 1) {
    session.step = "awaiting_new_pin";
    broadcastState();
    return res.json({ success: true, requiresNewPin: true });
  }

  if (kioskMode === "deposit") {
    rfidDepositSessionActive = true;
    depositStopRequested = false;
    Object.assign(session, freshDepositTotals());
    session.step = "ir";
    sendToArduino("PROCEED");
  } else {
    session.step = "identified";
  }

  broadcastState();
  res.json({ success: true });
});

// ── Forced PIN update route after an admin reset ───────────────────────────
app.post("/api/session/update-pin", async (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{6}$/.test(String(pin))) {
    return res.status(400).json({ error: "PIN must be exactly 6 digits." });
  }
  if (session.step !== "awaiting_new_pin" || !session.rfid) {
    return res.status(400).json({ error: "No active PIN update request." });
  }

  try {
    const newHash = await bcrypt.hash(String(pin), 10);
    db.prepare(`
      UPDATE users 
      SET pin_hash = ?, pin_needs_reset = 0, pin_fail_count = 0, pin_locked_until = NULL 
      WHERE rfid = ?
    `).run(newHash, session.rfid);

    if (kioskMode === "deposit") {
      rfidDepositSessionActive = true;
      depositStopRequested = false;
      Object.assign(session, freshDepositTotals());
      session.step = "ir";
      sendToArduino("PROCEED");
    } else {
      session.step = "identified";
    }

    broadcastState();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update PIN: " + err.message });
  }
});

app.post("/api/deposit/finish", (_req, res) => {
  depositStopRequested = true;
  sendToArduino("DONE");

  const summary = {
    bottles:  session.depositBottleCount,
    credits:  session.depositCreditsEarned,
    co2Grams: session.depositCo2Grams,
  };

  if (!SENSOR_IN_PROGRESS_STEPS.includes(session.step)) {
    finalizeDepositSession();
  }

  res.json({ success: true, summary });
});

app.post("/api/deposit/guest-start", (_req, res) => {
  depositStopRequested = false;
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
  Object.assign(session, freshDepositTotals());

  broadcastState();
  res.json({ success: true, credits: getGuestCredits() });
});

app.get("/api/deposit/guest-status", (_req, res) => {
  res.json({ active: isGuestActive(), credits: getGuestCredits() });
});

app.post("/api/deposit/guest-stop", (_req, res) => {
  depositStopRequested = true;
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

  if (line === "RFID:TIMEOUT") return;

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
        String(user.studentId).trim().length > 0 &&
        user.pin_needs_reset !== 1
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
    session.step      = "awaiting_pin";
    broadcastState();

    setTimeout(() => {
      if (session.step === "awaiting_pin" && session.sessionId === newSessionId) {
        resetSession();
      }
    }, 30000);
    return;
  }

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
    setTimeout(() => continueDepositLoop(), 3000);
    return;
  }

  if (line.startsWith("TOF:HEIGHT:")) {
    if (session.step === "result") return;
    const heightMm = parseFloat(line.split(":")[2]);
    session.heightMm = heightMm;
    
    // TOF checks common bottle height bounds (40mm to 300mm)
    if (heightMm < 40 || heightMm > 300) {
      setStep("tof", "fail", `Height ${heightMm}mm out of range`);
      session.step     = "result";
      session.result   = "rejected";
      session.errorMsg = `Invalid bottle size (height ${heightMm}mm). Only PET accepted.`;
      broadcastState();
      sendToArduino("REJECT");
      setTimeout(() => continueDepositLoop(), 5000);
    } else {
      setStep("tof", "pass", `Height: ${heightMm}mm`);
      session.step = "loadcell";
      setStep("loadcell", "running");
      broadcastState();
    }
    return;
  }

  if (line.startsWith("LOADCELL:WEIGHT:")) {
    if (!session.rfid || session.step === "result") return;

    const weightG = parseFloat(line.split(":")[2]);
    session.weightG = weightG;
    
    // Secure classification: load cell categorizes size, TOF + ceiling acts as water/tamper guard
    const match = classifyBottleSecure(session.heightMm!, weightG);

    if (!match) {
      setStep("loadcell", "fail", `Weight ${weightG}g failed validation or liquid detected`);
      session.step     = "result";
      session.result   = "rejected";
      session.errorMsg = `Bottle rejected: Abnormal weight or liquid detected.`;
      broadcastState();
      sendToArduino("REJECT");
      setTimeout(() => continueDepositLoop(), 3000);
    } else {
      const creditsEarned = SIZE_CREDITS[match.label] ?? 1;
      const co2Grams = co2SavedGrams(weightG);

      setStep("loadcell", "pass", `Weight: ${weightG}g — ${match.label} (+${creditsEarned})`);
      session.size   = match.label;
      session.step   = "result";
      session.result = "accepted";

      if (session.rfid === "GUEST") {
        addGuestCredit(creditsEarned);
        session.credits = getGuestCredits();
      } else {
        db.prepare(`
          INSERT INTO transactions (rfid, type, size, height_mm, weight_g, co2_saved_g, credits)
          VALUES (?, 'deposit', ?, ?, ?, ?, ?)
        `).run(session.rfid, match.label, session.heightMm, weightG, co2Grams, creditsEarned);
        db.prepare(`UPDATE users SET credits = credits + ? WHERE rfid = ?`).run(creditsEarned, session.rfid);

        const updated = db.prepare("SELECT credits FROM users WHERE rfid = ?").get(session.rfid) as any;
        session.credits = updated.credits;
      }

      session.depositBottleCount   += 1;
      session.depositCreditsEarned += creditsEarned;
      session.depositCo2Grams      += co2Grams;

      broadcastState();
      sendToArduino("ACCEPT");
    }
    return;
  }

  if (line.startsWith("BIN:FILL_LEVEL_CM:")) {
    setTimeout(() => continueDepositLoop(), 3000);
    return;
  }
});

httpServer.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));