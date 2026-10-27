import { parseDecimal } from "../../lib/format";
import type { MovementReason } from "./types";

const kilos = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/** 1250 → "1.25 كجم", 250 → "250 جم" */
export function formatWeight(grams: number): string {
  if (Math.abs(grams) < 1000 && grams !== 0) return `${grams} جم`;
  return `${kilos.format(grams / 1000)} كجم`;
}

/** Plain kilograms for inputs and the scale readout: 1250 → "1.250" */
export const gramsToKg = (grams: number) => (grams / 1000).toFixed(3);

/** Kilograms typed by the user → grams. "1.25" → 1250. Returns null for anything that is not a number. */
export function parseKg(text: string): number | null {
  const value = parseDecimal(text);
  return value === null ? null : Math.round(value * 1000);
}

/** Same rounding as the backend, so the cart preview always matches the receipt. */
export const priceForGrams = (perKg: number, grams: number) => Math.floor((perKg * grams + 500) / 1000);

export const movementLabels: Record<MovementReason, string> = {
  sale: "بيع",
  purchase: "استلام بضاعة",
  adjustment: "جرد / تسوية",
};
