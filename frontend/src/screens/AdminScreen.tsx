import { useEffect, useMemo, useState, useRef } from "react";
import {
  AccountCircleIcon,
  ChatIcon,
  CheckCircleIcon,
  EditIcon,
  InfoIcon,
  KeyIcon,
  LockPersonIcon,
  LogOutIcon,
  PrintIcon,
  RecyclingIcon,
  SettingsIcon,
  StarIcon,
  WrenchIcon,
  XCircleIcon,
} from "../components/KioskIcons";
import { API } from "../config";

interface Props {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}
type Tab = "analytics" | "logs" | "users" | "transactions" | "feedback" | "admins" | "sensors";
type Role = "admin" | "super_admin";
type AnalyticsRange = 7 | 30 | 90;
type AnalyticsView = "range" | "daily" | "yearly";
type ForecastMetric = "bottles" | "co2SavedG" | "confirmedPrints";

interface DailyAnalyticsPoint {
  date: string;
  bottlesAccepted: number;
  plasticWeightKg: number;
  co2SavedG: number;
  rejectedBottles: number;
  creditsIssued: number;
  submittedPrints: number;
  refundedPrints: number;
  confirmedPrints: number;
  printCreditsSpent: number;
}
interface AnalyticsTotals {
  bottlesAccepted: number;
  plasticWeightKg: number;
  co2SavedG: number;
  rejectedBottles: number;
  creditsIssued: number;
  submittedPrints: number;
  refundedPrints: number;
  confirmedPrints: number;
  printCreditsSpent: number;
}
interface PeriodComparison {
  bottlesAccepted: number | null;
  plasticWeightKg: number | null;
  co2SavedG: number | null;
  rejectedBottles: number | null;
  creditsIssued: number | null;
  submittedPrints: number | null;
  confirmedPrints: number | null;
  printCreditsSpent: number | null;
}
interface HourlyAnalyticsPoint {
  hour: string;
  bottlesAccepted: number;
  co2SavedG: number;
  confirmedPrints: number;
  submittedPrints: number;
}
interface MonthlyAnalyticsPoint {
  month: string;
  bottlesAccepted: number;
  co2SavedG: number;
  confirmedPrints: number;
  submittedPrints: number;
}
interface BinHistoryPoint {
  date: string;
  avgFillPercent: number;
  maxFillPercent: number;
  latestFillPercent: number;
}
interface ForecastPoint {
  date: string;
  bottles: number;
  co2SavedG: number;
  confirmedPrints: number;
}
type AnalyticsForecast =
  | {
      ready: false;
      reason: string;
      activeDays: number;
    }
  | {
      ready: true;
      activeDays: number;
      method: string;
      avgBottlesPerDay: number;
      avgGramsPerBottle: number;
      next7Days: { bottles: number; plasticWeightKg: number; co2SavedG: number; confirmedPrints: number };
      next30Days: { bottles: number; plasticWeightKg: number; co2SavedG: number; confirmedPrints: number };
      estimatedBinFullDate?: string;
      daysUntilBinFull?: number;
      projectedSeries: ForecastPoint[];
    };
interface AnalyticsData {
  range: AnalyticsRange;
  timezone: string;
  startDate: string;
  endDate: string;
  totals: AnalyticsTotals;
  previousTotals: AnalyticsTotals;
  percentChange: PeriodComparison;
  cardVsGuest: { card: AnalyticsTotals; guest: AnalyticsTotals };
  busiestHour: { hour: number; label: string; count: number } | null;
  dailySeries: DailyAnalyticsPoint[];
  todayHourly: HourlyAnalyticsPoint[];
  yearlyMonthly: MonthlyAnalyticsPoint[];
  binFillPercent: number | null;
  binHistory: BinHistoryPoint[];
  forecast: AnalyticsForecast;
}

const ANALYTICS_RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const ANALYTICS_VIEWS: { value: AnalyticsView; label: string }[] = [
  { value: "range", label: "Daily series" },
  { value: "daily", label: "Today (hourly)" },
  { value: "yearly", label: "Yearly (monthly)" },
];

const formatResalePhp = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const clampResalePrice = (value: number) => Math.min(10, Math.max(4, value));

function formatDeltaBadge(delta: number | null): { text: string; color: string } {
  if (delta === null) return { text: "No prior data", color: "var(--admin-muted)" };
  if (delta > 0) return { text: `+${delta.toFixed(1)}% vs prior`, color: "var(--kiosk-success-text)" };
  if (delta < 0) return { text: `${delta.toFixed(1)}% vs prior`, color: "var(--kiosk-danger-text)" };
  return { text: "0.0% vs prior", color: "var(--admin-muted)" };
}

