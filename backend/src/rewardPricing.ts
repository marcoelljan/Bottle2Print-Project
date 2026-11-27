export interface RewardPricing {
  pricePhp: number;
  creditsApplied: number;
  discountPhp: number;
  amountDuePhp: number;
  maxCreditsUsable: number;
}

export function calculateRewardPricing(
  pricePhp: number,
  creditsApplied: number,
  creditsPerPeso: number,
  availableCredits: number,
): RewardPricing {
  if (!Number.isFinite(pricePhp) || pricePhp < 0) throw new Error("Reward price must be a non-negative amount.");
  if (!Number.isSafeInteger(creditsApplied) || creditsApplied < 0) {
    throw new Error("Credits applied must be a non-negative whole number.");
  }
  if (!Number.isFinite(creditsPerPeso) || creditsPerPeso <= 0) {
    throw new Error("Credits per peso must be greater than zero.");
  }
  if (!Number.isSafeInteger(availableCredits) || availableCredits < 0) {
    throw new Error("Available credits must be a non-negative whole number.");
  }

  const priceCents = Math.round(pricePhp * 100);
  const maxCreditsUsable = Math.min(
    availableCredits,
    Math.floor((priceCents * creditsPerPeso) / 100 + Number.EPSILON),
  );
  if (creditsApplied > maxCreditsUsable) {
    throw new Error(`Credits applied cannot exceed ${maxCreditsUsable}.`);
  }

  const discountCents = Math.min(
    priceCents,
    Math.round((creditsApplied / creditsPerPeso) * 100),
  );
  return {
    pricePhp: priceCents / 100,
    creditsApplied,
    discountPhp: discountCents / 100,
    amountDuePhp: (priceCents - discountCents) / 100,
    maxCreditsUsable,
  };
}
