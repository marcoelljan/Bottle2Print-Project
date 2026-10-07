import { db } from "./db";
import { getCalibration } from "./sensorConfig";

export type SensorId = "ir" | "capacitive" | "tof" | "loadcell" | "rfid" | "photoelectric" | "ultrasonic" | "servo";
export type SerialStatus = "connected" | "disconnected" | "error";
export type OverallStatus = "online" | "unresponsive" | "offline";
export type SensorState = "ok" | "fault" | "unknown";

const HEARTBEAT_STALE_MS = 12000; // tolerant of the 2-3s blocking loops in firmware
const FAULT_THRESHOLD = 3;        // bad readings in a row before a fault is logged

interface SensorHealth {
  lastSeen: number | null;
  lastDetail: string | null;
  state: SensorState;
}

const SENSOR_NAMES: Record<SensorId, string> = {
  ir: "IR sensor", capacitive: "Capacitive sensor", tof: "ToF sensor",
  loadcell: "Load cell", rfid: "RFID reader",
  photoelectric: "Photoelectric sensor", ultrasonic: "Ultrasonic sensor", servo: "Servo gate",
};
const IDS = Object.keys(SENSOR_NAMES) as SensorId[];

const health = {} as Record<SensorId, SensorHealth>;
const faultStreak = {} as Record<SensorId, number>;
const faultLogged = {} as Record<SensorId, boolean>;
for (const id of IDS) {
  health[id] = { lastSeen: null, lastDetail: null, state: "unknown" };
  faultStreak[id] = 0;
  faultLogged[id] = false;
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user TEXT NOT NULL,
      action     TEXT NOT NULL,
      details    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch (e) {}

function logSystem(action: string, details: string) {
  try {
    db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)")
      .run("System Kiosk", action, details);
  } catch (e) {}
}

let serialStatus: SerialStatus = "disconnected";
let serialErrorMsg: string | null = null;
let serialConnectedSince: number | null = null;
let lastHeartbeatAt: number | null = null;

// Bin level (ultrasonic): distance from the sensor to whatever is in the bin
let binDistanceCm: number | null = null;
let binUpdatedAt: number | null = null;

export function recordBinLevel(distanceCm: number) {
  binDistanceCm = distanceCm;
  binUpdatedAt = Date.now();
}

function binFillPercent(): number | null {
  if (binDistanceCm === null) return null;
  const { binEmptyCm, binFullCm } = getCalibration();
  const span = binEmptyCm - binFullCm;
  if (!(span > 0)) return null;
  const pct = ((binEmptyCm - binDistanceCm) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function recordSensorActivity(id: SensorId, detail?: string, state: SensorState = "ok") {
  health[id] = { lastSeen: Date.now(), lastDetail: detail ?? null, state };

  if (state === "fault") {
    faultStreak[id]++;
    if (faultStreak[id] >= FAULT_THRESHOLD && !faultLogged[id]) {
      faultLogged[id] = true;
      logSystem("SENSOR_FAULT", `${SENSOR_NAMES[id]}: ${detail ?? "fault"} (${FAULT_THRESHOLD} bad readings in a row)`);
    }
  } else {
    faultStreak[id] = 0;
    if (faultLogged[id]) {
      faultLogged[id] = false;
      logSystem("SENSOR_RECOVERED", `${SENSOR_NAMES[id]} reading normally again`);
    }
  }
}

export function recordHeartbeat() {
  lastHeartbeatAt = Date.now();
}

export function setSerialStatus(status: SerialStatus, errorMsg?: string) {
  serialStatus = status;
  serialErrorMsg = errorMsg ?? null;
  if (status === "connected") {
    serialConnectedSince = Date.now();
  } else {
    serialConnectedSince = null;
    lastHeartbeatAt = null;
  }
}

export function recordIdleStatus(sensor: string, value: string) {
  const bad = value === "FAIL";
  switch (sensor) {
    case "TOF":
      if (bad) recordSensorActivity("tof", "Idle check: no reading", "fault");
      else recordSensorActivity("tof", `Idle distance: ${value} mm`);
      break;
    case "LOADCELL":
      if (bad) recordSensorActivity("loadcell", "Idle check: no signal from load cell", "fault");
      else recordSensorActivity("loadcell", `Idle weight: ${value} g`);
      break;
    case "RFID":
      if (bad) recordSensorActivity("rfid", "Idle check: reader not answering", "fault");
      else recordSensorActivity("rfid", "Reader responding");
      break;
    case "BIN": {
      const pct = binFillPercent();
      if (bad) {
        // a nearly-full bin can sit inside the sensor's blind zone: warn, don't call it a fault
        if (pct !== null && pct >= 90) recordSensorActivity("ultrasonic", "Bin full or too close to sensor");
        else recordSensorActivity("ultrasonic", "Idle check: no echo", "fault");
      } else {
        const cm = parseFloat(value);
        if (Number.isFinite(cm)) {
          recordBinLevel(cm);
          recordSensorActivity("ultrasonic", `${cm} cm from sensor`);
        }
      }
      break;
    }
  }
}

export function getSensorStatus() {
  const responsive = lastHeartbeatAt !== null && (Date.now() - lastHeartbeatAt) < HEARTBEAT_STALE_MS;

  let overall: OverallStatus;
  if (serialStatus !== "connected") {
    overall = "offline";
  } else {
    overall = responsive ? "online" : "unresponsive";
  }

  return {
    overall,
    serial: {
      status: serialStatus,
      error: serialErrorMsg,
      connectedSince: serialConnectedSince,
      lastHeartbeat: lastHeartbeatAt,
    },
    sensors: health,
    bin: { distanceCm: binDistanceCm, updatedAt: binUpdatedAt, fillPercent: binFillPercent() },
  };
}

const WATCH_INTERVAL_MS = 5000;
const STARTUP_GRACE_MS  = 30000; // don't log the normal boot sequence

export function startHealthWatch() {
  const startedAt = Date.now();
  let everOnline = false;
  let lastLogged: OverallStatus = "online";

  setInterval(() => {
    const { overall, serial } = getSensorStatus();
    if (overall === "online") everOnline = true;
    else if (!everOnline && Date.now() - startedAt < STARTUP_GRACE_MS) return;

    if (overall === lastLogged) return;
    lastLogged = overall;

    if (overall === "online") {
      logSystem("ARDUINO_ONLINE", "Arduino is back online");
    } else if (overall === "unresponsive") {
      logSystem("ARDUINO_UNRESPONSIVE", "Arduino is connected but not answering the heartbeat (PING/PONG)");
    } else {
      logSystem("ARDUINO_OFFLINE", `Arduino disconnected${serial.error ? ": " + serial.error : ""}`);
    }
  }, WATCH_INTERVAL_MS);
}

export function recordStorageResult(ok: boolean) {
  if (ok) {
    recordSensorActivity("photoelectric", "Bottle passed to storage");
    recordSensorActivity("servo", "Gate moved, bottle reached the bin");
  } else {
    recordSensorActivity("servo", "Gate moved but no bottle seen (gate or photoelectric problem)", "fault");
  }
}