function AnalyticsSeriesChart({
  title,
  subtitle,
  points,
  color,
  unitSuffix = "",
  secondaryColor,
  secondaryLabel,
  primaryLabel,
  fixedMax,
}: {
  title: string;
  subtitle?: string;
  points: { label: string; value: number; secondaryValue?: number }[];
  color: string;
  unitSuffix?: string;
  secondaryColor?: string;
  secondaryLabel?: string;
  primaryLabel?: string;
  fixedMax?: number;
}) {
  const maxPrimary = Math.max(0, ...points.map(p => p.value));
  const maxSecondary = Math.max(0, ...points.map(p => p.secondaryValue ?? 0));
  const rawMax = fixedMax ?? Math.max(maxPrimary, maxSecondary);
  const scaleMax = rawMax || 1;
  const coords = points.map((p, idx) => ({
    ...p,
    x: points.length <= 1 ? 225 : 44 + idx * (362 / (points.length - 1)),
    y: 108 - (p.value / scaleMax) * 80,
    y2: p.secondaryValue !== undefined ? 108 - (p.secondaryValue / scaleMax) * 80 : undefined,
  }));
  const line1 = coords.map(c => `${c.x},${c.y}`).join(" ");
  const line2 = secondaryColor && coords.every(c => c.y2 !== undefined)
    ? coords.map(c => `${c.x},${c.y2}`).join(" ")
    : "";
  const labelIndices = new Set([0, Math.floor((points.length - 1) / 2), Math.max(0, points.length - 1)]);

  return (
    <div style={{ ...adminStatCard, minWidth: 0, padding: "10px 12px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--admin-text)" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10, color: "var(--admin-muted)" }}>{subtitle}</div>}
        </div>
        {secondaryColor && primaryLabel && secondaryLabel && (
          <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
            <span style={{ color }}>{primaryLabel}</span>
            <span style={{ color: secondaryColor }}>{secondaryLabel}</span>
          </div>
        )}
      </div>
      <svg viewBox="0 0 420 146" role="img" aria-label={title} style={{ display: "block", width: "100%", height: 132 }}>
        {[0, 0.5, 1].map(fraction => {
          const y = 108 - fraction * 80;
          const tickVal = rawMax * fraction;
          return (
            <g key={fraction}>
              <line x1="44" x2="406" y1={y} y2={y} stroke="var(--admin-border)" strokeDasharray="3 4" />
              <text x="36" y={y + 3} textAnchor="end" fill="var(--admin-muted)" fontSize="9">
                {rawMax < 2 && rawMax > 0 ? tickVal.toFixed(1) : Math.round(tickVal).toLocaleString()}
              </text>
            </g>
          );
        })}
        {line2 && (
          <polyline points={line2} fill="none" stroke={secondaryColor} strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {line1 && (
          <polyline points={line1} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {coords.map((c, idx) => (
          <circle key={`${c.label}-${idx}`} cx={c.x} cy={c.y} r={points.length > 35 ? "1.8" : "2.8"} fill={color}>
            <title>
              {secondaryLabel && c.secondaryValue !== undefined
                ? `${c.label}: ${c.value.toLocaleString()}${unitSuffix} (${secondaryLabel}: ${c.secondaryValue.toLocaleString()}${unitSuffix})`
                : `${c.label}: ${c.value.toLocaleString()}${unitSuffix}`}
            </title>
          </circle>
        ))}
        {coords.map((c, idx) => labelIndices.has(idx) && (
          <text
            key={`x-${idx}`}
            x={c.x}
            y="136"
            textAnchor={idx === 0 ? "start" : idx === coords.length - 1 ? "end" : "middle"}
            fill="var(--admin-muted)"
            fontSize="9"
          >
            {c.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function AnalyticsActualVsForecastChart({
  actual,
  projected,
  metric,
  label,
  unitSuffix = "",
}: {
  actual: DailyAnalyticsPoint[];
  projected: ForecastPoint[];
  metric: ForecastMetric;
  label: string;
  unitSuffix?: string;
}) {
  const actualValues = actual.map(d => ({
    date: d.date,
    value: metric === "bottles" ? d.bottlesAccepted : metric === "co2SavedG" ? d.co2SavedG : d.confirmedPrints,
  }));
  const projValues = projected.map(p => ({
    date: p.date,
    value: p[metric],
  }));
  const allVals = [...actualValues, ...projValues].map(v => v.value);
  const maxVal = Math.max(1, ...allVals);
  const totalPts = Math.max(2, actualValues.length + projValues.length);
  const x = (i: number) => 48 + i * (740 / (totalPts - 1));
  const y = (v: number) => 138 - (v / maxVal) * 102;

  const actualLine = actualValues.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const forecastLine = [
    ...(actualValues.length ? [`${x(actualValues.length - 1)},${y(actualValues[actualValues.length - 1].value)}`] : []),
    ...projValues.map((d, i) => `${x(actualValues.length + i)},${y(d.value)}`),
  ].join(" ");
  const splitX = actualValues.length > 0 ? x(actualValues.length - 1) : 48;

  return (
    <div style={{ ...adminStatCard, minWidth: 0, padding: "12px 16px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text)" }}>
          {label}: Actual vs. 30-day forecast (estimate)
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11 }}>
          <span style={{ color: "var(--kiosk-info-text)", fontWeight: 600 }}>━━ Actual</span>
          <span style={{ color: "var(--kiosk-accent-text)", fontWeight: 600 }}>┄┄ Forecast (estimate)</span>
        </div>
      </div>
      <svg viewBox="0 0 820 172" role="img" aria-label={`${label} actual versus projected forecast`} style={{ display: "block", width: "100%", height: 165 }}>
        {[0, 0.5, 1].map(fraction => {
          const lineY = 138 - fraction * 102;
          const val = maxVal * fraction;
          return (
            <g key={fraction}>
              <line x1="48" x2="788" y1={lineY} y2={lineY} stroke="var(--admin-border)" strokeDasharray="4 5" />
              <text x="40" y={lineY + 4} textAnchor="end" fill="var(--admin-muted)" fontSize="10">
                {maxVal < 2 ? val.toFixed(1) : Math.round(val).toLocaleString()}
              </text>
            </g>
          );
        })}
        <line x1={splitX} x2={splitX} y1="28" y2="142" stroke="var(--admin-border-strong)" strokeDasharray="3 3" />
        {actualLine && (
          <polyline points={actualLine} fill="none" stroke="var(--kiosk-info-text)" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {forecastLine && (
          <polyline points={forecastLine} fill="none" stroke="var(--kiosk-accent-text)" strokeWidth="2.8" strokeDasharray="7 5" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {actualValues.map((p, i) => (
          <circle key={`a-${p.date}`} cx={x(i)} cy={y(p.value)} r="2.2" fill="var(--kiosk-info-text)">
            <title>{`${p.date} (Actual): ${p.value.toLocaleString()}${unitSuffix}`}</title>
          </circle>
        ))}
        {projValues.map((p, i) => (
          <circle key={`f-${p.date}`} cx={x(actualValues.length + i)} cy={y(p.value)} r="2.2" fill="var(--kiosk-accent-text)">
            <title>{`${p.date} (Estimate): ${p.value.toLocaleString()}${unitSuffix}`}</title>
          </circle>
        ))}
        {actualValues.length > 0 && <text x="48" y="162" fill="var(--admin-muted)" fontSize="10">{actualValues[0].date.slice(5)}</text>}
        {actualValues.length > 0 && <text x={splitX} y="162" textAnchor="middle" fill="var(--admin-muted)" fontSize="10">Today</text>}
        {projValues.length > 0 && <text x="788" y="162" textAnchor="end" fill="var(--admin-muted)" fontSize="10">{projValues[projValues.length - 1].date.slice(5)}</text>}
      </svg>
    </div>
  );
}

interface User {
  rfid: string; name: string; studentId: string;
  credits: number; created_at: string;
}
interface Transaction {
  id: number; 
  rfid: string; 
  user_name?: string;
  type: string; 
  size?: string;
  height_mm?: number; 
  weight_g?: number; 
  credits: number; 
  created_at: string;
  reject_stage?: string;
  reject_reason?: string;
}

interface ActivityLog {
  id: number; admin_user: string; action: string; details: string; created_at: string;
}
interface Feedback {
  id: number; rfid: string | null; context: string;
  rating: number; comment: string; created_at: string;
}
interface AdminAccount {
  id: number; username: string; email: string; role: Role; created_at: string;
}
interface PrintPricing { bwCreditsPerPage: number; colorCreditsPerPage: number; }

interface SensorStatus {
  overall: "online" | "unresponsive" | "offline";
  serverNow?: number;
  serial: {
    status: "connected" | "disconnected" | "error";
    error: string | null;
    connectedSince: number | null;
    lastHeartbeat: number | null;
  };
       sensors: Record<string, { lastSeen: number | null; lastDetail: string | null; state: "ok" | "fault" | "unknown" }>;
    bin?: { distanceCm: number | null; updatedAt: number | null; fillPercent: number | null };
}
interface SizeSpec { label: string; minWeight: number; maxWeight: number; credits: number; minHeight?: number; maxHeight?: number; }
interface SensorCalibration {
  tofMinMm: number;
  tofMaxMm: number;
  weightMaxRejectG: number;
  shortBottleHeightMm: number;
  shortBottleWeightMaxG: number;
  binEmptyCm: number;
  binFullCm: number;
  tofMountMm: number;
  sizes: SizeSpec[];
}
const formatAgo = (secs: number | null) => {
  if (secs === null) return "No activity yet";
  if (secs < 60) return `${secs}s ago`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
};
const mmToCm = (mm: number) => (mm / 10).toFixed(1);
const cmToMm = (cm: number) => Math.round(cm * 10);

const CONTROL_LABELS: Record<string, string> = { deposit: "Deposit bottles", print: "Print", balance: "Check balance", register: "Register RFID", rfid: "Card reader (RFID)" };

const SENSOR_ORDER = ["rfid", "ir", "capacitive", "tof", "loadcell", "servo", "photoelectric", "ultrasonic", "printer"];
const SENSOR_LABELS: Record<string, string> = {
  rfid: "RFID", ir: "IR intake", capacitive: "Capacitive", tof: "ToF height", loadcell: "Load cell",
  servo: "Servo gate", photoelectric: "Photoelectric", ultrasonic: "Ultrasonic (bin)", printer: "Printer",
};
const IDLE_MONITORED = ["rfid", "tof", "loadcell", "ultrasonic", "printer"];

const SENSOR_HINTS: Record<string, string> = {
  rfid: "Check the RFID reader wiring (SS pin 10, RST pin 9) and its 3.3V power.",
  ir: "Check the IR intake sensor signal wire (pin 2) and power.",
  capacitive: "Check the capacitive sensor signal wire (Analog 1) and power.",
  tof: "Check the ToF sensor SDA/SCL wires and power. The mount must not be blocked.",
  loadcell: "Check the load cell and HX711 wiring (DOUT pin 3, SCK pin 5) and that nothing is pressing on the platform.",
  servo: "Gate moved but no bottle was seen. Check the servo signal wire (pin 8) and its power first, then the photoelectric sensor (pin 6) and any jam in the chute.",
  photoelectric: "No bottle was seen after the gate moved. Check the photoelectric sensor (pin 6), the servo gate, and any jam in the chute.",
  ultrasonic: "Check the HC-SR04 TRIG (pin 7) and ECHO (A0) wires. A nearly full bin can also block the echo.",
  printer: "Check that the printer is powered on and the USB cable is connected, then check paper, ink and for a jam. Running lpstat -l -p on the Pi shows what the print service reports.",
};

const LOG_GROUPS: Record<string, { label: string; actions: string[] }> = {
  users:    { label: "Users",               actions: ["REGISTER_USER", "EDIT_USER", "DELETE_USER", "ADJUST_CREDITS"] },
  admins:   { label: "Admin Accounts",      actions: ["CREATE_ADMIN", "EDIT_ADMIN", "DELETE_ADMIN"] },
  security: { label: "Password & Security", actions: ["REQUEST_PASSWORD_RESET", "RESET_PASSWORD"] },
  backup:   { label: "Backup & Restore",    actions: ["EXPORT_BACKUP", "RESTORE_BACKUP","EMAIL_BACKUP", "EMAIL_BACKUP_FAILED"] },
  system:   { label: "System Control",      actions: ["SHUTDOWN_PI", "REBOOT_PI", "UPDATE_SENSOR_CONFIG", "UPDATE_PRINT_PRICING"] },
  hardware: { label: "Hardware Alerts",     actions: ["SENSOR_FAULT", "SENSOR_RECOVERED", "ARDUINO_OFFLINE", "ARDUINO_UNRESPONSIVE", "ARDUINO_ONLINE", "PRINTER_NOT_READY", "PRINT_FAILED", "PRINT_REFUND"] },
  kiosk:    { label: "Kiosk Controls",      actions: ["KIOSK_PART_DISABLED", "KIOSK_PART_ENABLED"] },
};

const formatPhTime = (dateString: string) => {
  if (!dateString) return "—";
  try {
    const normalized = dateString.endsWith("Z") || dateString.includes("+") ? dateString : dateString + "Z";
    return new Date(normalized).toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
};
const ZERO_BADGES: Record<Tab, number> = { analytics: 0, logs: 0, users: 0, transactions: 0, feedback: 0, admins: 0, sensors: 0 };

const PAGE = 100;
type ListKey = "logs" | "txns" | "feedback" | "users" | "admins";
const FRESH_LIMITS: Record<ListKey, number> = { logs: PAGE, txns: PAGE, feedback: PAGE, users: PAGE, admins: PAGE };

export default function AdminScreen({ theme, onToggleTheme }: Props) {
  const [token, setToken]           = useState<string | null>(null);
  const [myAdminId, setMyAdminId]   = useState<number | null>(null);
  const [myUsername, setMyUsername] = useState<string>("");
  const [myEmail, setMyEmail]       = useState<string>("");
  const [myRole, setMyRole]         = useState<Role>("admin");
  const [passwordChanged, setPasswordChanged] = useState<boolean>(true);
  
  const verified = token !== null;
  const isSuperAdmin = myRole === "super_admin";

  const [authView, setAuthView]     = useState<"login" | "forgot" | "reset">("login");
  const [loginStep, setLoginStep]   = useState<"username" | "password">("username");
  const [userInput, setUserInput]   = useState("");
  const [userCheckLoading, setUserCheckLoading] = useState(false);
  const [userError, setUserError]   = useState("");

  const [pwInput, setPwInput]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwError, setPwError]       = useState("");
  const [sessionNotice, setSessionNotice] = useState("");
  const [pwLoading, setPwLoading]   = useState(false);

  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotEmail, setForgotEmail]       = useState("");
  const [forgotMsg, setForgotMsg]           = useState("");
  const [forgotLoading, setForgotLoading]   = useState(false);

  const [resetToken, setResetToken]         = useState<string | null>(null);
  const [newResetPass, setNewResetPass]     = useState("");
  const [resetConfirmPass, setResetConfirmPass] = useState("");
  const [showResetPass, setShowResetPass]   = useState(false);
  const [resetMsg, setResetMsg]             = useState("");

  // Overall System Stats State
  const [stats, setStats] = useState({
    totalBottles: 0,
    totalPlasticKg: "0.00",
    totalCo2G: 0,
    totalPrints: 0,
    totalUsers: 0,
  });
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>(30);
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>("range");
  const [forecastMetric, setForecastMetric] = useState<ForecastMetric>("bottles");
  const [showResale, setShowResale] = useState(false);
  const [resalePriceInput, setResalePriceInput] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem("b2p-resale-price");
      if (saved !== null) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed)) return String(clampResalePrice(parsed));
      }
    } catch {}
    return "7";
  });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const analyticsRangeRef = useRef<AnalyticsRange>(30);
  useEffect(() => { analyticsRangeRef.current = analyticsRange; }, [analyticsRange]);
  const [refreshTick, setRefreshTick] = useState(0);

  const resaleEstimate = useMemo(() => {
    const trimmed = resalePriceInput.trim();
    const parsed = trimmed === "" ? NaN : Number(trimmed);
    const isValid = Number.isFinite(parsed) && parsed >= 4 && parsed <= 10;
    const error =
      trimmed === ""
        ? "Enter a resale price between ₱4 and ₱10 per kg."
        : !Number.isFinite(parsed) || parsed < 4 || parsed > 10
          ? "Price must be between ₱4 and ₱10 per kg (clamped on blur)."
          : "";
    const activePrice = Number.isFinite(parsed) ? clampResalePrice(parsed) : null;

    if (!analytics) {
      return { isValid, error, activePrice, actualPhp: null, cardPhp: null, guestPhp: null, forecast7Php: null, forecast30Php: null, comparisonRows: [] as Array<{ price: number; tag: string; actualPhp: number; forecast7Php: number | null; forecast30Php: number | null }> };
    }

    const actualKg = analytics.totals.plasticWeightKg;
    const forecast7Kg = analytics.forecast.ready ? analytics.forecast.next7Days.plasticWeightKg : null;
    const forecast30Kg = analytics.forecast.ready ? analytics.forecast.next30Days.plasticWeightKg : null;

    const baseRates: Array<{ price: number; label: string }> = [
      { price: 4, label: "₱4/kg" },
      { price: 7, label: "₱7/kg (mid)" },
      { price: 10, label: "₱10/kg" },
    ];
    const hasCustomInBase = activePrice !== null && baseRates.some(r => r.price === activePrice);
    const rows = baseRates.map(r => ({
      price: r.price,
      tag: activePrice === r.price ? `${r.label} · current` : r.label,
      actualPhp: actualKg * r.price,
      forecast7Php: forecast7Kg !== null ? forecast7Kg * r.price : null,
      forecast30Php: forecast30Kg !== null ? forecast30Kg * r.price : null,
    }));
    if (activePrice !== null && !hasCustomInBase) {
      rows.push({
        price: activePrice,
        tag: `₱${activePrice}/kg (custom)`,
        actualPhp: actualKg * activePrice,
        forecast7Php: forecast7Kg !== null ? forecast7Kg * activePrice : null,
        forecast30Php: forecast30Kg !== null ? forecast30Kg * activePrice : null,
      });
    }

    return {
      isValid,
      error,
      activePrice,
      actualPhp: activePrice !== null ? actualKg * activePrice : null,
      cardPhp: activePrice !== null ? analytics.cardVsGuest.card.plasticWeightKg * activePrice : null,
      guestPhp: activePrice !== null ? analytics.cardVsGuest.guest.plasticWeightKg * activePrice : null,
      forecast7Php: activePrice !== null && forecast7Kg !== null ? forecast7Kg * activePrice : null,
      forecast30Php: activePrice !== null && forecast30Kg !== null ? forecast30Kg * activePrice : null,
      comparisonRows: rows,
    };
  }, [analytics, resalePriceInput]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("reset_token");
    if (tokenParam) {
      setResetToken(tokenParam);
      setAuthView("reset");
    }
  }, []);

  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);

  useEffect(() => {
    if (!lockoutUntil) return;
    const updateTimer = () => {
      const now = Date.now();
      if (now >= lockoutUntil) {
        setLockoutUntil(null);
        setLockoutRemaining(0);
      } else {
        setLockoutRemaining(Math.ceil((lockoutUntil - now) / 1000));
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const [forceNewPass, setForceNewPass]     = useState("");
  const [forceConfirmPass, setForceConfirmPass] = useState("");
  const [showForcePass, setShowForcePass]   = useState(false);
  const [forceMsg, setForceMsg]             = useState("");

  const [tab, setTab]               = useState<Tab>("logs");
  const [users, setUsers]           = useState<User[]>([]);
  const [txns, setTxns]             = useState<Transaction[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [feedback, setFeedback]     = useState<Feedback[]>([]);
  const [admins, setAdmins]         = useState<AdminAccount[]>([]);
  const [loading, setLoading]       = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const limitsRef = useRef<Record<ListKey, number>>({ ...FRESH_LIMITS });
  const [limits, setLimits] = useState<Record<ListKey, number>>({ ...FRESH_LIMITS });
  const filtersRef = useRef({ q: "", filter: "all", date: "" });
  const listSeq = useRef(0);
  const [debouncedQ, setDebouncedQ] = useState("");

  const [sensorStatus, setSensorStatus] = useState<SensorStatus | null>(null);
  const [calForm, setCalForm]           = useState<SensorCalibration | null>(null);
  const [calMsg, setCalMsg]             = useState("");
  const [calSaving, setCalSaving]       = useState(false);
  const [printPricingForm, setPrintPricingForm] = useState<PrintPricing | null>(null);
  const [printPricingMsg, setPrintPricingMsg] = useState("");
  const [printPricingSaving, setPrintPricingSaving] = useState(false);
  const [tofCalBusy, setTofCalBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [backupTime, setBackupTime] = useState("17:00");
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [driveStatus, setDriveStatus] = useState<{ action: string; details: string; created_at: string } | null>(null);
  const [openHint, setOpenHint] = useState<string | null>(null);
  const [controls, setControls] = useState<any[]>([]);
  const [ctlMsg, setCtlMsg] = useState<Record<string, string>>({});
  const [badges, setBadges] = useState<Record<Tab, number>>(ZERO_BADGES);
  const seenSensorRef = useRef<number | null>(null);
  const tabRef = useRef<Tab>("logs");
useEffect(() => { tabRef.current = tab; }, [tab]);

  useEffect(() => {
  setSearchQuery("");
  setFilterValue("all");
  setDateFilter("");
  setDebouncedQ("");
}, [tab]);

useEffect(() => {
  const id = setTimeout(() => setDebouncedQ(searchQuery.trim()), 400);
  return () => clearTimeout(id);
}, [searchQuery]);

  const [editUserModal, setEditUserModal] = useState<User | null>(null);
  const [editName, setEditName]       = useState("");
  const [editStudentId, setEditStudentId] = useState("");
  const [editMsg, setEditMsg]         = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditMsg, setCreditMsg]       = useState("");
  const [userDeleteMsg, setUserDeleteMsg] = useState("");

  const [adminModal, setAdminModal] = useState<null | { mode: "create" } | { mode: "edit"; admin: AdminAccount }>(null);
  const [adminForm, setAdminForm]   = useState({ username: "", email: "", password: "", role: "admin" as Role });
  const [adminMsg, setAdminMsg]     = useState("");
  const [createdDefaultPassNotice, setCreatedDefaultPassNotice] = useState<string | null>(null);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [settingsForm, setSettingsForm]     = useState({ username: "", email: "", currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showSettingsPass, setShowSettingsPass] = useState(false);
  const [settingsMsg, setSettingsMsg]       = useState("");

  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);

  // Power control (shutdown / reboot) waiting screen
  const SHUTDOWN_WAIT_SECONDS = 30;
  const [powerState, setPowerState] = useState<null | { action: "shutdown" | "reboot"; startedAt: number }>(null);
  const [powerElapsed, setPowerElapsed] = useState(0);
  const [rebootBackOnline, setRebootBackOnline] = useState(false);

  useEffect(() => {
    if (!powerState) return;
    setPowerElapsed(0);
    setRebootBackOnline(false);

    const clock = setInterval(() => {
      setPowerElapsed(Math.floor((Date.now() - powerState.startedAt) / 1000));
    }, 1000);

    // For reboots only: watch the API go down, then come back up.
    let sawDown = false;
    const poll = powerState.action === "reboot"
      ? setInterval(async () => {
          try {
            const r = await fetch(`${API}/api/mode`, { signal: AbortSignal.timeout(2500) });
            if (r.ok && sawDown) setRebootBackOnline(true);
          } catch {
            sawDown = true;
          }
        }, 3000)
      : null;

    return () => {
      clearInterval(clock);
      if (poll) clearInterval(poll);
    };
  }, [powerState]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const authFetch = (path: string, options: RequestInit = {}, tk: string | null = token) => {
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${tk}`,
    },
  });
};

useEffect(() => {
  if (!verified || !passwordChanged || !token) {
    setAnalytics(null);
    return;
  }
  let active = true;
  if (!analytics) setAnalyticsLoading(true);
  setAnalyticsError("");
  fetch(`${API}/api/admin/analytics?range=${analyticsRange}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async response => {
    if (!response.ok) throw new Error(`Analytics request failed (${response.status}).`);
    return response.json() as Promise<AnalyticsData>;
  }).then(data => {
    if (active) setAnalytics(data);
  }).catch(error => {
    if (active) setAnalyticsError(error instanceof Error ? error.message : "Could not load analytics.");
  }).finally(() => {
    if (active) setAnalyticsLoading(false);
  });
  return () => { active = false; };
}, [analyticsRange, passwordChanged, refreshTick, token, verified]);

  useEffect(() => {
    fetch(`${API}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "admin" }),
    });
    return () => {
      fetch(`${API}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "idle" }),
      });
    };
  }, []);

  const handleNextStep = async () => {
    if (!userInput.trim()) return;
    setUserError("");
    setUserCheckLoading(true);

    try {
      const res = await fetch(`${API}/api/admin/check-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.exists) {
        setLoginStep("password");
      } else {
        setUserError(data.error ?? "Username not found.");
      }
    } catch {
      setUserError("Could not reach backend.");
    }
    setUserCheckLoading(false);
  };

  const handlePasswordLogin = async () => {
    if (!userInput || !pwInput || lockoutRemaining > 0) return;
    setPwLoading(true);
    setPwError("");
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userInput, password: pwInput }),
      });
      const data = await res.json();
      
      if (res.status === 429 && data.lockoutUntil) {
        setLockoutUntil(data.lockoutUntil);
        setPwError("");
      } else if (res.ok && data.token) {
        setToken(data.token);
        setSessionNotice("");
        setMyAdminId(data.adminId);
        setMyUsername(data.username);
        setMyEmail(data.email || "");
        setMyRole(data.role);
        setPasswordChanged(data.passwordChanged);
        setPwInput("");
        setLockoutUntil(null);
        seenSensorRef.current = null;
        if (data.passwordChanged) {
          loadAll(data.token, data.role === "super_admin").then(() => syncBadges(data.token));
        }
      } else {
        setPwError(data.error ?? "Incorrect username or password.");
      }
    } catch {
      setPwError("Could not reach backend.");
    }
    setPwLoading(false);
  };

  const handleForgotPasswordRequest = async () => {
    if (!forgotUsername.trim() || !forgotEmail.trim()) return;
    setForgotLoading(true);
    setForgotMsg("");
    try {
      const res = await fetch(`${API}/api/admin/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: forgotUsername.trim(), email: forgotEmail.trim() }),
      });
      const data = await res.json();
      setForgotMsg(data.message || data.error);
    } catch {
      setForgotMsg("Could not reach backend.");
    }
    setForgotLoading(false);
  };

  const handleResetPasswordSubmit = async () => {
    if (!newResetPass || newResetPass.length < 8) {
      setResetMsg("Password must be at least 8 characters.");
      return;
    }
    if (newResetPass !== resetConfirmPass) {
      setResetMsg("Passwords do not match.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/admin/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword: newResetPass }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResetMsg("Password successfully reset! Redirecting to login...");
        setTimeout(() => {
          window.location.href = "/?screen=admin";
        }, 2000);
      } else {
        setResetMsg(data.error ?? "Reset failed.");
      }
    } catch {
      setResetMsg("Could not reach backend.");
    }
  };

  const handleForcePasswordChange = async () => {
    if (!forceNewPass || forceNewPass.length < 8) {
      setForceMsg("Password must be at least 8 characters.");
      return;
    }
    if (forceNewPass !== forceConfirmPass) {
      setForceMsg("Passwords do not match.");
      return;
    }

    try {
      const res = await authFetch(`/api/admin/me/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwInput || "DefaultPass123!", newPassword: forceNewPass }),
      });
      const data = await res.json();
      if (data.success) {
        setPasswordChanged(true);
        loadAll(token, isSuperAdmin).then(() => syncBadges(token));
      } else {
        setForceMsg(data.error ?? "Failed to update password.");
      }
    } catch {
      setForceMsg("Could not reach backend.");
    }
  };

  const handleSaveSettings = async () => {
    if (!myAdminId) return;
    if (!settingsForm.username.trim()) {
      setSettingsMsg("Username cannot be empty.");
      return;
    }

    const payload: any = { 
      username: settingsForm.username.trim(),
      email: settingsForm.email.trim()
    };
    if (settingsForm.newPassword) {
      if (settingsForm.newPassword.length < 8) {
        setSettingsMsg("New password must be at least 8 characters.");
        return;
      }
      if (settingsForm.newPassword !== settingsForm.confirmPassword) {
        setSettingsMsg("New passwords do not match.");
        return;
      }
      if (!settingsForm.currentPassword) {
        setSettingsMsg("Enter your current password to change it.");
        return;
      }
      payload.currentPassword = settingsForm.currentPassword;
      payload.password = settingsForm.newPassword;
    }

    try {
      const res = await authFetch(`/api/admin/admins/${myAdminId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setMyUsername(settingsForm.username.trim());
        setMyEmail(settingsForm.email.trim());
        setSettingsForm({ username: settingsForm.username.trim(), email: settingsForm.email.trim(), currentPassword: "", newPassword: "", confirmPassword: "" });
        setShowAccountModal(false);
        setSettingsMsg("");
        fetchData();
      } else {
        setSettingsMsg(data.error ?? "Failed to update profile.");
      }
    } catch {
      setSettingsMsg("Could not reach backend.");
    }
  };

 useEffect(() => {
  if (!verified || !passwordChanged || tab !== "sensors") return;
  const id = setInterval(async () => {
    try {
      const r = await authFetch(`/api/admin/sensors/status`);
      if (r.ok) setSensorStatus(await r.json());
    } catch {}
  }, 5000);
  return () => clearInterval(id);
}, [verified, passwordChanged, tab, token]);

useEffect(() => {
  if (!verified || !passwordChanged) return;
  const id = setInterval(async () => {
    await loadAll(token, isSuperAdmin);
    await syncBadges(token);
  }, 10000);
  return () => clearInterval(id);
}, [verified, passwordChanged, token, isSuperAdmin]);

const measureEmpty = async () => {
  if (!window.confirm("Make sure the chamber is EMPTY, then press OK.")) return;
  setTofCalBusy(true);
  setCalMsg("Measuring... about 3 seconds");
  try {
    const res = await authFetch(`/api/admin/sensors/tof-calibrate`, { method: "POST" });
    const data = await res.json();
    if (res.ok && data.success) {
      setCalForm(prev => (prev ? { ...prev, tofMountMm: data.config.tofMountMm } : prev));
      setCalMsg(`Saved: empty reading ${mmToCm(data.mean)} cm (spread ${mmToCm(data.spread)} cm)`);
    } else {
      setCalMsg(data.error ?? "Measurement failed.");
    }
  } catch { setCalMsg("Could not reach backend."); }
  setTofCalBusy(false);
};
// ── Badge handling ─────────────────────────────────────────────────────────
 const markSeen = (t: Tab, tk: string | null = token) =>
  authFetch(`/api/admin/badges/seen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab: t }),
  }, tk).catch(() => {});

const syncBadges = async (tk: string | null = token) => {
  try {
    const r = await authFetch(`/api/admin/badges`, {}, tk);
    if (!r.ok) return;
    const data = await r.json();
    const open = tabRef.current;
    setBadges(b => ({ ...b, ...data, [open]: 0 })); // the open tab never shows a badge
    if (open !== "sensors" && open !== "analytics") markSeen(open, tk);
  } catch {}
};

const loadLists = async (tk: string | null, superAdmin: boolean) => {
  const seq = ++listSeq.current;
  const { q, filter, date } = filtersRef.current;
  const active = tabRef.current;

  // Filters apply only to the tab you are looking at; the other lists load unfiltered
  const qs = (key: ListKey, own: Tab) => {
    const p = new URLSearchParams({ limit: String(limitsRef.current[key]) });
    if (active === own) {
      if (q) p.set("q", q);
      if (date) p.set("date", date);
      if (filter !== "all") {
        if (own === "logs") {
          const acts = LOG_GROUPS[filter]?.actions.join(",");
          if (acts) p.set("actions", acts);
        } else p.set("filter", filter);
      }
    }
    return p.toString();
  };

  const run = async (path: string, set: (d: any) => void) => {
    const r = await authFetch(path, {}, tk);
    if (!r.ok) throw new Error(`${path} returned ${r.status}`);
    const data = await r.json();
    if (seq === listSeq.current) set(data);   // ignore answers that arrive late
  };

  const jobs = [
    run(`/api/admin/activity-logs?${qs("logs", "logs")}`, setActivityLogs),
    run(`/api/admin/transactions?${qs("txns", "transactions")}`, setTxns),
    run(`/api/admin/feedback?${qs("feedback", "feedback")}`, setFeedback),
    run(`/api/admin/users?${qs("users", "users")}`, setUsers),
  ];
  if (superAdmin) jobs.push(run(`/api/admin/admins?${qs("admins", "admins")}`, setAdmins));

  (await Promise.allSettled(jobs)).forEach(r => { if (r.status === "rejected") console.error(r.reason); });
};

useEffect(() => {
  if (tab === "sensors" || tab === "analytics") return;
  filtersRef.current = { q: debouncedQ, filter: filterValue, date: dateFilter };
  limitsRef.current = { ...FRESH_LIMITS };   // new filter: start again from 100
  setLimits({ ...limitsRef.current });
  if (verified && passwordChanged) loadLists(token, isSuperAdmin);
}, [tab, debouncedQ, filterValue, dateFilter]);

const loadAll = async (tk: string | null, superAdmin: boolean) => {
  const get = async (path: string) => {
    const r = await authFetch(path, {}, tk);
    if (!r.ok) throw new Error(`${path} returned ${r.status}`);
    return r.json();
  };
  const jobs: Promise<any>[] = [
    get(`/api/admin/stats`).then(setStats),
    get(`/api/admin/analytics?range=${analyticsRangeRef.current}`).then((data: AnalyticsData) => {
      setAnalytics(data);
      setAnalyticsError("");
    }),
    get(`/api/admin/print-pricing`).then((pricing: PrintPricing) => {
      setPrintPricingForm(prev => prev ?? pricing);
    }),
    loadLists(tk, superAdmin),
    Promise.all([get(`/api/admin/sensors/status`), get(`/api/admin/sensors/config`)]).then(([status, config]) => {
      setSensorStatus(status);
      setCalForm(prev => prev ?? config); // never overwrite what you're editing
    }),
  ];
  (await Promise.allSettled(jobs)).forEach(r => { if (r.status === "rejected") console.error(r.reason); });
};

const savePrintPricing = async () => {
  if (!printPricingForm) return;
  setPrintPricingSaving(true);
  setPrintPricingMsg("");
  try {
    const res = await authFetch(`/api/admin/print-pricing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(printPricingForm),
    });
    const data = await res.json();
    if (res.status === 401) {
      setToken(null);
      setPrintPricingForm(null);
      setSessionNotice("Your admin session expired. Log in again, then save the print rates.");
      return;
    }
    if (res.ok && data.success) {
      setPrintPricingForm(data.pricing);
      setPrintPricingMsg("Print pricing saved. New print jobs will use these rates.");
    } else {
      setPrintPricingMsg(data.error ?? "Failed to save print pricing.");
    }
  } catch {
    setPrintPricingMsg("Could not reach backend.");
  } finally {
    setPrintPricingSaving(false);
  }
};

