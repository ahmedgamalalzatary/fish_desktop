import type { MovementReason } from "./types";

/** Arabic counting of phones: 1 → "جهاز واحد", 2 → "جهازان", 5 → "5 أجهزة", 12 → "12 جهاز". */
export function formatPhones(count: number): string {
  if (count === 1) return "جهاز واحد";
  if (count === 2) return "جهازان";
  if (count >= 3 && count <= 10) return `${count} أجهزة`;
  return `${count} جهاز`;
}

/** Storage, color and battery of a phone: "256GB · أسود · بطارية 85%". Empty parts are left out. */
export function phoneDetails(p: { storage: string; color: string; battery: number | null }): string {
  return [p.storage, p.color, p.battery !== null && `بطارية ${p.battery}%`].filter(Boolean).join(" · ");
}

export const movementLabels: Record<MovementReason, string> = {
  added: "إضافة",
  purchase: "فاتورة شراء",
  sale: "بيع",
  removed: "إخراج من المخزون",
};
