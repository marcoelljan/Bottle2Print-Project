import path from "path";
import fs from "fs";
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
import { recordSensorActivity, setSerialStatus, recordHeartbeat, startHealthWatch, recordBinLevel, recordIdleStatus } from "./sensorHealth";
import { getCalibration, classifyBottle, tofInUse } from "./sensorConfig";
import { registerBusyCheck } from "./kioskState";
import { registerTofCalSender, handleTofCalLine } from "./tofCal";
import { EventEmitter } from "events";


const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;
const ARDUINO_PORT = process.env.ARDUINO_PORT || "/dev/tty.usbmodem14101";
const BAUD_RATE = 9600;

// ── PIN policy ─────────────────────────────────────────────────────────────
const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 20 * 1000; // 20 second cooldown

function logReject(stage: string, reason: string, heightMm: number | null, weightG: number | null) {
  if (!session.rfid) return;
  try {
    db.prepare(`
      INSERT INTO transactions (rfid, type, height_mm, weight_g, co2_saved_g, credits, reject_stage, reject_reason)
      VALUES (?, 'reject', ?, ?, 0, 0, ?, ?)
    `).run(session.rfid, heightMm, weightG, stage, reason);
  } catch (e) { console.error("logReject failed:", e); }
}

function co2SavedGrams(weightG: number): number {
  return (weightG / 1000) * 3000;
}

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

registerBusyCheck(() =>
  SENSOR_IN_PROGRESS_STEPS.includes(session.step) ||
  session.step === "result" ||
  rfidDepositSessionActive ||
  (session.rfid === "GUEST" && isGuestActive())
);

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
  sendToArduino(session.rfid === "GUEST" ? "GUEST_START" : "PROCEED");   // re-arm the Arduino for the next bottle
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

const app = express();
app.use(cors());
app.use(express.json());

type KioskMode = "deposit" | "register" | "balance" | "print" | "admin" | "idle";
let kioskMode: KioskMode = "idle";

// ── 1. MOUNT API ROUTES FIRST ──────────────────────────────────────────────
app.post("/api/mode", (req, res) => {
  kioskMode = req.body.mode as KioskMode;
  console.log("Kiosk mode:", kioskMode);
  resetSession(true);
  res.json({ success: true, mode: kioskMode });
});

app.get("/api/mode", (_req, res) => res.json({ mode: kioskMode }));

app.post("/api/session/verify-pin", async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: "Missing pin." });
  if (session.step !== "awaiting_pin" || !session.rfid) {
    return res.status(400).json({ error: "No active PIN request." });
  }

  const rfid = session.rfid;
  const user = db.prepare(`
    SELECT *, TRIM(firstname || ' ' || COALESCE(middlename, '') || ' ' || surname) AS name 
    FROM users 
    WHERE rfid = ?
  `).get(rfid) as any;

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
    sendToArduino(session.rfid === "GUEST" ? "GUEST_START" : "PROCEED");
  } else {
    session.step = "identified";
  }

  broadcastState();
  res.json({ success: true });
});

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
  sendToArduino("GUEST_START");

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

// Mount modular routers
app.use(userRoutes);
app.use(printRoutes);
app.use(adminRoutes);
app.use(feedbackRoutes);

// ── 2. SERVE FRONTEND STATIC FILES SECOND ──────────────────────────────────
const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
} else {
  console.warn(`[Warning] Frontend build directory not found at: ${frontendDist}. Run 'npm run build' in your frontend folder.`);
}

// ── 3. SPA CATCH-ALL FALLBACK LAST ─────────────────────────────────────────
app.get(/^(?!\/api|\/upload).*/, (_req, res) => {
  if (fs.existsSync(path.join(frontendDist, "index.html"))) {
    res.sendFile(path.join(frontendDist, "index.html"));
  } else {
    res.status(404).send("Frontend build not found. Please build your frontend application.");
  }
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

const lineBus = new EventEmitter();           // every line from the Arduino arrives here
let serial: SerialPort | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_DELAY_MS = 5000;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectSerial(); }, RECONNECT_DELAY_MS);
}

function handleSerialDown(status: "error" | "disconnected", message?: string) {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  setSerialStatus(status, message);
  if (session.step !== "idle") resetSession(true);   // don't leave a user on "Validating bottle..."
  scheduleReconnect();
}

function connectSerial() {
  const port = new SerialPort({ path: ARDUINO_PORT, baudRate: BAUD_RATE, autoOpen: false });
  serial = port;
  const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
  parser.on("data", (line: string) => lineBus.emit("data", line));

  port.on("open", () => {
    console.log(`Serial open: ${ARDUINO_PORT}`);
    setSerialStatus("connected");
    setTimeout(() => {
      if (serial === port && port.isOpen) { port.write("RESET\n"); console.log("Sent RESET to Arduino"); }
    }, 2000);
    heartbeatTimer = setInterval(() => sendToArduino("PING"), 5000);
  });
  port.on("error", err => {
    if (serial !== port) return;
    console.error("Serial error:", err.message);
    handleSerialDown("error", err.message);
  });
  port.on("close", () => {
    if (serial !== port) return;
    console.warn("Serial port closed");
    handleSerialDown("disconnected");
  });
  port.open();
}

function sendToArduino(cmd: string) {
  if (serial && serial.isOpen) serial.write(cmd + "\n");
}

startHealthWatch();
registerTofCalSender(() => sendToArduino("TOFCAL"));
connectSerial();

