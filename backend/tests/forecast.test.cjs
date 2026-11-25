const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  BASE_CASE_PET_KG_PER_SEMESTER,
  CO2E_KG_PER_KG_PET,
  REFERENCE_PET_PRICE_PHP_PER_KG,
  createFinancialScenarios,
  forecastWeeklyDemand,
} = require("../dist/forecast.js");

test("linear regression extends a steady weekly demand trend", () => {
  assert.deepEqual(forecastWeeklyDemand([1, 2, 3], 2, "regression"), [4, 5]);
});

test("Holt linear trend keeps a stable series stable", () => {
  assert.deepEqual(forecastWeeklyDemand([10, 10, 10, 10], 3, "holt"), [10, 10, 10]);
});

test("base-case assumptions produce the documented six-peso scenario", () => {
  const scenarios = createFinancialScenarios(BASE_CASE_PET_KG_PER_SEMESTER, 100);
  assert.deepEqual(scenarios.map(item => item.pricePerKg), [4, 5, 6, 7, 8, 9, 10]);
  assert.equal(REFERENCE_PET_PRICE_PHP_PER_KG, 6);
  const scenario = scenarios
    .find(item => item.pricePerKg === 6);
  assert.equal(scenario.actualBottleValuePhp, 600);
  assert.equal(scenario.bottleRevenuePhp, 2097.9);
  assert.equal(scenario.kioskNetPhp, -2048.93);
  assert.equal(scenario.netIncludingOrgPaperPhp, -622.13);
});

test("analysis CO2e factor is used consistently", () => {
  assert.equal(CO2E_KG_PER_KG_PET, 1.146);
  assert.equal(Math.round(BASE_CASE_PET_KG_PER_SEMESTER * CO2E_KG_PER_KG_PET * 10) / 10, 400.7);
});