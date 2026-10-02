import { db } from "./db";

export interface SizeSpec {
  label: string;
  minWeight: number;
  maxWeight: number;
  credits: number;
  // Optional per-tier height range (mm). Leave both undefined to skip the height
  // check for this band entirely (weight-only classification, the old behavior).
  // If either is set, both must be set.
  minHeight?: number;
  maxHeight?: number;
}

export interface SensorCalibration {
  tofMinMm: number;
  tofMaxMm: number;
  weightMaxRejectG: number;
  shortBottleHeightMm: number;
  shortBottleWeightMaxG: number;
  binEmptyCm: number;  // sensor-to-floor distance when the bin is empty
  binFullCm: number;   // sensor-to-bottles distance when the bin is full
  tofMountMm: number;   // empty-chamber ToF reading: bottle height = this minus the raw reading
  sizes: SizeSpec[];
}

const DEFAULT_CALIBRATION: SensorCalibration = {
  tofMinMm: 40,
  tofMaxMm: 375, // derived from firmware's TOF_MOUNT_HEIGHT_MM (380mm), minus a small safety margin
  weightMaxRejectG: 68,
  shortBottleHeightMm: 100,
  shortBottleWeightMaxG: 35,
  binEmptyCm: 40,
  binFullCm: 8,
  tofMountMm: 650,
  sizes: [
    { label: "Small-Medium", minWeight: 10, maxWeight: 19, credits: 3 },
    { label: "Large-XL",     minWeight: 20, maxWeight: 68, credits: 5 },
  ],
};

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sensor_config (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch (e) {}

let cached: SensorCalibration | null = null;

function loadFromDb(): SensorCalibration {
  const row = db.prepare("SELECT data FROM sensor_config WHERE id = 1").get() as any;
  if (!row) {
    db.prepare("INSERT INTO sensor_config (id, data) VALUES (1, ?)").run(JSON.stringify(DEFAULT_CALIBRATION));
    return { ...DEFAULT_CALIBRATION };
  }
  try {
    const parsed = JSON.parse(row.data);
    return { ...DEFAULT_CALIBRATION, ...parsed };
  } catch {
    return { ...DEFAULT_CALIBRATION };
  }
}

export function getCalibration(): SensorCalibration {
  if (!cached) cached = loadFromDb();
  return cached;
}

export function invalidateCalibrationCache() {
  cached = null;
}

function validate(cal: SensorCalibration) {
  if (!(cal.tofMinMm >= 0 && cal.tofMaxMm > cal.tofMinMm)) {
    throw new Error("tofMinMm must be >= 0 and less than tofMaxMm.");
  }
  if (!(cal.weightMaxRejectG > 0)) {
    throw new Error("weightMaxRejectG must be positive.");
  }
  if (!(cal.shortBottleHeightMm >= 0) || !(cal.shortBottleWeightMaxG >= 0)) {
    throw new Error("shortBottleHeightMm and shortBottleWeightMaxG must be >= 0.");
  }
  if (!(cal.binFullCm >= 0) || !(cal.binEmptyCm > cal.binFullCm)) {
    throw new Error("binEmptyCm must be greater than binFullCm, and both >= 0.");
  }
  if (!(cal.tofMountMm > 0)) throw new Error("tofMountMm must be positive.");
  if (!Array.isArray(cal.sizes) || cal.sizes.length === 0) {
    throw new Error("sizes must be a non-empty array.");
  }
    for (const s of cal.sizes) {
    if (!s.label || typeof s.label !== "string") throw new Error("Each size needs a label.");
    if (!(s.minWeight >= 0) || !(s.maxWeight > s.minWeight)) {
      throw new Error(`Size "${s.label}": minWeight must be >= 0 and less than maxWeight.`);
    }
    if (!(s.credits > 0)) throw new Error(`Size "${s.label}": credits must be positive.`);

    const hasMinH = s.minHeight !== undefined && s.minHeight !== null;
    const hasMaxH = s.maxHeight !== undefined && s.maxHeight !== null;
    if (hasMinH !== hasMaxH) {
      throw new Error(`Size "${s.label}": set both min and max height, or leave both blank.`);
    }
    if (hasMinH && hasMaxH) {
      if (!(s.maxHeight! > s.minHeight!)) {
        throw new Error(`Size "${s.label}": minHeight must be less than maxHeight.`);
      }
      if (!(s.minHeight! >= cal.tofMinMm && s.maxHeight! <= cal.tofMaxMm)) {
        throw new Error(`Size "${s.label}": height range must fall within the global ToF range (${cal.tofMinMm}-${cal.tofMaxMm}mm).`);
      }
    }
  }
}

export function updateCalibration(patch: Partial<SensorCalibration>): SensorCalibration {
  const current = getCalibration();
  const next: SensorCalibration = {
    ...current,
    ...patch,
    sizes: patch.sizes ?? current.sizes,
  };
  validate(next); 
  db.prepare("UPDATE sensor_config SET data = ?, updated_at = datetime('now') WHERE id = 1")
    .run(JSON.stringify(next));
  cached = next;
  return next;
}

export type ClassifyMode = "both" | "weight-only" | "height-only" | "none";
export interface ClassifyResult { band: SizeSpec | null; mode: ClassifyMode; reason?: string; }

const hasHeight = (s: SizeSpec) => s.minHeight != null && s.maxHeight != null;

// ToF counts as "calibrated" once at least one band has a height range.
export function tofInUse(cal: SensorCalibration = getCalibration()): boolean {
  return cal.sizes.some(hasHeight);
}

export type FailStage = "capacitive" | "tof" | "loadcell" | "loadcell+tof";
export interface ClassifyResult { band: SizeSpec | null; mode: ClassifyMode; reason?: string; stage?: FailStage; }

export function classifyBottle(heightMm: number | null, weightG: number | null): ClassifyResult {
  const cal = getCalibration();
  const heightOk = heightMm != null && Number.isFinite(heightMm) && heightMm > 0 && tofInUse(cal);
  const weightOk = weightG != null && Number.isFinite(weightG) && weightG > 0;

  if (!heightOk && !weightOk) {
    return { band: null, mode: "none", stage: "loadcell+tof", reason: "No usable reading from load cell or ToF." };
  }
  if (weightOk && weightG! > cal.weightMaxRejectG) {
    return { band: null, mode: "none", stage: "loadcell", reason: `Too heavy (${weightG}g, max ${cal.weightMaxRejectG}g), likely contains liquid.` };
  }
  if (weightOk && heightOk && heightMm! < cal.shortBottleHeightMm && weightG! > cal.shortBottleWeightMaxG) {
    return { band: null, mode: "none", stage: "loadcell+tof", reason: `Weight too high for a short bottle (${heightMm}mm, ${weightG}g).` };
  }

  const mode: ClassifyMode = weightOk && heightOk ? "both" : weightOk ? "weight-only" : "height-only";

  const band = cal.sizes.find(s => {
    const wMatch = weightOk && weightG! >= s.minWeight && weightG! <= s.maxWeight;
    const hMatch = heightOk && hasHeight(s) && heightMm! >= s.minHeight! && heightMm! <= s.maxHeight!;
    if (mode === "both")        return wMatch && (!hasHeight(s) || hMatch);
    if (mode === "weight-only") return wMatch;
    return hMatch;
  }) ?? null;

  if (band) return { band, mode };

  if (mode === "both")        return { band: null, mode, stage: "loadcell+tof", reason: "Size mismatch: weight and height don't agree on a size." };
  if (mode === "weight-only") return { band: null, mode, stage: "loadcell",     reason: `Weight ${weightG}g doesn't match any size band.` };
  return                             { band: null, mode, stage: "tof",          reason: `Height ${heightMm}mm doesn't match any size band.` };
}