import { parseCount, parseDecimal } from "../../lib/format";
import type { MovementReason } from "./types";

const grams = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
// A price per gram is stored in thousandths of a cent: 100,000 to the currency unit.
const gramPrice = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });

/** 1250 → "1,250 جم" */
export const formatWeight = (g: number) => `${grams.format(g)} جم`;

/** Whole grams typed by the user. "1250" → 1250. Returns null for anything else. */
export const parseGrams = (text: string) => parseCount(text);

/** A price per gram, in thousandths of a cent, with only the digits it needs: 25550 → "0.2555" */
export const formatGramPrice = (milli: number) => gramPrice.format(milli / 100_000);

/** A typed price per gram → thousandths of a cent. "0.2555" → 25550. Returns null for anything else. */
export function parseGramPrice(text: string): number | null {
  const value = parseDecimal(text);
  return value === null ? null : Math.round(value * 100_000);
}

/** The price per gram, in thousandths of a cent, of `g` grams that cost `cents`. */
export const perGram = (cents: number, g: number) => Math.round((cents * 1000) / g);

/** Same rounding as the backend, so the cart preview always matches the receipt: a price per gram in
 *  thousandths of a cent times grams, to the nearest cent. */
export const priceForGrams = (price: number, g: number) => Math.floor((price * g + 500) / 1000);

export const movementLabels: Record<MovementReason, string> = {
  sale: "بيع",
  purchase: "استلام بضاعة",
  adjustment: "جرد / تسوية",
};
