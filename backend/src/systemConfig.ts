import { db } from "./db";
import type Database from "better-sqlite3";

export interface SystemConfig {
  inkCostBwPerPage: number;
  inkCostColorPerPage: number;
  resalePricePerKg: number;
  bottleWeightG1_5L: number;
  bottleWeightGSmall: number;
  binMaxBottles1_5L: number;
  binMaxBottlesSmall: number;
}

const CONFIG_KEYS = {
  inkCostBwPerPage: "ink_cost_bw_per_page",
  inkCostColorPerPage: "ink_cost_color_per_page",
  resalePricePerKg: "resale_price_per_kg",
  bottleWeightG1_5L: "bottle_weight_g_1_5l",
  bottleWeightGSmall: "bottle_weight_g_small",
  binMaxBottles1_5L: "bin_max_bottles_1_5l",
  binMaxBottlesSmall: "bin_max_bottles_small",
} as const;

function readConfigValue(database: Database.Database, key: string): number {
  const row = database.prepare("SELECT value FROM system_config WHERE key = ?").get(key) as { value: string } | undefined;
  const value = Number(row?.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`System configuration '${key}' must be a positive number.`);
  }
  return value;
}

export function getSystemConfig(database: Database.Database = db): SystemConfig {
  const config = {
    inkCostBwPerPage: readConfigValue(database, CONFIG_KEYS.inkCostBwPerPage),
    inkCostColorPerPage: readConfigValue(database, CONFIG_KEYS.inkCostColorPerPage),
    resalePricePerKg: readConfigValue(database, CONFIG_KEYS.resalePricePerKg),
    bottleWeightG1_5L: readConfigValue(database, CONFIG_KEYS.bottleWeightG1_5L),
    bottleWeightGSmall: readConfigValue(database, CONFIG_KEYS.bottleWeightGSmall),
    binMaxBottles1_5L: readConfigValue(database, CONFIG_KEYS.binMaxBottles1_5L),
    binMaxBottlesSmall: readConfigValue(database, CONFIG_KEYS.binMaxBottlesSmall),
  };
  if (config.inkCostColorPerPage <= config.inkCostBwPerPage) {
    throw new Error("Color ink cost per page must be greater than B&W ink cost per page.");
  }
  return config;
}

export function saveSystemConfig(updates: Partial<SystemConfig>, database: Database.Database = db): SystemConfig {
  const current = getSystemConfig(database);
  const next = { ...current, ...updates };
  for (const [field, value] of Object.entries(next)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${field} must be a positive number.`);
    }
  }
  if (next.inkCostColorPerPage <= next.inkCostBwPerPage) {
    throw new Error("Color ink cost per page must be greater than B&W ink cost per page.");
  }

  const save = database.prepare("UPDATE system_config SET value = ? WHERE key = ?");
  const updateAll = database.transaction(() => {
    for (const [field, key] of Object.entries(CONFIG_KEYS) as Array<[keyof SystemConfig, string]>) {
      if (updates[field] !== undefined) save.run(String(next[field]), key);
    }
  });
  updateAll();
  return getSystemConfig(database);
}
