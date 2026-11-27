const assert = require("node:assert/strict");
const { test } = require("node:test");
const { addDaysToIsoDate, RFID_CREDIT_VALIDITY_DAYS } = require("../dist/rfidCredits.js");
const { calculateRewardPricing } = require("../dist/rewardPricing.js");

test("RFID credits expire exactly 180 days after earning", () => {
  assert.equal(RFID_CREDIT_VALIDITY_DAYS, 180);
  assert.equal(addDaysToIsoDate("2026-01-01", RFID_CREDIT_VALIDITY_DAYS), "2026-06-30");
  assert.equal(addDaysToIsoDate("2024-09-30", RFID_CREDIT_VALIDITY_DAYS), "2025-03-29");
});

test("reward pricing applies 100 credits as a ten-peso discount on a fifty-peso reward", () => {
  assert.deepEqual(calculateRewardPricing(50, 100, 10, 500), {
    pricePhp: 50,
    creditsApplied: 100,
    discountPhp: 10,
    amountDuePhp: 40,
    maxCreditsUsable: 500,
  });
});

test("reward pricing allows full cash payment when the user has zero credits", () => {
  assert.deepEqual(calculateRewardPricing(50, 0, 10, 0), {
    pricePhp: 50,
    creditsApplied: 0,
    discountPhp: 0,
    amountDuePhp: 50,
    maxCreditsUsable: 0,
  });
});

test("reward pricing caps usable credits at the price and leaves excess credits untouched", () => {
  assert.equal(calculateRewardPricing(50, 500, 10, 700).discountPhp, 50);
  assert.equal(calculateRewardPricing(50, 500, 10, 700).amountDuePhp, 0);
  assert.equal(calculateRewardPricing(50, 500, 10, 700).maxCreditsUsable, 500);
  assert.throws(() => calculateRewardPricing(50, 501, 10, 700), /cannot exceed 500/);
});

test("reward pricing caps applied credits at the user's available balance", () => {
  assert.deepEqual(calculateRewardPricing(50, 30, 10, 30), {
    pricePhp: 50,
    creditsApplied: 30,
    discountPhp: 3,
    amountDuePhp: 47,
    maxCreditsUsable: 30,
  });
  assert.throws(() => calculateRewardPricing(50, 31, 10, 30), /cannot exceed 30/);
});

test("reward pricing rounds peso amounts to cents without allowing over-discount", () => {
  const result = calculateRewardPricing(19.99, 500, 10, 500);
  assert.equal(result.discountPhp, 19.99);
  assert.equal(result.amountDuePhp, 0);
  assert.throws(() => calculateRewardPricing(19.99, 201, 10, 500), /cannot exceed 199/);
});

test("reward pricing rejects non-integer credits and invalid rates", () => {
  assert.throws(() => calculateRewardPricing(50, 1.5, 10, 30), /whole number/);
  assert.throws(() => calculateRewardPricing(50, 0, 0, 30), /greater than zero/);
});
