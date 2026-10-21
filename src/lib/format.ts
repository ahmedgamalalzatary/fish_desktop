import type { MovementReason, PaymentMethod } from "./types";

const amount = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kilos = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/** 18050 → "180.50" */
export const formatAmount = (cents: number) => amount.format(cents / 100);

/** 18050, "ج.م" → "180.50 ج.م" */
export const formatMoney = (cents: number, currency: string) =>
  currency ? `${formatAmount(cents)} ${currency}` : formatAmount(cents);

/** 1250 → "1.25 كجم", 250 → "250 جم" */
export function formatWeight(grams: number): string {
  if (Math.abs(grams) < 1000 && grams !== 0) return `${grams} جم`;
  return `${kilos.format(grams / 1000)} كجم`;
}

/** Plain kilograms for inputs and the scale readout: 1250 → "1.250" */
export const gramsToKg = (grams: number) => (grams / 1000).toFixed(3);

/** "12.5" → 1250. Returns null for anything that is not a non-negative number. */
export function parseMoney(text: string): number | null {
  const value = parseDecimal(text);
  return value === null ? null : Math.round(value * 100);
}

/** Kilograms typed by the user → grams. "1.25" → 1250 */
export function parseKg(text: string): number | null {
  const value = parseDecimal(text);
  return value === null ? null : Math.round(value * 1000);
}

const easternDigits = "٠١٢٣٤٥٦٧٨٩";

function parseDecimal(text: string): number | null {
  // Accept Arabic-Indic digits and the Arabic decimal separator from Arabic keyboards.
  const normalized = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String(easternDigits.indexOf(d)))
    .replace(/[٫,]/g, ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return null;
  return Number(normalized);
}

/** Same rounding as the backend, so the cart preview always matches the receipt. */
export const priceForGrams = (perKg: number, grams: number) => Math.floor((perKg * grams + 500) / 1000);

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: "نقدي",
  card: "بطاقة",
  wallet: "محفظة إلكترونية",
};

export const movementLabels: Record<MovementReason, string> = {
  sale: "بيع",
  purchase: "استلام بضاعة",
  adjustment: "جرد / تسوية",
};

/** "2026-10-22 14:05:09" → "22/10/2026 14:05" */
export function formatDateTime(ts: string): string {
  const [date, time = ""] = ts.split(" ");
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y} ${time.slice(0, 5)}`.trim();
}

/** Local calendar date as YYYY-MM-DD (not UTC, which can be a different day). */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
