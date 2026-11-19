import { db } from "./db";

export interface PrintPricing {
  bwCreditsPerPage: number;
  colorCreditsPerPage: number;
}

const MAX_CREDITS_PER_PAGE = 1_000_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS print_pricing (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    bw_credits_per_page INTEGER NOT NULL CHECK (bw_credits_per_page BETWEEN 1 AND ${MAX_CREDITS_PER_PAGE}),
    color_credits_per_page INTEGER NOT NULL CHECK (color_credits_per_page BETWEEN 1 AND ${MAX_CREDITS_PER_PAGE})
  );
  INSERT OR IGNORE INTO print_pricing (id, bw_credits_per_page, color_credits_per_page)
  VALUES (1, 3, 8);
`);

export function isValidPrintRate(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_CREDITS_PER_PAGE;
}

export function getPrintPricing(): PrintPricing {
  const row = db.prepare(`
    SELECT bw_credits_per_page AS bwCreditsPerPage,
           color_credits_per_page AS colorCreditsPerPage
    FROM print_pricing
    WHERE id = 1
  `).get() as PrintPricing | undefined;

  if (!row) throw new Error("Print pricing is not configured.");
  return row;
}

export function savePrintPricing(pricing: PrintPricing): PrintPricing {
  db.prepare(`
    UPDATE print_pricing
    SET bw_credits_per_page = ?, color_credits_per_page = ?
    WHERE id = 1
  `).run(pricing.bwCreditsPerPage, pricing.colorCreditsPerPage);

  return getPrintPricing();
}
