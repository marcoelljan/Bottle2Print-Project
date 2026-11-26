import type Database from "better-sqlite3";
import { getSystemConfig, type SystemConfig } from "./systemConfig";

export type AnalyticsRange = 7 | 30 | 90;

export interface DailyAnalyticsPoint {
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

export interface AnalyticsTotals {
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

export interface PeriodComparison {
  bottlesAccepted: number | null;
  plasticWeightKg: number | null;
  co2SavedG: number | null;
  rejectedBottles: number | null;
  creditsIssued: number | null;
  submittedPrints: number | null;
  confirmedPrints: number | null;
  printCreditsSpent: number | null;
}

export interface CardGuestSplit {
  card: AnalyticsTotals;
  guest: AnalyticsTotals;
}

export interface BusiestHourInfo {
  hour: number;
  label: string;
  count: number;
}

export interface BinHistoryPoint {
  date: string;
  avgFillPercent: number;
  maxFillPercent: number;
  latestFillPercent: number;
}

export interface HourlyAnalyticsPoint {
  hour: string;
  bottlesAccepted: number;
  co2SavedG: number;
  confirmedPrints: number;
  submittedPrints: number;
}

export interface MonthlyAnalyticsPoint {
  month: string;
  bottlesAccepted: number;
  co2SavedG: number;
  confirmedPrints: number;
  submittedPrints: number;
}

export interface ForecastPoint {
  date: string;
  bottles: number;
  co2SavedG: number;
  confirmedPrints: number;
}

export type AnalyticsForecast =
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

export interface AdminAnalyticsPayload {
  range: AnalyticsRange;
  timezone: "Asia/Manila";
  startDate: string;
  endDate: string;
  totals: AnalyticsTotals;
  previousTotals: AnalyticsTotals;
  percentChange: PeriodComparison;
  cardVsGuest: CardGuestSplit;
  busiestHour: BusiestHourInfo | null;
  dailySeries: DailyAnalyticsPoint[];
  todayHourly: HourlyAnalyticsPoint[];
  yearlyMonthly: MonthlyAnalyticsPoint[];
  binFillPercent: number | null;
  binHistory: BinHistoryPoint[];
  forecast: AnalyticsForecast;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BIN_FILL_PCT_PER_BOTTLE = 2; // Fallback (~50 bottles) when only current fill % is available

const round1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function parseAnalyticsRange(value: unknown): AnalyticsRange {
  const num = Number(value);
  if (num === 7 || num === 30 || num === 90) return num;
  return 30;
}

function manilaDateParts(now: Date) {
  const shifted = new Date(now.getTime() + MANILA_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const dayStartMs = Date.UTC(year, month, day);
  return { year, month, day, dayStartMs };
}

function formatDateFromManilaMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function emptyTotals(): AnalyticsTotals {
  return {
    bottlesAccepted: 0,
    plasticWeightKg: 0,
    co2SavedG: 0,
    rejectedBottles: 0,
    creditsIssued: 0,
    submittedPrints: 0,
    refundedPrints: 0,
    confirmedPrints: 0,
    printCreditsSpent: 0,
  };
}

interface RawDailyRow {
  manila_date: string;
  bottles_accepted: number;
  weight_g: number;
  co2_saved_g: number;
  rejected_bottles: number;
  credits_issued: number;
  submitted_prints: number;
  refunded_prints: number;
  print_credits: number;
  refunded_credits: number;
}

function queryDailyAggregates(
  db: Database.Database,
  startDate: string,
  endDate: string,
  config: SystemConfig,
  guestFilter?: "card" | "guest"
): RawDailyRow[] {
  const guestClause =
    guestFilter === "guest"
      ? "AND rfid = 'GUEST'"
      : guestFilter === "card"
        ? "AND rfid != 'GUEST'"
        : "";

  return db
    .prepare(
      `
      SELECT
        date(created_at, '+8 hours') AS manila_date,
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS bottles_accepted,
        SUM(CASE WHEN type = 'deposit' THEN
          CASE WHEN upper(trim(COALESCE(size, ''))) IN ('XL', '1.5L', '1.5 L')
            THEN ? ELSE ? END
          ELSE 0 END) AS weight_g,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(co2_saved_g, 0) ELSE 0 END) AS co2_saved_g,
        SUM(CASE WHEN type = 'reject' THEN 1 ELSE 0 END) AS rejected_bottles,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(credits, 0) ELSE 0 END) AS credits_issued,
        SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) AS submitted_prints,
        SUM(CASE WHEN type = 'adjust' AND size LIKE 'Print refunded%' THEN 1 ELSE 0 END) AS refunded_prints,
        SUM(CASE WHEN type = 'print' THEN ABS(COALESCE(credits, 0)) ELSE 0 END) AS print_credits,
        SUM(CASE WHEN type = 'adjust' AND size LIKE 'Print refunded%' THEN ABS(COALESCE(credits, 0)) ELSE 0 END) AS refunded_credits
      FROM transactions
      WHERE date(created_at, '+8 hours') >= ?
        AND date(created_at, '+8 hours') <= ?
        AND type IN ('deposit', 'reject', 'print', 'adjust')
        ${guestClause}
      GROUP BY manila_date
      ORDER BY manila_date
      `
    )
    .all(config.bottleWeightG1_5L, config.bottleWeightGSmall, startDate, endDate) as RawDailyRow[];
}

function buildZeroFilledSeries(
  rows: RawDailyRow[],
  startManilaMs: number,
  days: number
): DailyAnalyticsPoint[] {
  const byDate = new Map(rows.map(row => [row.manila_date, row]));
  const series: DailyAnalyticsPoint[] = [];

  for (let i = 0; i < days; i++) {
    const date = formatDateFromManilaMs(startManilaMs + i * DAY_MS);
    const row = byDate.get(date);
    const submittedPrints = row?.submitted_prints ?? 0;
    const refundedPrints = row?.refunded_prints ?? 0;
    const printCredits = row?.print_credits ?? 0;
    const refundedCredits = row?.refunded_credits ?? 0;

    series.push({
      date,
      bottlesAccepted: row?.bottles_accepted ?? 0,
      plasticWeightKg: round2((row?.weight_g ?? 0) / 1000),
      co2SavedG: round1(row?.co2_saved_g ?? 0),
      rejectedBottles: row?.rejected_bottles ?? 0,
      creditsIssued: row?.credits_issued ?? 0,
      submittedPrints,
      refundedPrints,
      confirmedPrints: Math.max(0, submittedPrints - refundedPrints),
      printCreditsSpent: Math.max(0, printCredits - refundedCredits),
    });
  }

  return series;
}

function sumSeries(series: DailyAnalyticsPoint[]): AnalyticsTotals {
  const acc = emptyTotals();
  for (const day of series) {
    acc.bottlesAccepted += day.bottlesAccepted;
    acc.plasticWeightKg += day.plasticWeightKg;
    acc.co2SavedG += day.co2SavedG;
    acc.rejectedBottles += day.rejectedBottles;
    acc.creditsIssued += day.creditsIssued;
    acc.submittedPrints += day.submittedPrints;
    acc.refundedPrints += day.refundedPrints;
    acc.printCreditsSpent += day.printCreditsSpent;
  }
  acc.confirmedPrints = Math.max(0, acc.submittedPrints - acc.refundedPrints);
  acc.plasticWeightKg = round2(acc.plasticWeightKg);
  acc.co2SavedG = round1(acc.co2SavedG);
  return acc;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (values[i] - meanY);
    den += dx * dx;
  }
  const slope = den > 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function projectBlendedSeries(values: number[], horizonDays: number): number[] {
  const n = values.length;
  const tail = values.slice(-7);
  const movingAvg7 = tail.length > 0 ? tail.reduce((s, v) => s + v, 0) / tail.length : 0;
  const { slope, intercept } = linearRegression(values);

  return Array.from({ length: horizonDays }, (_, i) => {
    const trendVal = Math.max(0, intercept + slope * (n + i));
    return Math.max(0, 0.5 * movingAvg7 + 0.5 * trendVal);
  });
}

function hasBinHistoryTable(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'bin_history'")
    .get() as { ok: number } | undefined;
  return Boolean(row?.ok);
}

function queryBinHistory(
  db: Database.Database,
  startDate: string,
  endDate: string
): { history: BinHistoryPoint[]; latestFillPercent: number | null; observedPctPerBottle: number | null } {
  if (!hasBinHistoryTable(db)) {
    return { history: [], latestFillPercent: null, observedPctPerBottle: null };
  }

  const rows = db
    .prepare(
      `
      SELECT
        date(created_at, '+8 hours') AS manila_date,
        AVG(fill_percent) AS avg_fill,
        MAX(fill_percent) AS max_fill
      FROM bin_history
      WHERE date(created_at, '+8 hours') >= ?
        AND date(created_at, '+8 hours') <= ?
      GROUP BY manila_date
      ORDER BY manila_date
      `
    )
    .all(startDate, endDate) as Array<{ manila_date: string; avg_fill: number; max_fill: number }>;

  const latestByDayRows = db
    .prepare(
      `
      SELECT
        date(created_at, '+8 hours') AS manila_date,
        fill_percent
      FROM bin_history
      WHERE date(created_at, '+8 hours') >= ?
        AND date(created_at, '+8 hours') <= ?
      ORDER BY created_at ASC, id ASC
      `
    )
    .all(startDate, endDate) as Array<{ manila_date: string; fill_percent: number }>;

  const latestMap = new Map<string, number>();
  for (const r of latestByDayRows) {
    latestMap.set(r.manila_date, r.fill_percent);
  }

  const history: BinHistoryPoint[] = rows.map(r => ({
    date: r.manila_date,
    avgFillPercent: round1(r.avg_fill),
    maxFillPercent: Math.round(r.max_fill),
    latestFillPercent: latestMap.get(r.manila_date) ?? Math.round(r.max_fill),
  }));

  const latestRow = db
    .prepare("SELECT fill_percent FROM bin_history ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as { fill_percent: number } | undefined;

  let observedPctPerBottle: number | null = null;
  if (latestByDayRows.length >= 2) {
    const first = latestByDayRows[0];
    const last = latestByDayRows[latestByDayRows.length - 1];
    let totalGain = 0;
    for (let i = 1; i < latestByDayRows.length; i++) {
      const delta = latestByDayRows[i].fill_percent - latestByDayRows[i - 1].fill_percent;
      if (delta > 0) totalGain += delta;
    }
    const bottlesRow = db
      .prepare(
        `
        SELECT COUNT(*) AS n
        FROM transactions
        WHERE type = 'deposit'
          AND date(created_at, '+8 hours') >= ?
          AND date(created_at, '+8 hours') <= ?
        `
      )
      .get(first.manila_date, last.manila_date) as { n: number };
    if (totalGain > 0 && bottlesRow.n > 0) {
      observedPctPerBottle = Math.min(20, Math.max(0.2, totalGain / bottlesRow.n));
    }
  }

  return {
    history,
    latestFillPercent: latestRow ? latestRow.fill_percent : null,
    observedPctPerBottle,
  };
}

export function computeAdminAnalytics(
  db: Database.Database,
  options: {
    range?: unknown;
    currentBinFillPercent?: number | null;
    now?: Date;
  } = {}
): AdminAnalyticsPayload {
  const range = parseAnalyticsRange(options.range);
  const now = options.now ?? new Date();
  const config = getSystemConfig(db);
  const { year, dayStartMs } = manilaDateParts(now);

  const startMs = dayStartMs - (range - 1) * DAY_MS;
  const prevStartMs = startMs - range * DAY_MS;
  const prevEndMs = startMs - DAY_MS;

  const startDate = formatDateFromManilaMs(startMs);
  const endDate = formatDateFromManilaMs(dayStartMs);
  const prevStartDate = formatDateFromManilaMs(prevStartMs);
  const prevEndDate = formatDateFromManilaMs(prevEndMs);

  // Current range daily series (zero-filled)
  const currentRows = queryDailyAggregates(db, startDate, endDate, config);
  const dailySeries = buildZeroFilledSeries(currentRows, startMs, range);
  const totals = sumSeries(dailySeries);

  // Previous range totals for % comparison
  const prevRows = queryDailyAggregates(db, prevStartDate, prevEndDate, config);
  const prevSeries = buildZeroFilledSeries(prevRows, prevStartMs, range);
  const previousTotals = sumSeries(prevSeries);

  const percentChange: PeriodComparison = {
    bottlesAccepted: pctChange(totals.bottlesAccepted, previousTotals.bottlesAccepted),
    plasticWeightKg: pctChange(totals.plasticWeightKg, previousTotals.plasticWeightKg),
    co2SavedG: pctChange(totals.co2SavedG, previousTotals.co2SavedG),
    rejectedBottles: pctChange(totals.rejectedBottles, previousTotals.rejectedBottles),
    creditsIssued: pctChange(totals.creditsIssued, previousTotals.creditsIssued),
    submittedPrints: pctChange(totals.submittedPrints, previousTotals.submittedPrints),
    confirmedPrints: pctChange(totals.confirmedPrints, previousTotals.confirmedPrints),
    printCreditsSpent: pctChange(totals.printCreditsSpent, previousTotals.printCreditsSpent),
  };

  // Card vs Guest split across the selected range
  const cardRows = queryDailyAggregates(db, startDate, endDate, config, "card");
  const guestRows = queryDailyAggregates(db, startDate, endDate, config, "guest");
  const cardVsGuest: CardGuestSplit = {
    card: sumSeries(buildZeroFilledSeries(cardRows, startMs, range)),
    guest: sumSeries(buildZeroFilledSeries(guestRows, startMs, range)),
  };

  // Busiest hour of day (Manila time)
  const hourRow = db
    .prepare(
      `
      SELECT
        CAST(strftime('%H', created_at, '+8 hours') AS INTEGER) AS hr,
        COUNT(*) AS n
      FROM transactions
      WHERE date(created_at, '+8 hours') >= ?
        AND date(created_at, '+8 hours') <= ?
        AND type IN ('deposit', 'print')
      GROUP BY hr
      ORDER BY n DESC, hr ASC
      LIMIT 1
      `
    )
    .get(startDate, endDate) as { hr: number; n: number } | undefined;

  const busiestHour: BusiestHourInfo | null = hourRow
    ? {
        hour: hourRow.hr,
        label: `${String(hourRow.hr).padStart(2, "0")}:00–${String((hourRow.hr + 1) % 24).padStart(2, "0")}:00`,
        count: hourRow.n,
      }
    : null;

  // Today hourly breakdown (for Daily view)
  const hourlyRows = db
    .prepare(
      `
      SELECT
        CAST(strftime('%H', created_at, '+8 hours') AS INTEGER) AS hr,
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS bottles_accepted,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(co2_saved_g, 0) ELSE 0 END) AS co2_saved_g,
        SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) AS submitted_prints,
        SUM(CASE WHEN type = 'adjust' AND size LIKE 'Print refunded%' THEN 1 ELSE 0 END) AS refunded_prints
      FROM transactions
      WHERE date(created_at, '+8 hours') = ?
        AND type IN ('deposit', 'print', 'adjust')
      GROUP BY hr
      ORDER BY hr
      `
    )
    .all(endDate) as Array<{
      hr: number;
      bottles_accepted: number;
      co2_saved_g: number;
      submitted_prints: number;
      refunded_prints: number;
    }>;
  const hourlyMap = new Map(hourlyRows.map(r => [r.hr, r]));
  const todayHourly: HourlyAnalyticsPoint[] = Array.from({ length: 24 }, (_, hr) => {
    const r = hourlyMap.get(hr);
    const submitted = r?.submitted_prints ?? 0;
    const refunded = r?.refunded_prints ?? 0;
    return {
      hour: `${String(hr).padStart(2, "0")}:00`,
      bottlesAccepted: r?.bottles_accepted ?? 0,
      co2SavedG: round1(r?.co2_saved_g ?? 0),
      submittedPrints: submitted,
      confirmedPrints: Math.max(0, submitted - refunded),
    };
  });

  // Current Manila year monthly breakdown (for Yearly view)
  const yearStartDate = `${year}-01-01`;
  const yearEndDate = `${year}-12-31`;
  const monthlyRows = db
    .prepare(
      `
      SELECT
        strftime('%Y-%m', created_at, '+8 hours') AS ym,
        SUM(CASE WHEN type = 'deposit' THEN 1 ELSE 0 END) AS bottles_accepted,
        SUM(CASE WHEN type = 'deposit' THEN COALESCE(co2_saved_g, 0) ELSE 0 END) AS co2_saved_g,
        SUM(CASE WHEN type = 'print' THEN 1 ELSE 0 END) AS submitted_prints,
        SUM(CASE WHEN type = 'adjust' AND size LIKE 'Print refunded%' THEN 1 ELSE 0 END) AS refunded_prints
      FROM transactions
      WHERE date(created_at, '+8 hours') >= ?
        AND date(created_at, '+8 hours') <= ?
        AND type IN ('deposit', 'print', 'adjust')
      GROUP BY ym
      ORDER BY ym
      `
    )
    .all(yearStartDate, yearEndDate) as Array<{
      ym: string;
      bottles_accepted: number;
      co2_saved_g: number;
      submitted_prints: number;
      refunded_prints: number;
    }>;
  const monthlyMap = new Map(monthlyRows.map(r => [r.ym, r]));
  const yearlyMonthly: MonthlyAnalyticsPoint[] = Array.from({ length: 12 }, (_, idx) => {
    const ym = `${year}-${String(idx + 1).padStart(2, "0")}`;
    const r = monthlyMap.get(ym);
    const submitted = r?.submitted_prints ?? 0;
    const refunded = r?.refunded_prints ?? 0;
    return {
      month: ym,
      bottlesAccepted: r?.bottles_accepted ?? 0,
      co2SavedG: round1(r?.co2_saved_g ?? 0),
      submittedPrints: submitted,
      confirmedPrints: Math.max(0, submitted - refunded),
    };
  });

  // Bin history & live fill %
  const binData = queryBinHistory(db, startDate, endDate);
  const binFillPercent =
    options.currentBinFillPercent !== undefined && options.currentBinFillPercent !== null
      ? options.currentBinFillPercent
      : binData.latestFillPercent;

  // Forecast computed from the daily series (never stored).
  // Use at least 30 days of daily series so switching Actual range to 7 days still supports the 14-day requirement.
  const forecastLookbackDays = Math.max(range, 30);
  const forecastStartMs = dayStartMs - (forecastLookbackDays - 1) * DAY_MS;
  const forecastStartDate = formatDateFromManilaMs(forecastStartMs);
  const forecastSeries =
    forecastLookbackDays === range
      ? dailySeries
      : buildZeroFilledSeries(queryDailyAggregates(db, forecastStartDate, endDate, config), forecastStartMs, forecastLookbackDays);

  const activeDaysRow = db
    .prepare(
      `
      SELECT COUNT(DISTINCT date(created_at, '+8 hours')) AS n
      FROM transactions
      WHERE date(created_at, '+8 hours') >= ?
        AND date(created_at, '+8 hours') <= ?
        AND type = 'deposit'
      `
    )
    .get(forecastStartDate, endDate) as { n: number };
  const activeDays = activeDaysRow.n ?? 0;

  let forecast: AnalyticsForecast;
  if (activeDays < 14) {
    forecast = {
      ready: false,
      reason: "Needs at least 14 days of data",
      activeDays,
    };
  } else {
    const bottlesDaily = projectBlendedSeries(
      forecastSeries.map(d => d.bottlesAccepted),
      30
    );
    const co2Daily = projectBlendedSeries(
      forecastSeries.map(d => d.co2SavedG),
      30
    );
    const printsDaily = projectBlendedSeries(
      forecastSeries.map(d => d.confirmedPrints),
      30
    );

    const projectedSeries: ForecastPoint[] = Array.from({ length: 30 }, (_, idx) => ({
      date: formatDateFromManilaMs(dayStartMs + (idx + 1) * DAY_MS),
      bottles: round1(bottlesDaily[idx]),
      co2SavedG: round1(co2Daily[idx]),
      confirmedPrints: round1(printsDaily[idx]),
    }));

    const rangeWeightG = currentRows.reduce((s, r) => s + (r.weight_g ?? 0), 0);
    let avgGramsPerBottle = 0;
    if (totals.bottlesAccepted > 0 && rangeWeightG > 0) {
      avgGramsPerBottle = rangeWeightG / totals.bottlesAccepted;
    } else {
      const allTimeDeposit = db
        .prepare(
          `
          SELECT
            COUNT(*) AS bottles,
              SUM(CASE WHEN upper(trim(COALESCE(size, ''))) IN ('XL', '1.5L', '1.5 L')
                THEN ? ELSE ? END) AS weight_g
            FROM transactions
            WHERE type = 'deposit'
          `
          )
          .get(config.bottleWeightG1_5L, config.bottleWeightGSmall) as { bottles: number; weight_g: number | null };
      if ((allTimeDeposit.bottles ?? 0) > 0 && (allTimeDeposit.weight_g ?? 0) > 0) {
        avgGramsPerBottle = (allTimeDeposit.weight_g ?? 0) / allTimeDeposit.bottles;
      }
    }

    const sumHorizon = (days: number) => {
      const bottles = Math.round(projectedSeries.slice(0, days).reduce((s, p) => s + p.bottles, 0));
      return {
        bottles,
        plasticWeightKg: round2((bottles * avgGramsPerBottle) / 1000),
        co2SavedG: round1(projectedSeries.slice(0, days).reduce((s, p) => s + p.co2SavedG, 0)),
        confirmedPrints: Math.round(projectedSeries.slice(0, days).reduce((s, p) => s + p.confirmedPrints, 0)),
      };
    };

    const forecastTotalBottles = forecastSeries.reduce((s, d) => s + d.bottlesAccepted, 0);
    const avgBottlesPerDay = round2(forecastTotalBottles / forecastLookbackDays);

    let binProjection: { estimatedBinFullDate: string; daysUntilBinFull: number } | null = null;
    if (binFillPercent !== null && avgBottlesPerDay > 0) {
      if (binFillPercent >= 100) {
        binProjection = {
          estimatedBinFullDate: endDate,
          daysUntilBinFull: 0,
        };
      } else {
        const pctPerBottle = binData.observedPctPerBottle ?? DEFAULT_BIN_FILL_PCT_PER_BOTTLE;
        const pctPerDay = avgBottlesPerDay * pctPerBottle;
        if (pctPerDay > 0) {
          const daysUntilBinFull = Math.max(1, Math.ceil((100 - binFillPercent) / pctPerDay));
          binProjection = {
            estimatedBinFullDate: formatDateFromManilaMs(dayStartMs + daysUntilBinFull * DAY_MS),
            daysUntilBinFull,
          };
        }
      }
    }

    forecast = {
      ready: true,
      activeDays,
      method: "7-day moving average blended with linear regression trend",
      avgBottlesPerDay,
      avgGramsPerBottle: round2(avgGramsPerBottle),
      next7Days: sumHorizon(7),
      next30Days: sumHorizon(30),
      ...(binProjection ?? {}),
      projectedSeries,
    };
  }

  return {
    range,
    timezone: "Asia/Manila",
    startDate,
    endDate,
    totals,
    previousTotals,
    percentChange,
    cardVsGuest,
    busiestHour,
    dailySeries,
    todayHourly,
    yearlyMonthly,
    binFillPercent,
    binHistory: binData.history,
    forecast,
  };
}