lineBus.on("data", (raw: string) => {
  const line = raw.trim();
  if (!line.startsWith("STATUS:")) console.log("Arduino →", line);

  if (line === "PONG") { recordHeartbeat(); return; }
  if (line === "RFID:TIMEOUT") return;
    if (line.startsWith("STATUS:")) {
    const [, sensor, value] = line.split(":");
    recordIdleStatus(sensor, value);
    return;
  }
    if (line.startsWith("TOFCAL:")) { handleTofCalLine(line); return; }
  if (line === "VERDICT:ACCEPTED") { recordSensorActivity("servo", "Gate → storage (accept)"); return; }
  if (line === "VERDICT:REJECTED") { recordSensorActivity("servo", "Gate → reject chute"); return; }

  if (line.startsWith("RFID:")) {
    recordSensorActivity("rfid");
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

    const user = db.prepare(`
      SELECT *, TRIM(firstname || ' ' || COALESCE(middlename, '') || ' ' || surname) AS name 
      FROM users 
      WHERE rfid = ?
    `).get(rfid) as any;

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
    recordSensorActivity("ir");
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
    recordSensorActivity("capacitive", "pass");
    if (session.step === "result") return;
    setStep("capacitive", "pass", "Physical presence confirmed");
    session.step = "tof";
    setStep("tof", "running");
    broadcastState();
    return;
  }
  if (line === "CAP:FAIL") {
    recordSensorActivity("capacitive", "fail");
    if (session.step === "result") return;
    setStep("capacitive", "fail", "Invalid material or contaminant detected");
    session.step     = "result";
    session.result   = "rejected";
    session.errorMsg = "Contaminant detected. Only plastic bottles accepted.";
    logReject("capacitive", "Contaminant or non-plastic material detected.", null, null);
    broadcastState();
    sendToArduino("REJECT");
    setTimeout(() => continueDepositLoop(), 3000);
    return;
  }

       if (line.startsWith("TOF:RAW:") || line.startsWith("TOF:FAIL")) {
    if (session.step === "result") return;
    let heightMm = 0;
    if (line.startsWith("TOF:RAW:")) {
      const raw = parseFloat(line.split(":")[2]);
      const mount = getCalibration().tofMountMm;
      heightMm = Number.isFinite(raw) && raw < mount - 15 ? Math.round(mount - raw) : 0; // 0 = no usable height
    }

    // No reading (timeout / nothing seen): ToF unavailable, weight decides
    if (!(heightMm > 0)) {
      session.heightMm = null;
      recordSensorActivity("tof", "no reading", "fault");
      setStep("tof", "pass", "ToF unavailable, using weight only");
      session.step = "loadcell";
      setStep("loadcell", "running");
      broadcastState();
      return;
    }

    session.heightMm = heightMm;
    recordSensorActivity("tof", `${heightMm}mm`);

    const cal = getCalibration();
    // The sanity range is only enforced once ToF has been calibrated
    if (tofInUse(cal) && (heightMm < cal.tofMinMm || heightMm > cal.tofMaxMm)) {
      setStep("tof", "fail", `Height ${heightMm}mm out of range`);
      session.step     = "result";
      session.result   = "rejected";
      session.errorMsg = `Invalid bottle size (height ${heightMm}mm). Only PET accepted.`;
      logReject("tof", `Height ${heightMm}mm outside the valid range (${cal.tofMinMm}-${cal.tofMaxMm}mm).`, heightMm, null);
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

    const rawWeight = parseFloat(line.split(":")[2]);
    const weightOk  = Number.isFinite(rawWeight) && rawWeight > 0;
    const weightG   = weightOk ? rawWeight : 0;
    session.weightG = weightOk ? rawWeight : null;
    recordSensorActivity("loadcell", weightOk ? `${rawWeight}g` : "no reading", weightOk ? "ok" : "fault");

    const { band: match, mode, reason, stage } = classifyBottle(session.heightMm, weightOk ? rawWeight : null);

    if (!match) {
      logReject(stage ?? "loadcell", reason ?? "Failed validation.", session.heightMm, weightOk ? rawWeight : null);
      setStep("loadcell", "fail", reason ?? "Validation failed");
      session.step     = "result";
      session.result   = "rejected";
      session.errorMsg = `Bottle rejected: ${reason ?? "failed validation"}`;
      broadcastState();
      sendToArduino("REJECT");
      setTimeout(() => continueDepositLoop(), 3000);
    } else {
      const creditsEarned = match.credits;
      const co2Grams = co2SavedGrams(weightG);

      setStep("loadcell", "pass", `${weightOk ? weightG + "g" : "no weight"} · ${match.label} (+${creditsEarned}) [${mode}]`);
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

    if (line === "OBJECT:TIMEOUT") {
    if (session.step === "ir" && (rfidDepositSessionActive || session.rfid === "GUEST")) {
      sendToArduino(session.rfid === "GUEST" ? "GUEST_START" : "PROCEED");
    }
    return;
  }

    if (line === "CONFIRM:STORAGE_OK") {
    recordSensorActivity("photoelectric", "Storage confirmed");
    return;
  }

  if (line === "CONFIRM:JAM_DETECTED") {
    recordSensorActivity("photoelectric", "Jam or no detection", "fault");
    setTimeout(() => continueDepositLoop(), 3000);
    return;
  }

  if (line.startsWith("BIN:FILL_LEVEL_CM:")) {
    const cm = parseFloat(line.split(":")[2]);
    if (Number.isFinite(cm)) {
      recordBinLevel(cm);
      recordSensorActivity("ultrasonic", `${cm} cm from sensor`);
    }
    setTimeout(() => continueDepositLoop(), 3000);
    return;
  }

  if (line === "BIN:ERROR") {
    recordSensorActivity("ultrasonic", "No echo", "fault");
    setTimeout(() => continueDepositLoop(), 3000);
    return;
  }
});

httpServer.listen(PORT, () => console.log(`Backend on http://localhost:${PORT}`));