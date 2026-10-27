import type { PaymentMethod } from "./types";

const amount = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 18050 → "180.50" */
export const formatAmount = (cents: number) => amount.format(cents / 100);

/** 18050, "ج.م" → "180.50 ج.م" */
export const formatMoney = (cents: number, currency: string) =>
  currency ? `${formatAmount(cents)} ${currency}` : formatAmount(cents);

/** "12.5" → 1250. Returns null for anything that is not a non-negative number. */
export function parseMoney(text: string): number | null {
  const value = parseDecimal(text);
  return value === null ? null : Math.round(value * 100);
}

/** A whole number of pieces. "3" → 3, "٤" → 4. Returns null for fractions or anything else. */
export function parseCount(text: string): number | null {
  const value = parseDecimal(text);
  return value === null || !Number.isInteger(value) ? null : value;
}

const easternDigits = "٠١٢٣٤٥٦٧٨٩";

/** A non-negative decimal typed in, with Arabic digits and separators. Returns null for anything else. */
export function parseDecimal(text: string): number | null {
  // Accept Arabic-Indic digits and the Arabic decimal separator from Arabic keyboards.
  const normalized = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String(easternDigits.indexOf(d)))
    .replace(/[٫,]/g, ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return null;
  return Number(normalized);
}

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: "نقدي",
  card: "بطاقة",
  wallet: "محفظة إلكترونية",
};

/** ["cash", "card"] → "نقدي + بطاقة" */
export const paymentNames = (methods: PaymentMethod[]) => methods.map((m) => paymentLabels[m]).join(" + ");

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
