const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const { startGuestSession, addGuestCredit, getGuestCredits, tryDeductGuestCredits, endGuestSession } = require("../dist/guestSession.js");
const { calculatePrintCredits } = require("../dist/printPricing.js");

after(() => endGuestSession());

test("print credit calculation uses the configured B&W and color rates", () => {
  const pricing = { bwCreditsPerPage: 3, colorCreditsPerPage: 8 };
  assert.equal(calculatePrintCredits(3, "bw", pricing), 9);
  assert.equal(calculatePrintCredits(3, "color", pricing), 24);
  assert.throws(() => calculatePrintCredits(0, "bw", pricing), /positive whole number/);
});

test("guest credits are checked and deducted atomically", () => {
  endGuestSession();
  startGuestSession();
  addGuestCredit(10);

  assert.equal(tryDeductGuestCredits(9), true);
  assert.equal(getGuestCredits(), 1);
  assert.equal(tryDeductGuestCredits(2), false);
  assert.equal(getGuestCredits(), 1);
});
