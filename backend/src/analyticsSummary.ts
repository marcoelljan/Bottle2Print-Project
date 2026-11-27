import type Database from "better-sqlite3";
import { getSystemConfig, type SystemConfig } from "./systemConfig";

export type AnalyticsSummaryRange = "today" | "date" | "1d" | "7d" | "14d" | "30d" | "90d";
export type AnalyticsSummarySeries = "hourly" | "daily" | "yearly";

interface DepositAggregate {
  bottles_1_5l: number;
  bottles_small: number;
  co2_saved_g: number;
}

interface PrintAggregate {
  prints_ok: number;
  prints_refunded: number;
  credits_spent: number;
  ink_cost: number;
  pages_bw: number;
  pages_color: number;
}

interface BucketRow extends DepositAggregate, PrintAggregate {
  bucket: string;
}

export interface AnalyticsSummaryMetrics {
  bottles: number;
  bottles1_5L: number;
  bottlesSmall: number;
  kg: number;
  co2SavedG: number;
  printsOk: number;
  printsRefunded: number;
  creditsSpent: number;
  inkCost: number;
  pagesBw: number;
  pagesColor: number;
  resaleIncome: number;
  netValue: number;
  bottlesNeededFor1Peso: { "1.5L": number; small: number };
  bottlesToCoverInk: { "1.5L": number; small: number };
}

export interface AnalyticsSummaryBucket extends AnalyticsSummaryMetrics {
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const round1 = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;

function manilaDate(now: Date): string {
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function dateOffset(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function parseRange(value: unknown): AnalyticsSummaryRange {
  if (
    value === "today" || value === "date" || value === "1d" || value === "7d" ||
    value === "14d" || value === "30d" || value === "90d"
  ) return value;
  return "30d";
}

function parseSelectedDate(value: unknown, todayDate: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("A valid date in YYYY-MM-DD format is required.");
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000) throw new Error("The selected date is not a valid calendar date.");
  const normalized = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  if (normalized !== value) throw new Error("The selected date is not a valid calendar date.");
  if (value > todayDate) throw new Error("A future date cannot be selected.");
  return value;
}

function parseSeries(value: unknown): AnalyticsSummarySeries {
  if (value === "hourly" || value === "daily" || value === "yearly") return value;
  return "daily";
}

function getBucketExpression(series: AnalyticsSummarySeries): string {
  if (series === "hourly") return "strftime('%H', created_at, '+8 hours')";
  if (series === "yearly") return "strftime('%Y-%m', created_at, '+8 hours')";
  return "date(created_at, '+8 hours')";
}

function getDepositAggregate(db: Database.Database, startDate: string, endDate: string): DepositAggregate {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN type = 'deposit' AND upper(trim(COALESCE(size, ''))) IN ('XL', '1.5L', '1.5 L') THEN 1
        ELSE 0
      END), 0) AS bottles_1_5l,
      COALESCE(SUM(CASE
        WHEN type = 'deposit' AND upper(trim(COALESCE(size, ''))) NOT IN ('XL', '1.5L', '1.5 L') THEN 1
        ELSE 0
      END), 0) AS bottles_small,
      COALESCE(SUM(CASE WHEN type = 'deposit' THEN COALESCE(co2_saved_g, 0) ELSE 0 END), 0) AS co2_saved_g
    FROM transactions
    WHERE type = 'deposit'
      AND created_at >= datetime(?, '-8 hours')
      AND created_at < datetime(?, '+1 day', '-8 hours')
  `).get(startDate, endDate) as DepositAggregate;
}

function getPrintAggregate(db: Database.Database, startDate: string, endDate: string, config: SystemConfig): PrintAggregate {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS prints_ok,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS prints_refunded,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN credits_charged ELSE 0 END), 0) AS credits_spent,
      COALESCE(SUM(CASE WHEN status = 'completed'
        THEN pages * coverage_factor * CASE WHEN color_mode = 'color' THEN ? ELSE ? END
        ELSE 0 END), 0) AS ink_cost,
      COALESCE(SUM(CASE WHEN status = 'completed' AND color_mode = 'bw' THEN pages ELSE 0 END), 0) AS pages_bw,
      COALESCE(SUM(CASE WHEN status = 'completed' AND color_mode = 'color' THEN pages ELSE 0 END), 0) AS pages_color
    FROM (
      SELECT status, credits_charged, pages, color_mode, coverage_factor, created_at FROM print_logs
      UNION ALL
      SELECT status, credits_charged, pages, color_mode, coverage_factor, created_at FROM guest_print_logs
    ) jobs
    WHERE created_at >= datetime(?, '-8 hours')
      AND created_at < datetime(?, '+1 day', '-8 hours')
  `).get(config.inkCostColorPerPage, config.inkCostBwPerPage, startDate, endDate) as PrintAggregate;
}