// Same name as before, so Refresh and your edit/delete handlers keep working
const fetchData = async (tkOverride?: string) => {
  setLoading(true);
  setRefreshTick(tick => tick + 1);
  await loadAll(tkOverride ?? token, isSuperAdmin);
  await syncBadges(tkOverride ?? token);
  setLoading(false);
};
const showMore = async (key: ListKey) => {
  limitsRef.current[key] += PAGE;
  setLimits({ ...limitsRef.current });
  await loadLists(token, isSuperAdmin);
};

const adjustCredits = async (mode: "add" | "remove") => {
  if (!editUserModal) return;
  const amount = parseInt(creditAmount, 10);
  if (!Number.isFinite(amount) || amount <= 0) { setCreditMsg("Enter a whole number above 0."); return; }
  if (!creditReason.trim()) { setCreditMsg("Enter a reason for this credit adjustment."); return; }
  if (!window.confirm(`${mode === "add" ? "Add" : "Remove"} ${amount} credits ${mode === "add" ? "to" : "from"} ${editUserModal.name}?`)) return;
  try {
    const res = await authFetch(`/api/admin/user/${editUserModal.rfid}/credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, mode, reason: creditReason }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      setEditUserModal({ ...editUserModal, credits: data.credits });
      setCreditAmount(""); setCreditReason("");
      setCreditMsg(`Done. New balance: ${data.credits}`);
      fetchData();
    } else setCreditMsg(data.error ?? "Failed.");
  } catch { setCreditMsg("Could not reach backend."); }
};

  const resetUserPin = async () => {
    if (!editUserModal) return;
    if (!window.confirm("Reset the PIN for " + editUserModal.name + "? They will set a new PIN the next time they tap their card.")) return;
    try {
      const res = await authFetch(`/api/admin/user/${editUserModal.rfid}/reset-pin`, { method: "POST" });
      const data = await res.json();
      setCreditMsg(res.ok && data.success ? "Done. The user sets a new PIN on their next tap." : (data.error ?? "Failed."));
    } catch { setCreditMsg("Could not reach backend."); }
  };

  const handleDeleteUser = async (rfid: string) => {
    if (!window.confirm("Delete this user account? Their deposit, print, and feedback history will be preserved.")) return;
    setUserDeleteMsg("");
    try {
      const res = await authFetch(`/api/admin/user/${rfid}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setUserDeleteMsg(data.error ?? "Could not delete the user.");
        return;
      }
      setUserDeleteMsg(`User ${rfid} was deleted. Past activity was anonymized and remains in kiosk totals.`);
      await fetchData();
    } catch {
      setUserDeleteMsg("Could not reach the server. The user was not deleted.");
    }
  };

  const openCreateAdmin = () => {
    setAdminForm({ username: "", email: "", password: "", role: "admin" });
    setAdminMsg("");
    setCreatedDefaultPassNotice(null);
    setAdminModal({ mode: "create" });
  };

  const openEditAdmin = (admin: AdminAccount) => {
    setAdminForm({ username: admin.username, email: admin.email || "", password: "", role: admin.role });
    setAdminMsg("");
    setCreatedDefaultPassNotice(null);
    setAdminModal({ mode: "edit", admin });
  };

  const handleSaveAdmin = async () => {
    if (!adminModal) return;
    if (adminModal.mode === "create") {
      if (!adminForm.username) {
        setAdminMsg("Username is required.");
        return;
      }
      const res = await authFetch(`/api/admin/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: adminForm.username, email: adminForm.email, role: adminForm.role }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCreatedDefaultPassNotice(data.defaultPassword || "DefaultPass123!");
        fetchData();
      } else {
        setAdminMsg(data.error ?? "Failed to create admin.");
      }
    } else {
      const body: any = { username: adminForm.username, email: adminForm.email, role: adminForm.role };
      if (adminForm.password) body.password = adminForm.password;
      const res = await authFetch(`/api/admin/admins/${adminModal.admin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setAdminModal(null);
        fetchData();
      } else {
        setAdminMsg(data.error ?? "Failed to update admin.");
      }
    }
  };

  const handleDeleteAdmin = async (admin: AdminAccount) => {
    if (!window.confirm(`Delete admin account "${admin.username}"?`)) return;
    const res = await authFetch(`/api/admin/admins/${admin.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.success) alert(data.error ?? "Failed to delete admin.");
    fetchData();
  };

  const handlePower = async (action: "shutdown" | "reboot") => {
    const prompt = action === "shutdown"
      ? "Shut down the Raspberry Pi?\n\nThe kiosk will stay OFF until someone physically reconnects power."
      : "Reboot the Raspberry Pi?\n\nThe kiosk will be unavailable for about a minute, and all admins will be logged out.";
    if (!window.confirm(prompt)) return;

    try {
      const res = await authFetch(`/api/admin/system/${action}`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowMaintenanceModal(false);
        setPowerState({ action, startedAt: Date.now() });
      } else {
        alert(data.error ?? `Failed to ${action}.`);
      }
    } catch {
      alert("Could not reach backend.");
    }
  };

       const loadDriveStatus = async () => {
    try {
      const r = await authFetch(`/api/admin/backup/drive-status`);
      if (r.ok) setDriveStatus(await r.json());
      const s = await authFetch(`/api/admin/backup/settings`);
      if (s.ok) { const cfg = await s.json(); setBackupTime(cfg.time); setBackupEnabled(cfg.enabled); }
    } catch {}
  };

     const backupToDrive = async () => {
    setDriveBusy(true);
    try {
      const res = await authFetch(`/api/admin/backup/drive`, { method: "POST" });
      const data = await res.json();
      alert(res.ok && data.success ? "Backup uploaded to Google Drive." : "Backup failed: " + (data.error ?? "unknown error"));
    } catch { alert("Could not reach backend."); }
    setDriveBusy(false);
    loadDriveStatus();
  };

  const saveBackupSchedule = async () => {
    try {
      const res = await authFetch(`/api/admin/backup/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: backupTime, enabled: backupEnabled }),
      });
      const data = await res.json();
      alert(res.ok && data.success ? "Backup schedule saved." : "Failed: " + (data.error ?? "unknown error"));
    } catch { alert("Could not reach backend."); }
  };

      const [emailBusy, setEmailBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState<{ action: string; details: string; created_at: string } | null>(null);
  const [emailTime, setEmailTime] = useState("17:00");
  const [emailEnabled, setEmailEnabled] = useState(true);

  const loadEmailBackup = async () => {
    try {
      const r = await authFetch(`/api/admin/backup/email-status`);
      if (r.ok) setEmailStatus(await r.json());
      const s = await authFetch(`/api/admin/backup/email-settings`);
      if (s.ok) { const cfg = await s.json(); setEmailTime(cfg.time); setEmailEnabled(cfg.enabled); }
    } catch {}
  };
  useEffect(() => { if (showMaintenanceModal) loadEmailBackup(); }, [showMaintenanceModal]);

  const emailBackupNow = async () => {
    setEmailBusy(true);
    try {
      const res = await authFetch(`/api/admin/backup/email`, { method: "POST" });
      const data = await res.json();
      alert(res.ok && data.success ? data.message : "Backup failed: " + (data.error ?? "unknown error"));
    } catch { alert("Could not reach backend."); }
    setEmailBusy(false);
    loadEmailBackup();
  };

  const saveEmailSchedule = async () => {
    try {
      const res = await authFetch(`/api/admin/backup/email-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: emailTime, enabled: emailEnabled }),
      });
      const data = await res.json();
      alert(res.ok && data.success ? "Backup schedule saved." : "Failed: " + (data.error ?? "unknown error"));
    } catch { alert("Could not reach backend."); }
  };  

     const loadControls = async () => {
    try { const r = await authFetch(`/api/admin/kiosk-controls`); if (r.ok) setControls(await r.json()); } catch {}
  };
  useEffect(() => {
    if (!verified || !passwordChanged || tab !== "sensors") return;
    loadControls();
    const id = setInterval(loadControls, 10000);
    return () => clearInterval(id);
  }, [verified, passwordChanged, tab]);

  const toggleControl = async (feature: string, disabled: boolean) => {
    const message = ctlMsg[feature] ?? controls.find(c => c.feature === feature)?.message ?? "";
    if (!window.confirm((disabled ? "Switch OFF " : "Switch ON ") + (CONTROL_LABELS[feature] ?? feature) + "?" + (disabled ? "\nUsers will see: " + message : ""))) return;
    try {
      const res = await authFetch(`/api/admin/kiosk-controls/${feature}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled, message }),
      });
      const data = await res.json();
      if (res.ok && data.success) setControls(data.controls); else alert(data.error ?? "Failed.");
    } catch { alert("Could not reach backend."); }
  };  

  const handleLogout = () => {
    if (window.confirm("Log out of the admin panel?")) {
      setToken(null);
      setPrintPricingForm(null);
      setPasswordChanged(true);
      setLoginStep("username");
      setUserInput("");
      setTab("logs");
      setShowDropdown(false);
      setShowAccountModal(false);
      setShowMaintenanceModal(false);
      setCalForm(null);
      setBadges(ZERO_BADGES);
      seenSensorRef.current = null;
    }
  };

  const hasFilter = !!(searchQuery || filterValue !== "all" || dateFilter);

  if (!verified) {
    return (
      <div style={fullScreen} data-nokb>
        <div style={{ ...headerBar, paddingLeft: 24 }}>
          <LockPersonIcon size={22} color="#f0a500" />
          <div>
            <div style={headerTitle}>Admin Access</div>
            <div style={headerSub}>
              {authView === "reset" ? "Reset your password" : authView === "forgot" ? "Password Recovery" : loginStep === "username" ? "Enter your admin username" : `Logging in as: ${userInput}`}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
          </div>
        </div>
        <div style={loginBody}>
          <div style={loginPanel}>
            {sessionNotice && (
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "#f0a500", background: "#2a2418", border: "1px solid #5a4a1a", borderRadius: 8, padding: 10 }}>
                {sessionNotice}
              </div>
            )}
            {authView === "reset" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600 }}>New Password</div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showResetPass ? "text" : "password"}
                    value={newResetPass}
                    onChange={e => setNewResetPass(e.target.value)}
                    placeholder="At least 8 characters"
                    style={{ ...inputStyle, paddingRight: 45 }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPass(!showResetPass)}
                    style={{
                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "var(--admin-muted)", cursor: "pointer", fontSize: 13
                    }}
                  >
                    {showResetPass ? "Hide" : "Show"}
                  </button>
                </div>

                <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600, marginTop: 4 }}>Confirm New Password</div>
                <input
                  type="password"
                  value={resetConfirmPass}
                  onChange={e => setResetConfirmPass(e.target.value)}
                  placeholder="Re-enter new password"
                  style={inputStyle}
                />

                {resetMsg && <div style={{ fontSize: 12, color: resetMsg.startsWith("Password successfully") ? "#2ecc71" : "#e74c3c", display: "flex", alignItems: "center", gap: 6 }}>
                  {resetMsg.startsWith("Password successfully") ? <CheckCircleIcon size={15} color="#2ecc71" /> : <XCircleIcon size={15} color="#e74c3c" />} {resetMsg}
                </div>}
                
                <button
                  onClick={handleResetPasswordSubmit}
                  disabled={!newResetPass || !resetConfirmPass}
                  style={{
                    padding: "12px", borderRadius: 8, fontWeight: 700, 
                    background: !newResetPass || !resetConfirmPass ? "#333" : "#f0a500", 
                    color: !newResetPass || !resetConfirmPass ? "#555" : "#000", 
                    border: "none", cursor: !newResetPass || !resetConfirmPass ? "not-allowed" : "pointer", marginTop: 4 
                  }}
                >
                  Update Password
                </button>
              </div>
            ) : authView === "forgot" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600 }}>Username</div>
                <input
                  type="text"
                  value={forgotUsername}
                  onChange={e => setForgotUsername(e.target.value)}
                  placeholder="Enter admin username"
                  style={inputStyle}
                  autoFocus
                />
                <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600, marginTop: 4 }}>Registered Gmail Address</div>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="Enter exact account Gmail"
                  style={inputStyle}
                />
                {forgotMsg && <div style={{ fontSize: 12, color: forgotMsg.startsWith("Password") ? "#2ecc71" : "#f0a500", lineHeight: 1.4 }}>{forgotMsg}</div>}
                <button
                  onClick={handleForgotPasswordRequest}
                  disabled={!forgotUsername.trim() || !forgotEmail.trim() || forgotLoading}
                  style={{ padding: "12px", borderRadius: 8, fontWeight: 700, background: "#f0a500", color: "#000", border: "none", cursor: "pointer", marginTop: 4 }}
                >
                  {forgotLoading ? "Sending..." : "Send Reset Link"}
                </button>
                <button
                  onClick={() => { setAuthView("login"); setForgotMsg(""); }}
                  style={{ background: "none", border: "none", color: "var(--admin-muted)", fontSize: 12, cursor: "pointer", marginTop: 4 }}
                >
                  ← Back to Log In
                </button>
              </div>
            ) : loginStep === "username" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600 }}>Username</div>
                <input
                  type="text"
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleNextStep(); }}
                  placeholder="Enter username"
                  autoCapitalize="none"
                  autoFocus
                  style={inputStyle}
                />
                {userError && <div style={{ fontSize: 12, color: "#e74c3c" }}>{userError}</div>}
                <button
                  onClick={handleNextStep}
                  disabled={!userInput.trim() || userCheckLoading}
                  style={{
                    padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14,
                    border: "none", cursor: !userInput.trim() || userCheckLoading ? "not-allowed" : "pointer",
                    background: !userInput.trim() || userCheckLoading ? "#333" : "#f0a500",
                    color: !userInput.trim() || userCheckLoading ? "#555" : "#000",
                    marginTop: 4,
                  }}
                >
                  {userCheckLoading ? "Checking..." : "Next"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600 }}>Password</div>
                  <button
                    onClick={() => { setLoginStep("username"); setPwInput(""); setPwError(""); }}
                    disabled={lockoutRemaining > 0}
                    style={{ background: "none", border: "none", color: "#f0a500", fontSize: 12, cursor: lockoutRemaining > 0 ? "not-allowed" : "pointer" }}
                  >
                    ← Change username
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={pwInput}
                    onChange={e => setPwInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handlePasswordLogin(); }}
                    placeholder="Enter password"
                    autoFocus
                    disabled={lockoutRemaining > 0}
                    style={{ ...inputStyle, paddingRight: 45, opacity: lockoutRemaining > 0 ? 0.5 : 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={lockoutRemaining > 0}
                    style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--admin-muted)", cursor: "pointer", fontSize: 13 }}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>

                <button
                  onClick={() => setAuthView("forgot")}
                  style={{ background: "none", border: "none", color: "#f0a500", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}
                >
                  Forgot password?
                </button>

                {pwError && !lockoutRemaining && <div style={{ fontSize: 12, color: "#e74c3c" }}>{pwError}</div>}
                {lockoutRemaining > 0 && (
                  <div style={{ fontSize: 13, color: "#e74c3c", fontWeight: 700, textAlign: "center", marginTop: 4 }}>
                     Locked out. Try again in {Math.floor(lockoutRemaining / 60)}:{(lockoutRemaining % 60).toString().padStart(2, '0')}
                  </div>
                )}
                <button
                  onClick={handlePasswordLogin}
                  disabled={!pwInput || pwLoading || lockoutRemaining > 0}
                  style={{
                    padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none",
                    cursor: !pwInput || pwLoading || lockoutRemaining > 0 ? "not-allowed" : "pointer",
                    background: !pwInput || pwLoading || lockoutRemaining > 0 ? "#333" : "#f0a500",
                    color: !pwInput || pwLoading || lockoutRemaining > 0 ? "#555" : "#000",
                    marginTop: 4,
                  }}
                >
                  {lockoutRemaining > 0 ? "Locked" : pwLoading ? "Checking..." : "Log in"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!passwordChanged) {
    return (
      <div style={fullScreen} data-nokb>
        <div style={{ ...headerBar, paddingLeft: 24 }}>
          <LockPersonIcon size={22} color="#f0a500" />
          <div>
            <div style={headerTitle}>Security Update Required</div>
            <div style={headerSub}>You must change your default password to continue</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
          </div>
        </div>
        <div style={loginBody}>
          <div style={loginPanel}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600 }}>New Password</div>
              <div style={{ position: "relative" }}>
                <input
                  type={showForcePass ? "text" : "password"}
                  value={forceNewPass}
                  onChange={e => setForceNewPass(e.target.value)}
                  placeholder="At least 8 characters"
                  style={{ ...inputStyle, paddingRight: 45 }}
                />
                <button
                  type="button"
                  onClick={() => setShowForcePass(!showForcePass)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--admin-muted)", cursor: "pointer", fontSize: 13 }}
                >
                  {showForcePass ? "Hide" : "Show"}
                </button>
              </div>
              <div style={{ fontSize: 13, color: "var(--admin-muted-strong)", fontWeight: 600, marginTop: 6 }}>Confirm New Password</div>
              <input
                type="password"
                value={forceConfirmPass}
                onChange={e => setForceConfirmPass(e.target.value)}
                placeholder="Re-enter new password"
                style={inputStyle}
              />
              {forceMsg && <div style={{ fontSize: 12, color: "#e74c3c" }}>{forceMsg}</div>}
              <button
                onClick={handleForcePasswordChange}
                disabled={!forceNewPass || !forceConfirmPass}
                style={{
                  padding: "12px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none",
                  cursor: !forceNewPass || !forceConfirmPass ? "not-allowed" : "pointer",
                  background: !forceNewPass || !forceConfirmPass ? "#333" : "#f0a500",
                  color: !forceNewPass || !forceConfirmPass ? "#555" : "#000",
                  marginTop: 4,
                }}
              >
                Update Password & Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={fullScreen} data-nokb>
      <input
        type="file"
        id="restoreFileInput"
        accept=".json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          if (!window.confirm("WARNING: Restoring a backup file will completely overwrite all current kiosk users, transactions, and settings. Proceed?")) {
            e.target.value = "";
            return;
          }

          try {
            const text = await file.text();
            const json = JSON.parse(text);

            const res = await authFetch(`/api/admin/restore`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(json),
            });
            const data = await res.json();

            if (res.ok && data.success) {
              alert("System successfully restored from backup!");
              setShowMaintenanceModal(false);
              fetchData();
            } else {
              alert(`Restore failed: ${data.error ?? "Unknown error"}`);
            }
          } catch {
            alert("Invalid JSON backup file format.");
          }
          e.target.value = "";
        }}
      />

      <div style={{ ...headerBar, paddingLeft: 24 }}>
        <LockPersonIcon size={22} color="#f0a500" />
        <div>
          <div style={headerTitle}>Admin Panel</div>
          <div style={headerSub}>Logged in as {myUsername} {isSuperAdmin && "· super-admin"}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, position: "relative" }} ref={dropdownRef}>
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
          <button onClick={() => setShowDropdown(!showDropdown)} style={actionBtn("var(--admin-hover)", "var(--kiosk-accent-text)")}>
            <SettingsIcon size={15} /> Settings ▾
          </button>
          
          {showDropdown && (
            <div style={dropdownMenu}>
              <button
                onClick={() => {
                  setShowDropdown(false);
                  setSettingsForm({ username: myUsername, email: myEmail, currentPassword: "", newPassword: "", confirmPassword: "" });
                  setSettingsMsg("");
                  setShowAccountModal(true);
                }}
                style={dropdownItem}
              >
                <AccountCircleIcon size={16} /> Account Settings
              </button>
              
              {isSuperAdmin && (
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    setShowMaintenanceModal(true); loadDriveStatus();
                  }}
                  style={dropdownItem}
                >
                  <WrenchIcon size={16} /> System Maintenance
                </button>
              )}

              <div style={{ height: "1px", background: "var(--admin-border)", margin: "4px 0" }} />

              <button onClick={handleLogout} style={{ ...dropdownItem, color: "#e74c3c" }}>
                <LogOutIcon size={16} /> Log Out
              </button>
            </div>
          )}

          <button onClick={() => fetchData()} style={refreshBtn}>↻ Refresh</button>
        </div>
      </div>

           <div style={tabBar}>
        {([
          ["analytics", <><RecyclingIcon size={15} /> Analytics</>],
          ["logs", <><PrintIcon size={15} /> Activity Logs</>],
          ["users", <><AccountCircleIcon size={15} /> Manage Users</>],
          ["transactions", <><RecyclingIcon size={15} /> Transactions</>],
          ["feedback", <><ChatIcon size={15} /> Feedback</>],
          ["sensors", <><WrenchIcon size={15} /> Components</>],
          ...(isSuperAdmin ? [["admins", <><LockPersonIcon size={15} /> Manage Admins</>] as [Tab, React.ReactNode]] : []),
        ] as [Tab, React.ReactNode][]).map(([t, label]) => (
          <button key={t} onClick={() => {
            tabRef.current = t;                                   // so an in-flight poll can't bring the badge back
            setTab(t);
            setSearchQuery(""); setFilterValue("all"); setDateFilter(""); setDebouncedQ("");
            setBadges(b => (b[t] === 0 ? b : { ...b, [t]: 0 })); // clears instantly
            if (t !== "sensors" && t !== "analytics") markSeen(t); // tells the server you've seen it
            }} style={{
            ...tabBtn,
            color: tab === t ? "var(--kiosk-accent-text)" : "var(--admin-muted)",
            borderBottom: tab === t ? "2px solid var(--kiosk-accent-text)" : "2px solid transparent",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {label}
              {badges[t] > 0 && <span style={badgeStyle}>{badges[t] > 99 ? "99+" : badges[t]}</span>}
            </span>
          </button>
        ))}
      </div>

      <div style={body}>
        {/* Overall System Impact Dashboard */}
        {tab !== "analytics" && <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16, flexShrink: 0 }}>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>Total Bottles Deposited</div>
            <div style={adminStatVal}>{stats.totalBottles}</div>
          </div>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>Plastic Recycled</div>
            <div style={{ ...adminStatVal, color: "#2ecc71", fontSize: 22 }}>{stats.totalPlasticKg} kg</div>
          </div>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>CO₂e Avoided</div>
            <div style={{ ...adminStatVal, color: "#3498db", fontSize: 22 }}>{stats.totalCo2G} g</div>
          </div>
          <div style={adminStatCard}>
            <div style={adminStatLabel}>Print Jobs Submitted</div>
            <div style={adminStatVal}>{stats.totalPrints}</div>
          </div>
        </div>}

        {loading && tab !== "analytics" && <div style={{ color: "var(--admin-muted)", fontSize: 14 }}>Loading...</div>}

        {tab === "analytics" && (
          <div style={{ width: "100%", minHeight: 0, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--admin-text)" }}>Actual</div>
                <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                  {analytics
                    ? `${analytics.startDate} to ${analytics.endDate} · Asia/Manila`
                    : `Last ${analyticsRange} days · Asia/Manila`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div role="group" aria-label="Analytics range" style={{ display: "flex", border: "1px solid var(--admin-border-strong)", borderRadius: 8, overflow: "hidden" }}>
                  {ANALYTICS_RANGES.map((option, idx) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={analyticsRange === option.value}
                      onClick={() => setAnalyticsRange(option.value)}
                      style={{
                        minHeight: 36, padding: "6px 12px", border: 0,
                        borderRight: idx === ANALYTICS_RANGES.length - 1 ? 0 : "1px solid var(--admin-border-strong)",
                        background: analyticsRange === option.value ? "var(--admin-hover)" : "var(--admin-surface)",
                        color: analyticsRange === option.value ? "var(--kiosk-accent-text)" : "var(--admin-muted)",
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}
                    >{option.label}</button>
                  ))}
                </div>
                <div role="group" aria-label="Chart granularity" style={{ display: "flex", border: "1px solid var(--admin-border-strong)", borderRadius: 8, overflow: "hidden" }}>
                  {ANALYTICS_VIEWS.map((option, idx) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={analyticsView === option.value}
                      onClick={() => setAnalyticsView(option.value)}
                      style={{
                        minHeight: 36, padding: "6px 12px", border: 0,
                        borderRight: idx === ANALYTICS_VIEWS.length - 1 ? 0 : "1px solid var(--admin-border-strong)",
                        background: analyticsView === option.value ? "var(--admin-hover)" : "var(--admin-surface)",
                        color: analyticsView === option.value ? "var(--kiosk-info-text)" : "var(--admin-muted)",
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}
                    >{option.label}</button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-pressed={showResale}
                  onClick={() => setShowResale(v => !v)}
                  style={{
                    minHeight: 36, padding: "6px 12px", borderRadius: 8,
                    border: "1px solid var(--admin-border-strong)",
                    background: showResale ? "var(--admin-hover)" : "var(--admin-surface)",
                    color: showResale ? "var(--kiosk-accent-text)" : "var(--admin-muted)",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >Resale estimate</button>
              </div>
            </div>

            {analyticsError && <div role="alert" style={{ color: "var(--kiosk-danger-text)", fontSize: 13 }}>{analyticsError}</div>}
            {analyticsLoading && !analytics && <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>Loading analytics...</div>}
            {analytics && (() => {
              const chartSource =
                analyticsView === "daily"
                  ? analytics.todayHourly.map(h => ({
                      label: h.hour,
                      bottles: h.bottlesAccepted,
                      co2: h.co2SavedG,
                      confirmedPrints: h.confirmedPrints,
                      submittedPrints: h.submittedPrints,
                    }))
                  : analyticsView === "yearly"
                    ? analytics.yearlyMonthly.map(m => ({
                        label: m.month,
                        bottles: m.bottlesAccepted,
                        co2: m.co2SavedG,
                        confirmedPrints: m.confirmedPrints,
                        submittedPrints: m.submittedPrints,
                      }))
                    : analytics.dailySeries.map(d => ({
                        label: d.date.slice(5),
                        bottles: d.bottlesAccepted,
                        co2: d.co2SavedG,
                        confirmedPrints: d.confirmedPrints,
                        submittedPrints: d.submittedPrints,
                      }));
              const viewSubtitle =
                analyticsView === "daily"
                  ? `Today (${analytics.endDate}) by hour`
                  : analyticsView === "yearly"
                    ? `${analytics.endDate.slice(0, 4)} by month`
                    : `Last ${analytics.range} days (daily)`;

              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10, flexShrink: 0 }}>
                    {[
                      {
                        label: "Bottles accepted",
                        value: analytics.totals.bottlesAccepted.toLocaleString(),
                        sub: `${analytics.totals.rejectedBottles.toLocaleString()} rejected`,
                        delta: analytics.percentChange.bottlesAccepted,
                        color: "var(--kiosk-accent-text)",
                      },
                      {
                        label: "Plastic recycled",
                        value: `${analytics.totals.plasticWeightKg.toFixed(2)} kg`,
                        sub: `${analytics.totals.creditsIssued.toLocaleString()} credits issued`,
                        delta: analytics.percentChange.plasticWeightKg,
                        color: "var(--kiosk-success-text)",
                      },
                      {
                        label: "CO₂ saved",
                        value: `${analytics.totals.co2SavedG.toLocaleString()} g`,
                        sub: "From accepted deposits",
                        delta: analytics.percentChange.co2SavedG,
                        color: "var(--kiosk-info-text)",
                      },
                      {
                        label: "Confirmed prints",
                        value: analytics.totals.confirmedPrints.toLocaleString(),
                        sub: `${analytics.totals.submittedPrints.toLocaleString()} submitted · ${analytics.totals.refundedPrints.toLocaleString()} refunded`,
                        delta: analytics.percentChange.confirmedPrints,
                        color: "var(--admin-text)",
                      },
                      {
                        label: "Print credits spent",
                        value: analytics.totals.printCreditsSpent.toLocaleString(),
                        sub: "Net of refunded jobs",
                        delta: analytics.percentChange.printCreditsSpent,
                        color: "var(--admin-text)",
                      },
                      {
                        label: "Busiest hour",
                        value: analytics.busiestHour ? analytics.busiestHour.label : "No activity",
                        sub: analytics.busiestHour ? `${analytics.busiestHour.count.toLocaleString()} actions (Manila)` : "Selected range",
                        delta: undefined as number | null | undefined,
                        color: "var(--kiosk-accent-text)",
                      },
                    ].map(card => {
                      const deltaBadge = card.delta !== undefined ? formatDeltaBadge(card.delta) : null;
                      return (
                        <div key={card.label} style={{ ...adminStatCard, padding: "12px 14px" }}>
                          <div style={adminStatLabel}>{card.label}</div>
                          <div style={{ ...adminStatVal, color: card.color, fontSize: 20 }}>{card.value}</div>
                          <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 3 }}>{card.sub}</div>
                          {deltaBadge && (
                            <div style={{ fontSize: 11, fontWeight: 600, color: deltaBadge.color, marginTop: 2 }}>
                              {deltaBadge.text}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Card vs Guest Split */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, flexShrink: 0 }}>
                    {([
                      ["Card users (RFID)", analytics.cardVsGuest.card, "var(--kiosk-info-text)"],
                      ["Guest sessions", analytics.cardVsGuest.guest, "var(--kiosk-accent-text)"],
                    ] as const).map(([title, split, accent]) => (
                      <div key={title} style={{ ...adminStatCard, padding: "10px 14px", borderLeft: `3px solid ${accent}` }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--admin-text)", marginBottom: 4 }}>{title}</div>
                        <div style={{ fontSize: 12, color: "var(--admin-secondary)", display: "flex", gap: 14, flexWrap: "wrap" }}>
                          <span><strong>{split.bottlesAccepted.toLocaleString()}</strong> bottles ({split.plasticWeightKg.toFixed(2)} kg)</span>
                          <span><strong>{split.creditsIssued.toLocaleString()}</strong> credits issued</span>
                          <span><strong>{split.confirmedPrints.toLocaleString()}</strong> confirmed prints</span>
                          <span><strong>{split.printCreditsSpent.toLocaleString()}</strong> credits spent</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Toggleable Resale Estimate Panel */}
                  {showResale && (
                    <div style={{ ...adminStatCard, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text)" }}>Resale estimate</div>
                          <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                            What-if gross resale calculation using accepted PET deposits only
                          </div>
                        </div>
                        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--admin-muted-strong)" }}>
                          Resale price (₱ per kg)
                          <input
                            type="number"
                            min={4}
                            max={10}
                            step={0.5}
                            value={resalePriceInput}
                            onChange={event => {
                              const raw = event.target.value;
                              setResalePriceInput(raw);
                              const num = raw.trim() === "" ? NaN : Number(raw);
                              if (Number.isFinite(num) && num >= 4 && num <= 10) {
                                try {
                                  window.localStorage.setItem("b2p-resale-price", String(num));
                                } catch {}
                              }
                            }}
                            onBlur={() => {
                              const parsed = resalePriceInput.trim() === "" ? NaN : Number(resalePriceInput);
                              const clamped = Number.isFinite(parsed) ? clampResalePrice(parsed) : 7;
                              const nextStr = String(clamped);
                              setResalePriceInput(nextStr);
                              try {
                                window.localStorage.setItem("b2p-resale-price", nextStr);
                              } catch {}
                            }}
                            style={{ ...inputStyle, width: 150, padding: "7px 10px", fontSize: 14 }}
                          />
                          {resaleEstimate.error && (
                            <span role="alert" style={{ fontSize: 11, fontWeight: 500, color: "var(--kiosk-danger-text)" }}>
                              {resaleEstimate.error}
                            </span>
                          )}
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                        <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--admin-input)", border: "1px solid var(--admin-border)" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--admin-text)", marginBottom: 4 }}>
                            Actual (selected range)
                          </div>
                          <div style={{ fontSize: 11, color: "var(--admin-muted)", marginBottom: 6 }}>
                            {analytics.startDate} to {analytics.endDate}
                          </div>
                          <div style={{ fontSize: 13, color: "var(--admin-secondary)" }}>
                            {analytics.totals.plasticWeightKg.toFixed(2)} kg ×{" "}
                            {resaleEstimate.activePrice !== null ? `₱${resaleEstimate.activePrice}/kg` : "—"} ={" "}
                            <strong style={{ color: "var(--kiosk-success-text)", fontSize: 16 }}>
                              {resaleEstimate.actualPhp !== null ? formatResalePhp(resaleEstimate.actualPhp) : "—"}
                            </strong>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                            <span>
                              Card ({analytics.cardVsGuest.card.plasticWeightKg.toFixed(2)} kg):{" "}
                              <strong style={{ color: "var(--admin-text)" }}>
                                {resaleEstimate.cardPhp !== null ? formatResalePhp(resaleEstimate.cardPhp) : "—"}
                              </strong>
                            </span>
                            <span>
                              Guest ({analytics.cardVsGuest.guest.plasticWeightKg.toFixed(2)} kg):{" "}
                              <strong style={{ color: "var(--admin-text)" }}>
                                {resaleEstimate.guestPhp !== null ? formatResalePhp(resaleEstimate.guestPhp) : "—"}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--admin-input)", border: "1px solid var(--admin-border)" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--admin-text)", marginBottom: 4 }}>
                            Forecast
                          </div>
                          {!analytics.forecast.ready ? (
                            <div style={{ fontSize: 12, color: "var(--kiosk-accent-text)", fontWeight: 600 }}>
                              {analytics.forecast.reason}
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13, color: "var(--admin-secondary)" }}>
                              <div>
                                Next 7 days: {analytics.forecast.next7Days.plasticWeightKg.toFixed(2)} kg ×{" "}
                                {resaleEstimate.activePrice !== null ? `₱${resaleEstimate.activePrice}/kg` : "—"} ={" "}
                                <strong style={{ color: "var(--kiosk-accent-text)" }}>
                                  {resaleEstimate.forecast7Php !== null ? formatResalePhp(resaleEstimate.forecast7Php) : "—"}
                                </strong>
                              </div>
                              <div>
                                Next 30 days: {analytics.forecast.next30Days.plasticWeightKg.toFixed(2)} kg ×{" "}
                                {resaleEstimate.activePrice !== null ? `₱${resaleEstimate.activePrice}/kg` : "—"} ={" "}
                                <strong style={{ color: "var(--kiosk-info-text)" }}>
                                  {resaleEstimate.forecast30Php !== null ? formatResalePhp(resaleEstimate.forecast30Php) : "—"}
                                </strong>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ ...tableWrap, flex: "none", overflowX: "auto" }}>
                        <table style={table}>
                          <thead>
                            <tr>
                              {["Price", "Actual", "Forecast 7 days", "Forecast 30 days"].map(heading => (
                                <th key={heading} style={th}>{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {resaleEstimate.comparisonRows.map(row => {
                              const isCurrent = resaleEstimate.activePrice === row.price;
                              return (
                                <tr key={row.price} style={{ borderBottom: "1px solid var(--admin-row-border)", background: isCurrent ? "var(--admin-hover)" : "transparent" }}>
                                  <td style={{ ...td, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "var(--kiosk-accent-text)" : "var(--admin-text)" }}>
                                    {row.tag}
                                  </td>
                                  <td style={td}>{formatResalePhp(row.actualPhp)}</td>
                                  <td style={td}>{row.forecast7Php !== null ? formatResalePhp(row.forecast7Php) : "Needs at least 14 days of data"}</td>
                                  <td style={td}>{row.forecast30Php !== null ? formatResalePhp(row.forecast30Php) : "Needs at least 14 days of data"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ fontSize: 11, color: "var(--admin-muted)" }}>
                        Gross estimate only. It does not include collection, transport or electricity costs, and the forecast is a projection, not a guarantee.
                      </div>
                    </div>
                  )}

                  {/* Actual SVG Charts */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, flexShrink: 0 }}>
                    <AnalyticsSeriesChart
                      title="Bottles accepted"
                      subtitle={viewSubtitle}
                      points={chartSource.map(p => ({ label: p.label, value: p.bottles }))}
                      color="var(--kiosk-accent-text)"
                    />
                    <AnalyticsSeriesChart
                      title="CO₂ saved"
                      subtitle={viewSubtitle}
                      points={chartSource.map(p => ({ label: p.label, value: p.co2 }))}
                      color="var(--kiosk-success-text)"
                      unitSuffix=" g"
                    />
                    <AnalyticsSeriesChart
                      title="Print jobs (confirmed vs submitted)"
                      subtitle={viewSubtitle}
                      points={chartSource.map(p => ({ label: p.label, value: p.confirmedPrints, secondaryValue: p.submittedPrints }))}
                      color="var(--kiosk-info-text)"
                      primaryLabel="Confirmed"
                      secondaryColor="var(--admin-muted)"
                      secondaryLabel="Submitted"
                    />
                    {analytics.binHistory.length > 0 && (
                      <AnalyticsSeriesChart
                        title="Bin fill % history"
                        subtitle={analytics.binFillPercent !== null ? `Latest: ${analytics.binFillPercent}%` : "Recorded readings"}
                        points={analytics.binHistory.map(b => ({ label: b.date.slice(5), value: b.latestFillPercent }))}
                        color="var(--kiosk-danger-text)"
                        unitSuffix="%"
                        fixedMax={100}
                      />
                    )}
                  </div>

                  {/* Forecast Section */}
                  <div style={{ borderTop: "1px solid var(--admin-border-strong)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--admin-text)" }}>Forecast</span>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--kiosk-warning-bg)", border: "1px solid var(--kiosk-warning-border)", color: "var(--kiosk-accent-text)" }}>
                            ESTIMATE ONLY
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                          Projected from recorded daily history (7-day moving average blended with linear trend) — estimates only, not guaranteed actuals.
                        </div>
                      </div>
                      {analytics.forecast.ready && (
                        <div role="group" aria-label="Forecast chart metric" style={{ display: "flex", border: "1px solid var(--admin-border-strong)", borderRadius: 8, overflow: "hidden" }}>
                          {([
                            ["bottles", "Bottles"],
                            ["co2SavedG", "CO₂"],
                            ["confirmedPrints", "Prints"],
                          ] as [ForecastMetric, string][]).map(([metricKey, label], idx) => (
                            <button
                              key={metricKey}
                              type="button"
                              aria-pressed={forecastMetric === metricKey}
                              onClick={() => setForecastMetric(metricKey)}
                              style={{
                                minHeight: 34, padding: "6px 12px", border: 0,
                                borderRight: idx === 2 ? 0 : "1px solid var(--admin-border-strong)",
                                background: forecastMetric === metricKey ? "var(--admin-hover)" : "var(--admin-surface)",
                                color: forecastMetric === metricKey ? "var(--kiosk-accent-text)" : "var(--admin-muted)",
                                fontSize: 12, fontWeight: 700, cursor: "pointer",
                              }}
                            >{label}</button>
                          ))}
                        </div>
                      )}
                    </div>

                    {!analytics.forecast.ready ? (
                      <div style={{ ...adminStatCard, padding: "14px 16px", background: "var(--kiosk-warning-bg)", border: "1px solid var(--kiosk-warning-border)" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--kiosk-accent-text)" }}>{analytics.forecast.reason}</div>
                        <div style={{ fontSize: 12, color: "var(--admin-secondary)", marginTop: 4 }}>
                          Recorded activity on {analytics.forecast.activeDays} day(s) so far. Forecast numbers and trend projections appear once at least 14 days of data are available.
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 10 }}>
                          <div style={{ ...adminStatCard, padding: "12px 14px" }}>
                            <div style={adminStatLabel}>Next 7 days (estimate)</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--kiosk-accent-text)" }}>
                              {analytics.forecast.next7Days.bottles.toLocaleString()} bottles
                            </div>
                            <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 3 }}>
                              {analytics.forecast.next7Days.co2SavedG.toLocaleString()} g CO₂ · {analytics.forecast.next7Days.confirmedPrints.toLocaleString()} prints
                            </div>
                          </div>
                          <div style={{ ...adminStatCard, padding: "12px 14px" }}>
                            <div style={adminStatLabel}>Next 30 days (estimate)</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--kiosk-info-text)" }}>
                              {analytics.forecast.next30Days.bottles.toLocaleString()} bottles
                            </div>
                            <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 3 }}>
                              {analytics.forecast.next30Days.co2SavedG.toLocaleString()} g CO₂ · {analytics.forecast.next30Days.confirmedPrints.toLocaleString()} prints
                            </div>
                          </div>
                          {analytics.forecast.estimatedBinFullDate && (
                            <div style={{ ...adminStatCard, padding: "12px 14px" }}>
                              <div style={adminStatLabel}>Estimated bin-full date</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--kiosk-danger-text)" }}>
                                {analytics.forecast.estimatedBinFullDate}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 3 }}>
                                ~{analytics.forecast.daysUntilBinFull} day(s) · avg {analytics.forecast.avgBottlesPerDay} bottles/day
                              </div>
                            </div>
                          )}
                        </div>

                        <AnalyticsActualVsForecastChart
                          actual={analytics.dailySeries}
                          projected={analytics.forecast.projectedSeries}
                          metric={forecastMetric}
                          label={forecastMetric === "bottles" ? "Bottles accepted" : forecastMetric === "co2SavedG" ? "CO₂ saved" : "Confirmed prints"}
                          unitSuffix={forecastMetric === "co2SavedG" ? " g" : ""}
                        />
                      </>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

         {/* 1. ACTIVITY LOGS */}
        {!loading && tab === "logs" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search logs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
             <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 200, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">All Actions</option>
                {Object.entries(LOG_GROUPS).map(([key, g]) => (
                  <option key={key} value={key}>{g.label}</option>
                   ))}
              </select>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140, padding: "8px 12px", fontSize: 13, colorScheme: "dark", cursor: "pointer" }}
              />
              {(searchQuery || filterValue !== "all" || dateFilter) && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); setDateFilter(""); }} style={actionBtn("var(--admin-hover)", "var(--admin-muted)")}>Clear</button>
              )}
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Time", "Admin User", "Action", "Details"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {activityLogs.map(l => (
                      <tr key={l.id} style={{ borderBottom: "1px solid var(--admin-row-border)" }}>
                        <td style={td}>{formatPhTime(l.created_at)}</td>
                        <td style={{ ...td, fontWeight: 600, color: "#f0a500" }}>{l.admin_user}</td>
                        <td style={td}><span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "var(--admin-hover)", color: "var(--admin-text)" }}>{l.action}</span></td>
                        <td style={td}>{l.details}</td>
                      </tr>
                    ))}
                  {activityLogs.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: "var(--admin-muted)" }}>{hasFilter ? "No matching logs" : "No activity logs recorded yet"}</td></tr>}
                </tbody>
              </table>
            </div>
            {activityLogs.length >= limits.logs && (
  <button onClick={() => showMore("logs")} style={{ ...ghostBtn, flex: "unset", alignSelf: "center", padding: "8px 20px", fontSize: 12 }}>
    Show more
  </button>
)}
          </div>
        )}
         {/* 2. MANAGE USERS */}
        {!loading && tab === "users" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search users name, ID, RFID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
              <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 180, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">Default Order</option>
                <option value="credits_asc">Credits: Low to High</option>
                <option value="credits_desc">Credits: High to Low</option>
              </select>
              {(searchQuery || filterValue !== "all") && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); }} style={actionBtn("var(--admin-hover)", "var(--admin-muted)")}>Clear</button>
              )}
            </div>
            <div style={{ fontSize: 12, color: isSuperAdmin ? "var(--admin-muted)" : "var(--kiosk-accent-text)" }}>
              {isSuperAdmin
                ? "Deleting a user removes the account and anonymizes their past activity. Kiosk-wide totals are preserved."
                : "Only a super-admin can delete accounts. Historical activity is anonymized, not removed from kiosk totals."}
            </div>
            {userDeleteMsg && (
              <div role="status" style={{ fontSize: 12, color: userDeleteMsg.startsWith("User ") ? "var(--kiosk-success-text)" : "var(--kiosk-danger-text)" }}>
                {userDeleteMsg}
              </div>
            )}
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Name", "Student ID", "RFID", "Credits", "Registered", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {users.map(u => (
                      <tr key={u.rfid} style={{ borderBottom: "1px solid var(--admin-row-border)" }}>
                        <td style={td}>{u.name}</td>
                        <td style={td}>{u.studentId || <span style={{ color: "var(--admin-muted)" }}>—</span>}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "var(--admin-muted-strong)" }}>{u.rfid}</td>
                        <td style={{ ...td, color: "var(--kiosk-accent-text)", fontWeight: 700 }}>{u.credits}</td>
                        <td style={{ ...td, fontSize: 11, color: "var(--admin-muted)" }}>{new Date(u.created_at).toLocaleDateString()}</td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button onClick={() => { setEditUserModal(u); setEditName(u.name); setEditStudentId(u.studentId); setEditMsg("");setCreditAmount(""); setCreditReason(""); setCreditMsg(""); }} style={actionBtn("#1e293b", "#38bdf8")}>Edit</button>
                            <button
                              onClick={() => handleDeleteUser(u.rfid)}
                              disabled={!isSuperAdmin}
                              title={isSuperAdmin ? "Delete this account and anonymize its history" : "Only a super-admin can delete users"}
                              style={{
                                ...actionBtn("#3a1a1a", "#e74c3c"),
                                opacity: isSuperAdmin ? 1 : 0.65,
                                cursor: isSuperAdmin ? "pointer" : "not-allowed",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {users.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "var(--admin-muted)" }}>{hasFilter ? "No matching users" : "No users yet"}</td></tr>}
                </tbody>
              </table>
            </div>
            {users.length >= limits.users && (
  <button onClick={() => showMore("users")} style={{ ...ghostBtn, flex: "unset", alignSelf: "center", padding: "8px 20px", fontSize: 12 }}>
    Show more
  </button>
)}
          </div>
        )}
         {/* 3. TRANSACTIONS */}
        {!loading && tab === "transactions" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search transactions by name, RFID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
              <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 190, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">All Transactions</option>
                <option value="deposit">Bottle Deposits</option>
                <option value="print">Print Jobs</option>
                <option value="transfer">Credit Transfers</option>
                <option value="reject">Rejected Bottles</option>
              </select>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140, padding: "8px 12px", fontSize: 13, colorScheme: "dark", cursor: "pointer" }}
              />
              {(searchQuery || filterValue !== "all" || dateFilter) && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); setDateFilter(""); }} style={actionBtn("var(--admin-hover)", "var(--admin-muted)")}>Clear</button>
              )}
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Name", "Time", "RFID", "Type", "Details", "Credits"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                 {txns.map(t => (
                      <tr key={t.id} style={{ borderBottom: "1px solid var(--admin-row-border)" }}>
                        <td style={{ ...td, fontWeight: 600, color: "var(--admin-text)" }}>{t.user_name ? t.user_name : t.rfid === "GUEST" ? <span style={{ color: "var(--admin-muted)" }}>Guest</span> : <span style={{ color: "var(--kiosk-danger-text)", fontStyle: "italic" }}>Unknown</span>}</td>
                        <td style={td}>{formatPhTime(t.created_at)}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "var(--admin-muted-strong)" }}>{t.rfid}</td>
                        <td style={td}>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11,
                            background: t.type === "reject" ? "#3a1a1a" : "#2a2a2a",
                            color: t.type === "reject" ? "#e74c3c" : "#fff" }}>
                            {t.type}
                          </span>
                        </td>
                        <td style={td}>
  {(() => {
    const h = t.height_mm != null ? `${mmToCm(t.height_mm)} cm` : "—";
    const w = t.weight_g != null ? `${t.weight_g} g` : "—";
    const sub = <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 2 }}>Height {h} · Weight {w}</div>;
    if (t.type === "reject") {
      const labels: Record<string, string> = {
        capacitive: "Capacitive", tof: "ToF", loadcell: "Load cell", "loadcell+tof": "Load cell + ToF",storage: "Storage",
      };
      return (
        <div>
          <div style={{ color: "#e74c3c", fontWeight: 600 }}>
            Failed at {labels[t.reject_stage ?? ""] ?? "unknown"}: {t.reject_reason ?? "no reason recorded"}
          </div>
          {sub}
        </div>
      );
    }
    if (t.type === "deposit") return <div><div>{t.size ?? "—"}</div>{sub}</div>;
    return t.size ?? "—";
  })()}
