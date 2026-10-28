import { parseCount, parseMoney } from "./format";
import type { DiscountInput } from "./types";

/**
 * What a discount typed at checkout takes off `subtotal`, rounded to the cent the way the backend does
 * (`discount_of` in src-tauri/src/commands/sales.rs); null when it can't be given. A fixed amount is
 * up to the whole subtotal; a percent is a whole number from 1 to 100.
 */
export function discountAmount(subtotal: number, kind: DiscountInput["kind"], text: string): number | null {
  if (kind === "fixed") {
    const value = parseMoney(text);
    return value !== null && value > 0 && value <= subtotal ? value : null;
  }
  const percent = parseCount(text);
  return percent !== null && percent >= 1 && percent <= 100
    ? Math.floor((subtotal * percent + 50) / 100)
    : null;
}