function getBucketRows(
  db: Database.Database,
  startDate: string,
  endDate: string,
  series: AnalyticsSummarySeries,
  config: SystemConfig
): BucketRow[] {
  const depositBucket = getBucketExpression(series);
  const printBucket = getBucketExpression(series);
  return db.prepare(`
    WITH deposits AS (
      SELECT
        ${depositBucket} AS bucket,
        SUM(CASE WHEN upper(trim(COALESCE(size, ''))) IN ('XL', '1.5L', '1.5 L') THEN 1 ELSE 0 END) AS bottles_1_5l,
        SUM(CASE WHEN upper(trim(COALESCE(size, ''))) NOT IN ('XL', '1.5L', '1.5 L') THEN 1 ELSE 0 END) AS bottles_small,
        SUM(COALESCE(co2_saved_g, 0)) AS co2_saved_g
      FROM transactions
      WHERE type = 'deposit'
        AND created_at >= datetime(?, '-8 hours')
        AND created_at < datetime(?, '+1 day', '-8 hours')
      GROUP BY bucket
    ),
    jobs AS (
      SELECT
        ${printBucket} AS bucket,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS prints_ok,
        SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS prints_refunded,
        SUM(CASE WHEN status = 'completed' THEN credits_charged ELSE 0 END) AS credits_spent,
        SUM(CASE WHEN status = 'completed'
          THEN pages * coverage_factor * CASE WHEN color_mode = 'color' THEN ? ELSE ? END
          ELSE 0 END) AS ink_cost,
        SUM(CASE WHEN status = 'completed' AND color_mode = 'bw' THEN pages ELSE 0 END) AS pages_bw,
        SUM(CASE WHEN status = 'completed' AND color_mode = 'color' THEN pages ELSE 0 END) AS pages_color
      FROM (
        SELECT status, credits_charged, pages, color_mode, coverage_factor, created_at FROM print_logs
        UNION ALL
        SELECT status, credits_charged, pages, color_mode, coverage_factor, created_at FROM guest_print_logs
      ) all_jobs
      WHERE created_at >= datetime(?, '-8 hours')
        AND created_at < datetime(?, '+1 day', '-8 hours')
      GROUP BY bucket
    )
    SELECT
      COALESCE(deposits.bucket, jobs.bucket) AS bucket,
      COALESCE(deposits.bottles_1_5l, 0) AS bottles_1_5l,
      COALESCE(deposits.bottles_small, 0) AS bottles_small,
      COALESCE(deposits.co2_saved_g, 0) AS co2_saved_g,
      COALESCE(jobs.prints_ok, 0) AS prints_ok,
      COALESCE(jobs.prints_refunded, 0) AS prints_refunded,
      COALESCE(jobs.credits_spent, 0) AS credits_spent,
      COALESCE(jobs.ink_cost, 0) AS ink_cost,
      COALESCE(jobs.pages_bw, 0) AS pages_bw,
      COALESCE(jobs.pages_color, 0) AS pages_color
    FROM deposits
    LEFT JOIN jobs ON jobs.bucket = deposits.bucket
    UNION ALL
    SELECT
      jobs.bucket, 0, 0, 0, jobs.prints_ok, jobs.prints_refunded,
      jobs.credits_spent, jobs.ink_cost, jobs.pages_bw, jobs.pages_color
    FROM jobs
    LEFT JOIN deposits ON deposits.bucket = jobs.bucket
    WHERE deposits.bucket IS NULL
    ORDER BY bucket
  `).all(startDate, endDate, config.inkCostColorPerPage, config.inkCostBwPerPage, startDate, endDate) as BucketRow[];
}

function calculateMetrics(
  deposits: DepositAggregate,
  prints: PrintAggregate,
  config: SystemConfig,
  resalePricePerKg: number
): AnalyticsSummaryMetrics {
  const bottles1_5L = Number(deposits.bottles_1_5l ?? 0);
  const bottlesSmall = Number(deposits.bottles_small ?? 0);
  const rawKg = (bottles1_5L * config.bottleWeightG1_5L + bottlesSmall * config.bottleWeightGSmall) / 1000;
  const kg = round2(rawKg);
  const inkCost = round2(Number(prints.ink_cost ?? 0));
  const resaleIncome = round2(rawKg * resalePricePerKg);
  const perBottleValue1_5L = config.bottleWeightG1_5L / 1000 * resalePricePerKg;
  const perBottleValueSmall = config.bottleWeightGSmall / 1000 * resalePricePerKg;
  return {
    bottles: bottles1_5L + bottlesSmall,
    bottles1_5L,
    bottlesSmall,
    kg,
    co2SavedG: round1(Number(deposits.co2_saved_g ?? 0)),
    printsOk: Number(prints.prints_ok ?? 0),
    printsRefunded: Number(prints.prints_refunded ?? 0),
    creditsSpent: Number(prints.credits_spent ?? 0),
    inkCost,
    pagesBw: Number(prints.pages_bw ?? 0),
    pagesColor: Number(prints.pages_color ?? 0),
    resaleIncome,
    netValue: round2(resaleIncome - inkCost),
    bottlesNeededFor1Peso: {
      "1.5L": Math.ceil(1 / perBottleValue1_5L),
      small: Math.ceil(1 / perBottleValueSmall),
    },
    bottlesToCoverInk: {
      "1.5L": inkCost === 0 ? 0 : Math.ceil(inkCost / perBottleValue1_5L),
      small: inkCost === 0 ? 0 : Math.ceil(inkCost / perBottleValueSmall),
    },
  };
}