</td>
                      <td style={{
  ...td, fontWeight: 700,
  color: t.credits > 0 && (t.type === "deposit" || t.type === "transfer_in" || t.type === "adjust") ? "#2ecc71"
       : t.type === "transfer_out" || t.type === "print" || t.credits < 0? "#e74c3c" : "#f0a500",
}}>
  {t.credits > 0 && (t.type === "deposit" || t.type === "transfer_in" || t.type === "adjust") ? `+${t.credits}`
    : t.type === "transfer_out" || t.type === "print" || t.credits < 0 ? `-${Math.abs(t.credits)}` : `0`}
</td>
                      </tr>
                    ))}
                  {txns.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "var(--admin-muted)" }}>{hasFilter ? "No matching transactions" : "No transactions yet"}</td></tr>}
                </tbody>
              </table>
            </div>
            {txns.length >= limits.txns && (
  <button onClick={() => showMore("txns")} style={{ ...ghostBtn, flex: "unset", alignSelf: "center", padding: "8px 20px", fontSize: 12 }}>
    Show more
  </button>
)}
          </div>
        )}
         {/* 4. FEEDBACK */}
        {!loading && tab === "feedback" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search feedback context, comment..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, maxWidth: 240, padding: "8px 12px", fontSize: 13 }}
              />
              <select
                value={filterValue}
                onChange={e => setFilterValue(e.target.value)}
                style={{ ...inputStyle, maxWidth: 170, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
              >
                <option value="all">All Ratings</option>
                <option value="5">5 Stars</option>
                <option value="4">4 Stars</option>
                <option value="3">3 Stars</option>
                <option value="1">1-2 Stars</option>
              </select>
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                style={{ ...inputStyle, maxWidth: 140, padding: "8px 12px", fontSize: 13, colorScheme: "dark", cursor: "pointer" }}
              />
              {(searchQuery || filterValue !== "all" || dateFilter) && (
                <button onClick={() => { setSearchQuery(""); setFilterValue("all"); setDateFilter(""); }} style={actionBtn("var(--admin-hover)", "var(--admin-muted)")}>Clear</button>
              )}
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Time", "Context", "Rating", "Comment", "RFID"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {feedback.map(f => (
                      <tr key={f.id} style={{ borderBottom: "1px solid var(--admin-row-border)" }}>
                        <td style={td}>{formatPhTime(f.created_at)}</td>
                        <td style={td}>{f.context}</td>
                        <td style={{ ...td, color: "#f0a500", fontWeight: 700, display: "flex", gap: 2 }}>
                          {Array.from({ length: f.rating }, (_, i) => <StarIcon key={i} size={14} color="#f0a500" />)}
                        </td>
                        <td style={td}>{f.comment || "—"}</td>
                        <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "var(--admin-muted-strong)" }}>{f.rfid ?? "anon"}</td>
                      </tr>
                    ))}
                  {feedback.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--admin-muted)" }}>{hasFilter ? "No matching feedback" : "No feedback yet"}</td></tr>}
                </tbody>
              </table>
            </div>
            {feedback.length >= limits.feedback && (
  <button onClick={() => showMore("feedback")} style={{ ...ghostBtn, flex: "unset", alignSelf: "center", padding: "8px 20px", fontSize: 12 }}>
    Show more
  </button>
)}
          </div>
        )}
         {/* 5. SENSORS (any admin) */}
        {!loading && tab === "sensors" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16, height: "100%", overflowY: "auto" }}>
            
                        {/* Kiosk controls */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-muted-strong)", marginBottom: 8 }}>KIOSK CONTROLS</div>
              <div style={{ background: "var(--admin-surface)", border: "1px solid var(--admin-border-strong)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {controls.map(c => (
                  <div key={c.feature} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ width: 120, fontSize: 13, fontWeight: 700, color: "var(--admin-text)" }}>{CONTROL_LABELS[c.feature] ?? c.feature}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: c.disabled ? "#3a1a1a" : "#1a3a2a", color: c.disabled ? "#e74c3c" : "#2ecc71" }}>
                      {c.disabled ? "OFF" : "ON"}
                    </span>
                    <input value={ctlMsg[c.feature] ?? c.message} onChange={e => setCtlMsg({ ...ctlMsg, [c.feature]: e.target.value })}
                      maxLength={140} placeholder="Message shown to users"
                      disabled={!isSuperAdmin}
                      style={{ ...inputStyle, flex: 1, minWidth: 220, padding: "7px 10px", fontSize: 12 }} />
                    {c.disabled && (
                      <button onClick={() => toggleControl(c.feature, true)} disabled={!isSuperAdmin}
                        style={{ ...actionBtn("#2a2a2a", "#38bdf8"), padding: "7px 12px", opacity: isSuperAdmin ? 1 : 0.8, cursor: isSuperAdmin ? "pointer" : "not-allowed" }}>Update message</button>
                    )}
                    <button onClick={() => toggleControl(c.feature, !c.disabled)}
                      disabled={!isSuperAdmin}
                      style={{ ...actionBtn(c.disabled ? "#1a3a2a" : "#3a1a1a", c.disabled ? "#2ecc71" : "#e74c3c"), padding: "7px 14px", opacity: isSuperAdmin ? 1 : 0.8, cursor: isSuperAdmin ? "pointer" : "not-allowed" }}>
                      {c.disabled ? "Switch ON" : "Switch OFF"}
                    </button>
                    {c.disabled && c.changedBy && (
                      <div style={{ width: "100%", fontSize: 10, color: "var(--admin-muted)" }}>Off since {formatPhTime(c.changedAt)} by {c.changedBy}</div>
                    )}
                  </div>
                ))}
               </div>
              <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 6 }}>
                Switching a part off greys it out for new users and refuses new requests. A user already depositing finishes the current bottle.
              </div>
              {!isSuperAdmin && <div style={{ fontSize: 11, color: "var(--kiosk-accent-text)", marginTop: 4 }}>View only. Only a super-admin can change kiosk controls.</div>}
            </div>

            {/* Live connection status */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-muted-strong)", marginBottom: 8 }}>ARDUINO CONNECTION</div>
              {sensorStatus && (() => {
                const cfg: Record<string, { label: string; color: string }> = {
                  online:       { label: "Online",       color: "#2ecc71" },
                  unresponsive: { label: "Unresponsive", color: "#f0a500" },
                  offline:      { label: "Offline",      color: "#e74c3c" },
                };
                const c = cfg[sensorStatus.overall];
                return (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px",
                    borderRadius: 8, background: "var(--admin-surface)", border: `1px solid ${c.color}`,
                  }}>
                    {sensorStatus.overall === "online"
                      ? <CheckCircleIcon size={16} color={c.color} />
                      : <XCircleIcon size={16} color={c.color} />}
                    <span style={{ fontSize: 13, fontWeight: 700, color: c.color }}>{c.label}</span>
                    {sensorStatus.serial.error && <span style={{ fontSize: 12, color: "#e74c3c" }}>— {sensorStatus.serial.error}</span>}
                  </div>
                );
              })()}
                          {sensorStatus && (() => {
 const box = (color: string, children: React.ReactNode) => (
  <div style={{ display: "flex", justifyContent: "center", width: "100%", marginTop: 8 }}>
    <div style={{ fontSize: 12, color, maxWidth: 560, lineHeight: 1.5, textAlign: "center" }}>{children}</div>
  </div>
);
  const printerFault = sensorStatus.sensors.printer?.state === "fault";
  const printerBox = printerFault
    ? box("#e74c3c", <><strong>Printer: </strong>{sensorStatus.sensors.printer.lastDetail} {SENSOR_HINTS.printer}</>)
    : null;
  if (sensorStatus.overall === "offline") {
    return <>{box("var(--admin-muted)", "Readings below are the last known values and may be outdated. Check the USB cable and that ARDUINO_PORT in the backend .env matches the port. The kiosk retries every 5 seconds.")}{printerBox}</>;
  }
  if (sensorStatus.overall === "unresponsive") {
    return <>{box("var(--admin-muted)", "The Arduino is connected but not answering the heartbeat. Press its reset button or re-plug the USB cable.")}{printerBox}</>;
  }
               const now = Date.now();
               const faulted = SENSOR_ORDER.filter(id => sensorStatus.sensors[id]?.state === "fault");
               const silent = IDLE_MONITORED.filter(id => {
                  const h = sensorStatus.sensors[id];
                  return h && h.state !== "fault" && h.lastSeen && now - h.lastSeen > 60000;
                });
                if (!faulted.length && !silent.length) return null;
                const list = faulted.length ? faulted : silent;
                const first = list[0];
                const color = faulted.length ? "#e74c3c" : "#f0a500";
                return box(color, <>
                  <strong>{faulted.length ? "Check first: " : "Not reporting: "}{SENSOR_LABELS[first] ?? first}.</strong>{" "}
                  {SENSOR_HINTS[first]}
                  {list.length > 1 && <div style={{ color: "var(--admin-muted)" }}>Also affected: {list.slice(1).map(id => SENSOR_LABELS[id] ?? id).join(", ")}</div>}
                </>);
              })()}
            </div>
            

                       {/* Per-component last activity */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-muted-strong)", marginBottom: 8 }}>COMPONENTS ACTIVITY</div>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
                {sensorStatus && SENSOR_ORDER.filter(id => sensorStatus.sensors[id]).map(id => {
                  const h = sensorStatus.sensors[id];
                  const down = id !== "printer" && sensorStatus.overall !== "online";
                  const faulted = !down && h.state === "fault";
                  const secs = h.lastSeen ? Math.max(0, Math.round(((sensorStatus.serverNow ?? Date.now()) - h.lastSeen) / 1000)) : null;
                  const ago = formatAgo(secs);
                  const monitored = IDLE_MONITORED.includes(id);
                  const active = !down && monitored && !faulted && secs !== null && secs <= 20;
                  const silent = !down && monitored && !faulted && secs !== null && secs > 60;
                  const pct = sensorStatus.bin?.fillPercent ?? null;
                  const binColor = down || pct === null ? "var(--admin-muted)" : pct >= 95 ? "#e74c3c" : pct >= 80 ? "#f0a500" : "#2ecc71";
                  return (
                    <div key={id} title={SENSOR_HINTS[id]} onClick={() => setOpenHint(openHint === id ? null : id)} style={{
                      ...adminStatCard, textAlign: "left", cursor: "pointer", width: "calc(25% - 7.5px)",
                      ...(faulted ? { border: "1px solid #e74c3c" } : {}),
                      ...(silent ? { border: "1px solid #f0a500" } : {}),
                      ...(down ? { opacity: openHint === id ? 0.9 : 0.5 } : {}),
                    }}>
                      <div style={adminStatLabel}>{SENSOR_LABELS[id] ?? id}</div>
                      <div style={{ fontSize: 13, marginTop: 4, color: faulted ? "#e74c3c" : silent ? "#f0a500" : !down && (active || (!monitored && h.lastSeen)) ? "#2ecc71" : "var(--admin-muted)" }}>
                        {down ? (h.lastSeen ? `Last seen ${ago}` : "No data")
                          : faulted ? `Problem · ${ago}`
                          : active ? `Active · ${ago}`
                          : silent ? `No recent check · ${ago}`
                          : ago}
                      </div>
                      {(faulted || silent) && openHint !== id && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: faulted ? "#e74c3c" : "var(--kiosk-accent-text)", marginTop: 4 }}>Tap for what to check</div>
                      )}
                      {openHint === id && (
                        <div style={{ fontSize: 11, color: "var(--admin-secondary)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--admin-border)", lineHeight: 1.5 }}>
                          {down && (
                            <div style={{ color: "var(--kiosk-accent-text)", marginBottom: 4 }}>
                              Arduino is {sensorStatus.overall}, so this sensor can't be checked right now. Fix the USB connection first.
                            </div>
                          )}
                          {SENSOR_HINTS[id]}
                        </div>
                      )}
                      {h.lastDetail && <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 2 }}>{h.lastDetail}</div>}
                      {id === "servo" && (
                        <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 4 }}>Last action only. The gate has no feedback.</div>
                      )}
                      {id === "ultrasonic" && pct !== null && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: binColor }}>{down ? "Last known: " : ""}Bin {pct}% full</div>
                          <div style={{ height: 6, background: "var(--admin-border)", borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: binColor }} />
                          </div>
                          {!down && <div style={{ fontSize: 11, color: "var(--admin-muted)", marginTop: 4 }}>Checked every few seconds while idle</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Calibration */}
            {calForm && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--admin-muted-strong)", marginBottom: 8 }}>CALIBRATION</div>
                                 <div style={{ background: "var(--admin-surface)", border: "1px solid var(--admin-border-strong)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14, ...(isSuperAdmin ? {} : { pointerEvents: "none" as const }) }}>
                  {!isSuperAdmin && <div style={{ fontSize: 12, color: "#f0a500" }}>View only. Only a super-admin can change calibration.</div>}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                   <label style={calLabel}>ToF sanity min (cm)
            <input type="number" step="0.1" value={calForm.tofMinMm / 10}
    onChange={e => setCalForm({ ...calForm, tofMinMm: cmToMm(+e.target.value) })} style={inputStyle} />
</label>
<label style={calLabel}>ToF sanity max (cm)
  <input type="number" step="0.1" value={calForm.tofMaxMm / 10}
    onChange={e => setCalForm({ ...calForm, tofMaxMm: cmToMm(+e.target.value) })} style={inputStyle} />
</label>
                    <label style={calLabel}>Reject weight above (g)
                      <input type="number" value={calForm.weightMaxRejectG} onChange={e => setCalForm({ ...calForm, weightMaxRejectG: +e.target.value })} style={inputStyle} />
                    </label>
                  </div>

                                   <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                   <label style={calLabel}>"Short bottle" height gate (cm)
  <input type="number" step="0.1" value={calForm.shortBottleHeightMm / 10}
    onChange={e => setCalForm({ ...calForm, shortBottleHeightMm: cmToMm(+e.target.value) })} style={inputStyle} />
</label>
                    <label style={calLabel}>Max weight if short (g)
                      <input type="number" value={calForm.shortBottleWeightMaxG} onChange={e => setCalForm({ ...calForm, shortBottleWeightMaxG: +e.target.value })} style={inputStyle} />
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <label style={calLabel}>Bin empty distance (cm)
                      <input type="number" value={calForm.binEmptyCm} onChange={e => setCalForm({ ...calForm, binEmptyCm: +e.target.value })} style={inputStyle} />
                    </label>
                    <label style={calLabel}>Bin full distance (cm)
                      <input type="number" value={calForm.binFullCm} onChange={e => setCalForm({ ...calForm, binFullCm: +e.target.value })} style={inputStyle} />
                    </label>
                  </div>
                                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13, color: "var(--admin-secondary)" }}>
                     Empty chamber reading: <strong style={{ color: "#f0a500" }}>{mmToCm(calForm.tofMountMm)} cm</strong>
                    </div>
                    <button
                      onClick={measureEmpty}
                      disabled={tofCalBusy}
                      style={{ ...actionBtn("#1e293b", "#38bdf8"), padding: "8px 14px", fontSize: 12, opacity: tofCalBusy ? 0.5 : 1 }}
                    >
                      {tofCalBusy ? "Measuring..." : "Measure empty chamber"}
                    </button>
                  </div>

                {(() => {
  const hasH  = (s: SizeSpec) => s.minHeight != null && s.maxHeight != null;
  const total = calForm.sizes.length;
  const withH = calForm.sizes.filter(hasH).length;
  const allH  = total > 0 && withH === total;

  const lc  = sensorStatus?.sensors?.loadcell?.state ?? "unknown";
  const tof = sensorStatus?.sensors?.tof?.state ?? "unknown";

  let color = "var(--admin-muted)";
  let text  = "Waiting for the first bottle to check sensor status.";

  if (sensorStatus && sensorStatus.overall !== "online") {
    color = "#e74c3c";
    text  = `Arduino is ${sensorStatus.overall}: no bottle can be validated until it reconnects.`;
  } else if (lc === "ok" && tof === "ok") {
    if (withH > 0) { color = "#2ecc71"; text = "Load cell + ToF both active: dual validation. Weight and height must agree" + (allH ? "." : " on bands that have a height range."); }
    else           { color = "#f0a500"; text = "Both sensors active, but no band has a height range yet, so weight alone decides."; }
  } else if (lc === "fault" && tof !== "fault") {
    if (withH > 0) { color = "#f0a500"; text = "Load cell not responding: height only. ToF decides the size" + (allH ? "." : ` (only ${withH}/${total} bands have a height range).`); }
    else           { color = "#e74c3c"; text = "Load cell not responding and no height ranges saved: bottles will be rejected."; }
  } else if (tof === "fault" && lc !== "fault") {
    color = "#f0a500"; text = "ToF not responding: weight only. The load cell decides the size.";
  } else if (lc === "fault" && tof === "fault") {
    color = "#e74c3c"; text = "Both sensors not responding: bottles will be rejected.";
  } else if (lc === "ok") {
    color = "#f0a500"; text = "Load cell active, ToF has no data yet: weight only until a bottle reports a height.";
  } else if (tof === "ok") {
    color = "#f0a500"; text = "ToF active, load cell has no data yet.";
  }

  return (
    <div style={{ marginTop: -6 }}>
      <div style={{ fontSize: 11, lineHeight: 1.6, color }}>{text}</div>
      <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--admin-muted)" }}>Height ranges saved: {withH}/{total} bands</div>
    </div>
  );
})()}
                  {calForm.sizes.map((s, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--admin-row-border)" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                        <label style={calLabel}>Label
                          <input type="text" value={s.label} onChange={e => {
                            const sizes = [...calForm.sizes]; sizes[i] = { ...s, label: e.target.value };
                            setCalForm({ ...calForm, sizes });
                          }} style={{ ...inputStyle, width: 150 }} />
                        </label>
                        <label style={calLabel}>Min (g)
                          <input type="number" value={s.minWeight} onChange={e => {
                            const sizes = [...calForm.sizes]; sizes[i] = { ...s, minWeight: +e.target.value };
                            setCalForm({ ...calForm, sizes });
                          }} style={inputStyle} />
                        </label>
                        <label style={calLabel}>Max (g)
                          <input type="number" value={s.maxWeight} onChange={e => {
                            const sizes = [...calForm.sizes]; sizes[i] = { ...s, maxWeight: +e.target.value };
                            setCalForm({ ...calForm, sizes });
                          }} style={inputStyle} />
                        </label>
                        <label style={calLabel}>Credits
                          <input type="number" value={s.credits} onChange={e => {
                            const sizes = [...calForm.sizes]; sizes[i] = { ...s, credits: +e.target.value };
                            setCalForm({ ...calForm, sizes });
                          }} style={inputStyle} />
                        </label>
                        <button
                          onClick={() => {
                            if (calForm.sizes.length <= 1) return;
                            setCalForm({ ...calForm, sizes: calForm.sizes.filter((_, idx) => idx !== i) });
                          }}
                          disabled={calForm.sizes.length <= 1}
                          title={calForm.sizes.length <= 1 ? "At least one band is required" : "Remove this band"}
                          style={{
                            ...actionBtn("#3a1a1a", "#e74c3c"), height: 40, padding: "0 14px",
                            opacity: calForm.sizes.length <= 1 ? 0.4 : 1,
                            cursor: calForm.sizes.length <= 1 ? "not-allowed" : "pointer",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", paddingLeft: 4 }}>
                        <span style={{ fontSize: 11, color: "var(--admin-muted)", width: 140 }}>↳ Height range (cm)</span>
<label style={calLabel}>Min height
  <input type="number" step="0.1"
    value={s.minHeight != null ? s.minHeight / 10 : ""}
    placeholder="blank = skip"
    onChange={e => {
      const v = e.target.value === "" ? undefined : cmToMm(+e.target.value);
      const sizes = [...calForm.sizes]; sizes[i] = { ...s, minHeight: v };
      setCalForm({ ...calForm, sizes });
    }}
    style={inputStyle} />
</label>
<label style={calLabel}>Max height
  <input type="number" step="0.1"
    value={s.maxHeight != null ? s.maxHeight / 10 : ""}
    placeholder="blank = skip"
    onChange={e => {
      const v = e.target.value === "" ? undefined : cmToMm(+e.target.value);
      const sizes = [...calForm.sizes]; sizes[i] = { ...s, maxHeight: v };
      setCalForm({ ...calForm, sizes });
    }}
    style={inputStyle} />
</label>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => setCalForm({
                      ...calForm,
                      sizes: [...calForm.sizes, { label: "New Band", minWeight: 0, maxWeight: 0, credits: 1 }],
                    })}
                    style={{ ...ghostBtn, flex: "unset", alignSelf: "flex-start", padding: "8px 16px", fontSize: 12 }}
                  >
                    + Add Band
                  </button>

                  <div style={{ height: 1, background: "var(--admin-border-strong)", margin: "8px 0" }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#f0a500", marginBottom: 4 }}>PRINT PRICING</div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted)", lineHeight: 1.5, marginBottom: 12 }}>
                      Print cost = number of pages × credits per page. These rates change print charges only; bottle credit rewards stay separate. Save here to update the total shown on the Print screen.
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                      {printPricingForm ? (
                        <>
                          <label style={calLabel}>Black-and-white (credits/page)
                            <input
                              type="number" min="1" max="1000000" step="1"
                              value={printPricingForm.bwCreditsPerPage}
                              onChange={e => setPrintPricingForm({ ...printPricingForm, bwCreditsPerPage: +e.target.value })}
                              style={inputStyle}
                              disabled={!isSuperAdmin}
                            />
                          </label>
                          <label style={calLabel}>Color (credits/page)
                            <input
                              type="number" min="1" max="1000000" step="1"
                              value={printPricingForm.colorCreditsPerPage}
                              onChange={e => setPrintPricingForm({ ...printPricingForm, colorCreditsPerPage: +e.target.value })}
                              style={inputStyle}
                              disabled={!isSuperAdmin}
                            />
                          </label>
                          {isSuperAdmin && (
                            <button
                              onClick={savePrintPricing}
                              disabled={printPricingSaving}
                              style={{ ...confirmBtn, flex: "0 0 auto", padding: "10px 20px", opacity: printPricingSaving ? 0.5 : 1 }}
                            >
                              {printPricingSaving ? "Saving..." : "Save Print Pricing"}
                            </button>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>Loading print rates...</div>
                      )}
                    </div>
                    {!isSuperAdmin && <div style={{ fontSize: 12, color: "#f0a500", marginTop: 8 }}>View only. Only a super-admin can change print rates.</div>}
                    {printPricingMsg && <div style={{ fontSize: 12, color: printPricingMsg.startsWith("Print pricing saved") ? "#2ecc71" : "#e74c3c", marginTop: 8 }}>{printPricingMsg}</div>}
                  </div>

                  {calMsg && <div style={{ fontSize: 12, color: calMsg.startsWith("Saved") ? "#2ecc71" : "#e74c3c" }}>{calMsg}</div>}

                  <button
                    disabled={calSaving}
                    onClick={async () => {
                      setCalSaving(true); setCalMsg("");
                      try {
                        const res = await authFetch(`/api/admin/sensors/config`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(calForm),
                        });
                        const data = await res.json();
                        if (res.ok && data.success) { setCalForm(data.config); setCalMsg("Saved calibration."); }
                        else setCalMsg(data.error ?? "Failed to save.");
                      } catch { setCalMsg("Could not reach backend."); }
                      setCalSaving(false);
                    }}
                    style={{ ...confirmBtn, alignSelf: "flex-start", padding: "10px 24px" }}
                  >
                    {calSaving ? "Saving..." : "Save Calibration"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
         {/* 6. MANAGE ADMINS TAB */}
        {!loading && tab === "admins" && isSuperAdmin && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="text"
                  placeholder="Search admins by username..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ ...inputStyle, maxWidth: 220, padding: "8px 12px", fontSize: 13 }}
                />
                <select
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                  style={{ ...inputStyle, maxWidth: 150, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}
                >
                  <option value="all">All Roles</option>
                  <option value="super_admin">Super-admin</option>
                  <option value="admin">Admin</option>
                </select>
                {(searchQuery || filterValue !== "all") && (
                  <button onClick={() => { setSearchQuery(""); setFilterValue("all"); }} style={actionBtn("#2a2a2a", "#aaa")}>Clear</button>
                )}
              </div>
              <button onClick={openCreateAdmin} style={{ ...actionBtn("#1a3a2a", "#2ecc71"), padding: "8px 16px", fontSize: 12 }}>
                + New Admin
              </button>
            </div>
            <div style={{ ...tableWrap, overflowY: "auto", flex: 1 }}>
              <table style={table}>
                <thead>
                  <tr>{["Username", "Gmail Notification", "Role", "Created", "Actions"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {admins.map(a => (
                      <tr key={a.id} style={{ borderBottom: "1px solid var(--admin-row-border)" }}>
                        <td style={td}>{a.username}</td>
                        <td style={{ ...td, color: a.email ? "#38bdf8" : "#666" }}>{a.email || "Not set"}</td>
                        <td style={td}>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, background: a.role === "super_admin" ? "#3a2a1a" : "#1e1e1e", color: a.role === "super_admin" ? "#f0a500" : "#aaa" }}>
                            {a.role}
                          </span>
                        </td>
                        <td style={{ ...td, fontSize: 11, color: "var(--admin-muted)" }}>{new Date(a.created_at).toLocaleDateString()}</td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => openEditAdmin(a)} style={actionBtn("#1a2a3a", "#3498db")}>Edit</button>
                            <button onClick={() => handleDeleteAdmin(a)} style={actionBtn("#3a1a1a", "#e74c3c")}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {admins.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--admin-muted)" }}>{hasFilter ? "No matching admins" : "No admins yet"}</td></tr>}
                </tbody>
              </table>
            </div>
            {admins.length >= limits.admins && (
  <button onClick={() => showMore("admins")} style={{ ...ghostBtn, flex: "unset", alignSelf: "center", padding: "8px 20px", fontSize: 12 }}>
    Show more
  </button>
)}
          </div>
        )}
      </div>  

      {/* Account Settings Modal */}
      {showAccountModal && (
        <div style={overlay}>
          <div style={{ ...modal, maxWidth: 400 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <AccountCircleIcon size={20} color="#f0a500" />
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--admin-text)" }}>Account Settings</span>
            </div>

            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
              textAlign: "left",
            }}>
              <span style={{ color: "var(--admin-text)", fontWeight: 700 }}>{myUsername}</span>
              <span style={{
                padding: "3px 9px",
                borderRadius: 999,
                background: "var(--admin-hover)",
                border: "1px solid var(--admin-border-strong)",
                color: "var(--admin-muted-strong)",
                fontSize: 11,
                fontWeight: 700,
              }}>
                {myRole === "super_admin" ? "Super-admin" : "Admin"}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Username</div>
                <input
                  value={settingsForm.username}
                  onChange={e => setSettingsForm({ ...settingsForm, username: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Gmail Address (for Password Recovery & Alerts)</div>
                <input
                  type="email"
                  value={settingsForm.email}
                  onChange={e => setSettingsForm({ ...settingsForm, email: e.target.value })}
                  placeholder="admin@gmail.com"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>New Password (optional)</div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showSettingsPass ? "text" : "password"}
                    value={settingsForm.newPassword}
                    onChange={e => setSettingsForm({ ...settingsForm, newPassword: e.target.value })}
                    placeholder="Leave blank to keep current"
                    style={{ ...inputStyle, paddingRight: 45 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSettingsPass(!showSettingsPass)}
                    style={{
                      position: "absolute", right: 12, top: "50%", transform: "translateY(-50% )",
                      background: "none", border: "none", color: "var(--admin-muted)", cursor: "pointer", fontSize: 13
                    }}
                  >
                    {showSettingsPass ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {settingsForm.newPassword && (
                <>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Current Password</div>
                    <input
                      type="password"
                      value={settingsForm.currentPassword}
                      onChange={e => setSettingsForm({ ...settingsForm, currentPassword: e.target.value })}
                      autoComplete="current-password"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Confirm New Password</div>
                    <input
                      type="password"
                      value={settingsForm.confirmPassword}
                      onChange={e => setSettingsForm({ ...settingsForm, confirmPassword: e.target.value })}
                      autoComplete="new-password"
                      style={inputStyle}
                    />
                  </div>
                </>
              )}
            </div>

            {settingsMsg && <div style={{ fontSize: 13, color: "#e74c3c", marginTop: 12 }}>{settingsMsg}</div>}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => {
                  setShowAccountModal(false);
                  setSettingsForm({ username: myUsername, email: myEmail, currentPassword: "", newPassword: "", confirmPassword: "" });
                  setSettingsMsg("");
                }}
                style={ghostBtn}
              >
                Cancel
              </button>
              <button onClick={handleSaveSettings} style={confirmBtn}>Save Profile</button>
            </div>
          </div>
        </div>
      )}

      {/* System Maintenance Modal */}
      {showMaintenanceModal && isSuperAdmin && (
        <div style={overlay}>
                    <div style={{ ...modal, maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <WrenchIcon size={20} color="#f0a500" />
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--admin-text)" }}>System Maintenance</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", lineHeight: 1.4 }}>
                Export encrypted database backups or restore system state from an existing backup file.
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={async () => {
                    try {
                      const res = await authFetch(`/api/admin/backup`);
                      const blob = await res.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `kiosk_secure_backup_${new Date().toISOString().slice(0, 10)}.json`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    } catch {
                      alert("Failed to download database backup.");
                    }
                  }}
                  style={{ ...confirmBtn, background: "var(--admin-hover)", color: "var(--kiosk-accent-text)", border: "1px solid var(--admin-border-strong)" }}
                >
                  Download Backup
                </button>
                <button
                  onClick={() => document.getElementById("restoreFileInput")?.click()}
                  style={{ ...confirmBtn, background: "var(--admin-hover)", color: "var(--admin-text)", border: "1px solid var(--admin-border-strong)" }}
                >
                  Restore Backup
                </button>
              </div>

              <div style={{ height: 1, background: "var(--admin-border)", margin: "8px 0 4px" }} />

              <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", lineHeight: 1.4 }}>
                Power control. Both are refused while a deposit is in progress. Shutting down leaves the
                kiosk off until someone physically reconnects power.
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handlePower("reboot")}
                  style={{ ...confirmBtn, background: "var(--admin-hover)", color: "var(--kiosk-accent-text)", border: "1px solid var(--admin-border-strong)" }}
                >
                  Reboot Pi
                </button>
                <button
                  onClick={() => handlePower("shutdown")}
                  style={{ ...confirmBtn, background: "#3a1a1a", color: "#e74c3c", border: "1px solid #5a2a2a" }}
                >
                  Shut Down Pi
                </button>
              </div>
            </div>

                                   <button onClick={backupToDrive} disabled={driveBusy} style={{ ...confirmBtn, background: "var(--admin-hover)", color: "var(--kiosk-accent-text)", border: "1px solid var(--admin-border-strong)", width: "100%", marginTop: 12, opacity: driveBusy ? 0.5 : 1 }}>
                                   {driveBusy ? "Uploading..." : "Back up to Drive now"}
                                    </button>
            <div style={{ fontSize: 11, marginTop: 6, textAlign: "left", color: driveStatus?.action === "DRIVE_BACKUP" ? "#2ecc71" : driveStatus ? "#e74c3c" : "#666" }}>
              {driveStatus
                ? (driveStatus.action === "DRIVE_BACKUP" ? "Last Drive backup: " : "Last attempt failed: ") + formatPhTime(driveStatus.created_at) + (driveStatus.action === "DRIVE_BACKUP" ? "" : " · " + driveStatus.details)
                : "No Drive backup yet."}
            </div>

                           <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--admin-muted-strong)", display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={backupEnabled} onChange={e => setBackupEnabled(e.target.checked)} style={{ accentColor: "#f0a500" }} />
                Automatic daily backup at
              </label>
              <input type="time" value={backupTime} onChange={e => setBackupTime(e.target.value)} disabled={!backupEnabled}
                style={{ ...inputStyle, width: 120, padding: "6px 8px", fontSize: 13, colorScheme: "dark", opacity: backupEnabled ? 1 : 0.5 }} />
              <button onClick={saveBackupSchedule} style={{ ...actionBtn("#1e293b", "#38bdf8"), padding: "8px 14px", fontSize: 12 }}>Save</button>
            </div>
            <div style={{ fontSize: 10, color: "var(--admin-muted)", marginTop: 4, textAlign: "left" }}>Manila time. A backup already made today counts, so a new time applies from tomorrow.</div>
                   
                            <button onClick={emailBackupNow} disabled={emailBusy} style={{ ...confirmBtn, background: "var(--admin-hover)", color: "var(--kiosk-accent-text)", border: "1px solid var(--admin-border-strong)", width: "100%", marginTop: 12, opacity: emailBusy ? 0.5 : 1 }}>
              {emailBusy ? "Sending..." : "Email backup now"}
            </button>
            <div style={{ fontSize: 11, marginTop: 6, textAlign: "left", color: emailStatus?.action === "EMAIL_BACKUP" ? "#2ecc71" : emailStatus ? "#e74c3c" : "#666" }}>
              {emailStatus
                ? (emailStatus.action === "EMAIL_BACKUP" ? "Last emailed backup: " : "Last attempt failed: ") + formatPhTime(emailStatus.created_at) + (emailStatus.action === "EMAIL_BACKUP" ? "" : " · " + emailStatus.details)
                : "No emailed backup yet."}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--admin-muted-strong)", display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={emailEnabled} onChange={e => setEmailEnabled(e.target.checked)} style={{ accentColor: "#f0a500" }} />
                Automatic daily email backup at
              </label>
              <input type="time" value={emailTime} onChange={e => setEmailTime(e.target.value)} disabled={!emailEnabled}
                style={{ ...inputStyle, width: 120, padding: "6px 8px", fontSize: 13, colorScheme: "dark", opacity: emailEnabled ? 1 : 0.5 }} />
              <button onClick={saveEmailSchedule} style={{ ...actionBtn("#1e293b", "#38bdf8"), padding: "8px 14px", fontSize: 12 }}>Save</button>
            </div>
            <div style={{ fontSize: 10, color: "var(--admin-muted)", marginTop: 4, textAlign: "left" }}>Manila time. Sent to every admin with a Gmail saved, plus the kiosk Gmail. A backup already made today counts, so a new time applies from tomorrow.</div>

            <div style={{ display: "flex", marginTop: 24 }}>
              <button onClick={() => setShowMaintenanceModal(false)} style={{ ...ghostBtn, width: "100%" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Account Modal */}
      {editUserModal && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ marginBottom: 12 }}><EditIcon size={36} color="#3498db" /></div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Edit User Account</div>
            <div style={{ fontSize: 13, color: "var(--admin-muted)", marginBottom: 20 }}>RFID: {editUserModal.rfid}</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Full Name</div>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Student ID</div>
                <input
                  value={editStudentId}
                  onChange={e => setEditStudentId(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--admin-border)", marginTop: 14, paddingTop: 12, textAlign: "left" }}>
              <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 6 }}>
                Credits · current balance: <strong style={{ color: "#f0a500" }}>{editUserModal.credits}</strong>
              </div>
                           {isSuperAdmin ? (
                             <>
                               <div style={{ display: "flex", gap: 8 }}>
                                 <input type="number" min={1} value={creditAmount} onChange={e => setCreditAmount(e.target.value)} placeholder="Amount" style={{ ...inputStyle, width: 100 }} />
                                 <input value={creditReason} onChange={e => setCreditReason(e.target.value)} placeholder="Reason *" required style={inputStyle} />
                               </div>
                               <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                 <button onClick={() => adjustCredits("add")} style={{ ...actionBtn("#1a3a2a", "#2ecc71"), flex: 1, padding: "8px" }}>+ Add</button>
                                 <button onClick={() => adjustCredits("remove")} style={{ ...actionBtn("#3a1a1a", "#e74c3c"), flex: 1, padding: "8px" }}>− Remove</button>
                               </div>
                             </>
                           ) : (
                             <div style={{ fontSize: 11, color: "var(--kiosk-accent-text)" }}>Only a super-admin can adjust credits.</div>
                           )}
                                         <button onClick={resetUserPin} style={{ ...actionBtn("#2a2a2a", "#f0a500"), width: "100%", padding: "8px", marginTop: 10 }}>
                Reset PIN (user sets a new one at the kiosk)
              </button>
              {creditMsg && <div style={{ fontSize: 12, marginTop: 6, color: creditMsg.startsWith("Done") ? "#2ecc71" : "#e74c3c" }}>{creditMsg}</div>}
            </div>
            {editMsg && <div style={{ fontSize: 13, color: editMsg.startsWith("Updated") ? "#2ecc71" : "#e74c3c", marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
              {editMsg.startsWith("Updated") ? <CheckCircleIcon size={15} color="#2ecc71" /> : <XCircleIcon size={15} color="#e74c3c" />} {editMsg}
            </div>}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditUserModal(null)} style={ghostBtn}>Cancel</button>
              <button
                onClick={async () => {
                  try {
                    const res = await authFetch(`/api/admin/user/${editUserModal.rfid}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: editName, studentId: editStudentId }),
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                      setEditUserModal(null);
                      fetchData();
                    } else {
                      setEditMsg(data.error ?? "Update failed.");
                    }
                  } catch {
                    setEditMsg("Network error.");
                  }
                }}
                style={confirmBtn}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shutdown / Reboot waiting screen */}
      {powerState && (
        <div style={{ ...overlay, background: "#1a1a1a", zIndex: 500, flexDirection: "column", gap: 14, textAlign: "center", padding: 24 }}>
          {powerState.action === "shutdown" ? (
            <>
              <WrenchIcon size={40} color="#f0a500" />
              <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>Shutting down the Pi…</div>
              {powerElapsed < SHUTDOWN_WAIT_SECONDS ? (
                <div style={{ fontSize: 15, color: "#f0a500" }}>
                  Please wait {SHUTDOWN_WAIT_SECONDS - powerElapsed}s. Do not unplug yet.
                </div>
              ) : (
                <div style={{ fontSize: 15, color: "#2ecc71", maxWidth: 440, lineHeight: 1.5 }}>
                  Check the Pi. Once the green light has stopped blinking, it is safe to unplug.
                </div>
              )}
              <div style={{ fontSize: 12, color: "var(--admin-muted)", maxWidth: 440, lineHeight: 1.5 }}>
                This page cannot confirm the shutdown finished, because the server stops before it can
                report back. The green light on the Pi is the real signal. The kiosk stays off until
                power is reconnected.
              </div>
            </>
          ) : rebootBackOnline ? (
            <>
              <CheckCircleIcon size={40} color="#2ecc71" />
              <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>The Pi is back online</div>
              <div style={{ fontSize: 13, color: "var(--admin-muted)" }}>All admin sessions were cleared by the reboot. Log in again to continue.</div>
              <button onClick={() => window.location.reload()} style={{ ...confirmBtn, flex: "unset", padding: "12px 28px", marginTop: 8 }}>
                Reload and log in
              </button>
            </>
          ) : (
            <>
              <WrenchIcon size={40} color="#f0a500" />
              <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>Rebooting the Pi…</div>
              <div style={{ fontSize: 15, color: "#f0a500" }}>
                Waiting for it to come back ({powerElapsed}s). This usually takes about a minute.
              </div>
            </>
          )}
        </div>
      )}

      {/* Create / Edit Admin Modal with Default Password Guide Notice */}
      {adminModal && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ marginBottom: 12 }}><KeyIcon size={36} color="#f0a500" /></div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              {adminModal.mode === "create" ? "New Admin Account" : `Edit "${adminModal.admin.username}"`}
            </div>

            {createdDefaultPassNotice ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
                <div style={{ background: "#1e3a2a", border: "1px solid #2ecc71", padding: 12, borderRadius: 8, color: "#2ecc71", fontSize: 13, lineHeight: 1.4 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CheckCircleIcon size={16} /> Admin account successfully created!</span>
                  <br/><br/>
                  Initial default password for first login: <strong>{createdDefaultPassNotice}</strong>
                  <br/><br/>
                  <span style={{ color: "var(--admin-muted)", fontSize: 11 }}>The new admin will be forced to update this password upon their first login.</span>
                </div>
                <button
                  onClick={() => { setAdminModal(null); fetchData(); }}
                  style={{ ...confirmBtn, marginTop: 8 }}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Username</div>
                    <input
                      value={adminForm.username}
                      onChange={e => setAdminForm({ ...adminForm, username: e.target.value })}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Gmail Address</div>
                    <input
                      type="email"
                      value={adminForm.email}
                      onChange={e => setAdminForm({ ...adminForm, email: e.target.value })}
                      placeholder="admin@gmail.com"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4 }}>Role</div>
                    <select
                      value={adminForm.role}
                      onChange={e => setAdminForm({ ...adminForm, role: e.target.value as Role })}
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="admin">Admin</option>
                      <option value="super_admin">Super-admin</option>
                    </select>
                  </div>

                  {adminModal.mode === "create" && (
                    <div style={{ background: "#2a2a1a", border: "1px solid #f0a500", padding: 10, borderRadius: 6, fontSize: 11, color: "#f0a500", lineHeight: 1.4 }}>
                      <InfoIcon size={15} style={{ verticalAlign: "middle", marginRight: 5 }} /> Newly created accounts are automatically assigned the default password: <strong>DefaultPass123!</strong>
                    </div>
                  )}
                </div>

                {adminMsg && <div style={{ fontSize: 13, color: "#e74c3c", marginTop: 12 }}>{adminMsg}</div>}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button onClick={() => setAdminModal(null)} style={ghostBtn}>Cancel</button>
                  <button onClick={handleSaveAdmin} style={confirmBtn}>
                    {adminModal.mode === "create" ? "Create" : "Save"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggleTheme }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "light"}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={onToggleTheme}
      style={{
        padding: "6px 12px", borderRadius: 8,
        border: "1px solid var(--admin-border-strong)",
        background: "var(--admin-surface)", color: "var(--admin-text)",
        fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {theme === "dark" ? "Dark mode" : "Light mode"}
    </button>
  );
}

const fullScreen: React.CSSProperties = {
  width: "100%", height: "100%", flex: 1, background: "var(--admin-bg)",
  display: "flex", flexDirection: "column", position: "relative",
  fontFamily: "'Inter', 'Segoe UI', sans-serif", overflow: "hidden",
  boxSizing: "border-box",
};
const headerBar: React.CSSProperties = {
  padding: "12px 24px", borderBottom: "1px solid var(--admin-border)",
  display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
};
const headerTitle: React.CSSProperties = { fontWeight: 700, fontSize: 15, color: "var(--admin-text)" };
const headerSub: React.CSSProperties = { fontSize: 11, color: "var(--admin-muted)" };
const tabBar: React.CSSProperties = { display: "flex", borderBottom: "1px solid var(--admin-border)", paddingLeft: 24, flexShrink: 0 };
const tabBtn: React.CSSProperties = {
  padding: "10px 20px", background: "none", border: "none",
  cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const body: React.CSSProperties = {
  flex: 1, overflow: "hidden", padding: "16px 24px",
  display: "flex", flexDirection: "column", boxSizing: "border-box",
};
const loginBody: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box",
};
const loginPanel: React.CSSProperties = {
  width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 28,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", background: "var(--admin-input)",
  border: "1px solid var(--admin-border-strong)", borderRadius: 8, color: "var(--admin-text)",
  fontSize: 15, outline: "none", boxSizing: "border-box",
};
const tableWrap: React.CSSProperties = {
  flex: 1, overflow: "auto", borderRadius: 10, border: "1px solid var(--admin-border-strong)", boxSizing: "border-box",
};
const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", color: "var(--admin-muted-strong)",
  fontSize: 12, fontWeight: 700, background: "var(--admin-input)",
  borderBottom: "1px solid var(--admin-border-strong)", position: "sticky", top: 0,
};
const td: React.CSSProperties = { padding: "10px 14px", color: "var(--admin-secondary)", verticalAlign: "middle" };
const actionBtn = (bg: string, color: string): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: "6px", border: "none",
  background: bg, color, fontSize: 11, cursor: "pointer", fontWeight: 600,
});
const refreshBtn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 8, background: "var(--admin-hover)",
  border: "1px solid var(--admin-border-strong)", color: "var(--admin-muted)", fontSize: 12, cursor: "pointer",
};
const dropdownMenu: React.CSSProperties = {
  position: "absolute", top: "calc(100% + 6px)", right: 0, width: 200,
  background: "var(--admin-surface)", border: "1px solid var(--admin-border-strong)", borderRadius: 10,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 1000,
  display: "flex", flexDirection: "column", padding: "6px",
};
const dropdownItem: React.CSSProperties = {
  padding: "10px 12px", background: "transparent", border: "none",
  borderRadius: 6, color: "var(--admin-secondary)", fontSize: 13, textAlign: "left",
  cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
};
const overlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
};
const modal: React.CSSProperties = {
  background: "var(--admin-surface)", border: "1px solid var(--admin-border-strong)", borderRadius: 16,
  padding: "32px 36px", textAlign: "center", maxWidth: 340, width: "100%", boxSizing: "border-box",
};
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 600, fontSize: 14, background: "transparent", color: "var(--admin-muted)", border: "1px solid var(--admin-border-strong)", cursor: "pointer",
};
const confirmBtn: React.CSSProperties = {
  flex: 1, padding: "11px", borderRadius: 8, fontWeight: 700, fontSize: 14, background: "#f0a500", color: "#000", border: "none", cursor: "pointer",
};
const adminStatCard: React.CSSProperties = {
  background: "var(--admin-surface)", border: "1px solid var(--admin-border-strong)", borderRadius: 12,
  padding: "14px 18px", boxSizing: "border-box",
};
const adminStatLabel: React.CSSProperties = { fontSize: 12, color: "var(--admin-muted-strong)", marginBottom: 4, fontWeight: 700, textTransform: "uppercase" };
const adminStatVal: React.CSSProperties = { fontSize: 24, fontWeight: 800, color: "var(--admin-text)" };
const calLabel: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--admin-muted-strong)", fontWeight: 600,
};
const badgeStyle: React.CSSProperties = {
  minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
  background: "#e74c3c", color: "#fff", fontSize: 10, fontWeight: 700,
  display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
};