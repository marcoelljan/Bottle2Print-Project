export const CO2E_KG_PER_KG_PET = 1.146;
export const SEMESTER_WEEKS = 20;
export const BASE_CASE_PET_KG_PER_SEMESTER = 349.65;
export const BASE_CASE_OPERATING_COSTS_PHP = 4146.83;
export const OPTIONAL_ORG_PAPER_MARGIN_PHP = 1426.8;
export const REFERENCE_PET_PRICE_PHP_PER_KG = 6;

export type ForecastModel = "holt" | "regression";

export function forecastWeeklyDemand(values: number[], horizon: number, model: ForecastModel): number[] {
  if (horizon <= 0) return [];
  const observations = values.map(value => Math.max(0, Number.isFinite(value) ? value : 0));
  if (observations.length === 0) return Array(horizon).fill(0);

  if (model === "regression") {
    const count = observations.length;
    const meanX = (count - 1) / 2;
    const meanY = observations.reduce((sum, value) => sum + value, 0) / count;
    let numerator = 0;
    let denominator = 0;
    observations.forEach((value, index) => {
      numerator += (index - meanX) * (value - meanY);
      denominator += (index - meanX) ** 2;
    });
    const slope = denominator ? numerator / denominator : 0;
    const intercept = meanY - slope * meanX;
    return Array.from({ length: horizon }, (_, index) =>
      Math.max(0, intercept + slope * (count + index))
    );
  }

  let level = observations[0];
  let trend = observations.length > 1 ? observations[1] - observations[0] : 0;
  const alpha = 0.4;
  const beta = 0.2;
  for (let index = 1; index < observations.length; index++) {
    const previousLevel = level;
    level = alpha * observations[index] + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
  }
  return Array.from({ length: horizon }, (_, index) =>
    Math.max(0, level + (index + 1) * trend)
  );
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function createFinancialScenarios(projectedPetKg: number, actualPetKg = 0) {
  return Array.from({ length: 7 }, (_, index) => index + 4).map(pricePerKg => {
    const bottleRevenue = round2(projectedPetKg * pricePerKg);
    return {
      pricePerKg,
      actualBottleValuePhp: round2(actualPetKg * pricePerKg),
      bottleRevenuePhp: bottleRevenue,
      kioskNetPhp: round2(bottleRevenue - BASE_CASE_OPERATING_COSTS_PHP),
      kioskCostRecoveryPercent: round2(bottleRevenue / BASE_CASE_OPERATING_COSTS_PHP * 100),
      netIncludingOrgPaperPhp: round2(
        bottleRevenue + OPTIONAL_ORG_PAPER_MARGIN_PHP - BASE_CASE_OPERATING_COSTS_PHP
      ),
    };
  });
}