function getBucketLabels(
  series: AnalyticsSummarySeries,
  startDate: string,
  endDate: string,
  year: number
): string[] {
  if (series === "hourly") return Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
  if (series === "yearly") return Array.from({ length: 12 }, (_, month) => `${year}-${String(month + 1).padStart(2, "0")}`);
  const labels: string[] = [];
  for (let date = startDate; date <= endDate; date = dateOffset(date, 1)) labels.push(date);
  return labels;
}

export function computeAnalyticsSummary(
  db: Database.Database,
  options: {
    range?: unknown;
    series?: unknown;
    date?: unknown;
    resalePerKg?: unknown;
    binFillPercent?: number | null;
    now?: Date;
  } = {}
) {
  const range = parseRange(options.range);
  const series = parseSeries(options.series);
  const config = getSystemConfig(db);
  const requestedPrice = options.resalePerKg === undefined ? config.resalePricePerKg : Number(options.resalePerKg);
  if (!Number.isFinite(requestedPrice) || requestedPrice < 0.01 || requestedPrice > 1000) {
    throw new Error("Resale price must be between ₱0.01 and ₱1,000 per kg.");
  }
  const resalePricePerKg = round2(requestedPrice);
  const now = options.now ?? new Date();
  const todayDate = manilaDate(now);
  const year = new Date(now.getTime() + MANILA_OFFSET_MS).getUTCFullYear();
  const selectedDate = range === "date" ? parseSelectedDate(options.date, todayDate) : null;

  const todayDeposits = getDepositAggregate(db, todayDate, todayDate);
  const todayPrints = getPrintAggregate(db, todayDate, todayDate, config);
  const today = calculateMetrics(todayDeposits, todayPrints, config, resalePricePerKg);

  const selectedSeries: AnalyticsSummarySeries = range === "today" || range === "date" ? "hourly" : series;
  let startDate = todayDate;
  let endDate = todayDate;
  if (selectedDate) {
    startDate = selectedDate;
    endDate = selectedDate;
  } else if (selectedSeries === "yearly") {
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  } else if (selectedSeries === "daily" && range !== "today") {
    const days = Number(range.slice(0, -1));
    startDate = dateOffset(todayDate, -(days - 1));
  }

  const totals = calculateMetrics(
    getDepositAggregate(db, startDate, endDate),
    getPrintAggregate(db, startDate, endDate, config),
    config,
    resalePricePerKg
  );
  const rawBuckets = getBucketRows(db, startDate, endDate, selectedSeries, config);
  const bucketByLabel = new Map(rawBuckets.map(row => [row.bucket, row]));
  const labels = getBucketLabels(selectedSeries, startDate, endDate, year);
  const buckets: AnalyticsSummaryBucket[] = labels.map(label => {
    const row = bucketByLabel.get(selectedSeries === "hourly" ? label : label);
    const deposits: DepositAggregate = {
      bottles_1_5l: row?.bottles_1_5l ?? 0,
      bottles_small: row?.bottles_small ?? 0,
      co2_saved_g: row?.co2_saved_g ?? 0,
    };
    const prints: PrintAggregate = {
      prints_ok: row?.prints_ok ?? 0,
      prints_refunded: row?.prints_refunded ?? 0,
      credits_spent: row?.credits_spent ?? 0,
      ink_cost: row?.ink_cost ?? 0,
      pages_bw: row?.pages_bw ?? 0,
      pages_color: row?.pages_color ?? 0,
    };
    const metrics = calculateMetrics(deposits, prints, config, resalePricePerKg);
    return { label: selectedSeries === "hourly" ? `${label}:00` : label, ...metrics };
  });

  return {
    range,
    series: selectedSeries,
    selectedDate,
    timezone: "Asia/Manila" as const,
    startDate,
    endDate,
    resalePricePerKg,
    config,
    today,
    totals,
    buckets,
    binFillPercent: options.binFillPercent ?? null,
    binFillPercentByType: { "1.5L": null, small: null },
  };
}
