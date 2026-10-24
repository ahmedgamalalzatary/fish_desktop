import { parseCount, parseMoney } from "./format";
import { useToast } from "./toast";
import type { Phone, PhoneInput } from "./types";

/** A phone being typed in: every field is still text. `productId` is used where the model is picked per row. */
export interface PhoneDraft {
  key: number;
  productId: string;
  serial: string;
  storage: string;
  color: string;
  battery: string;
  cost: string;
  price: string;
}

let nextKey = 0;

/** An empty row. Passing the previous row copies its model, storage, color and prices, since phones
 * usually arrive several of a kind; serial and battery are always per phone. */
export const newDraft = (from?: PhoneDraft): PhoneDraft => ({
  key: ++nextKey,
  productId: from?.productId ?? "",
  serial: "",
  storage: from?.storage ?? "",
  color: from?.color ?? "",
  battery: "",
  cost: from?.cost ?? "",
  price: from?.price ?? "",
});

const moneyText = (cents: number) => String(cents / 100);

export const draftFromPhone = (p: Phone): PhoneDraft => ({
  key: ++nextKey,
  productId: String(p.product_id),
  serial: p.serial,
  storage: p.storage,
  color: p.color,
  battery: p.battery === null ? "" : String(p.battery),
  cost: moneyText(p.cost),
  price: moneyText(p.price),
});

/** A row nobody started filling in, which forms skip instead of rejecting. */
export const isBlank = (d: PhoneDraft) => !d.serial.trim() && !d.price.trim() && !d.cost.trim();

/** Checks one row; returns the input to send or what is wrong with it. */
export function readDraft(d: PhoneDraft): { input: PhoneInput } | { error: string } {
  const serial = d.serial.trim();
  if (!serial) return { error: "الرقم التسلسلي مطلوب لكل جهاز" };
  let battery: number | null = null;
  if (d.battery.trim()) {
    battery = parseCount(d.battery);
    if (battery === null || battery < 1 || battery > 100)
      return { error: `نسبة البطارية للجهاز ${serial} بين 1 و100` };
  }
  const cost = parseMoney(d.cost);
  if (cost === null) return { error: `سعر الشراء مطلوب للجهاز ${serial}` };
  const price = parseMoney(d.price);
  if (!price) return { error: `سعر البيع مطلوب للجهاز ${serial}` };
  return {
    input: { serial, storage: d.storage.trim(), color: d.color.trim(), battery, price, cost },
  };
}

/** Serials typed more than once in the same form, compared the way the database does (ignoring case). */
export function repeatedSerials(drafts: PhoneDraft[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const d of drafts) {
    const s = d.serial.trim().toLowerCase();
    if (!s) continue;
    if (seen.has(s)) repeated.add(s);
    seen.add(s);
  }
  return repeated;
}

export const storageOptions = ["64GB", "128GB", "256GB", "512GB", "1TB"];
export const colorOptions = ["أسود", "أبيض", "فضي", "رمادي", "ذهبي", "أزرق", "أخضر", "بنفسجي", "أحمر"];

/** Checks the rows of a phone form; returns the inputs, or shows what is wrong and returns null. */
export function useReadDrafts() {
  const toast = useToast();
  return (drafts: PhoneDraft[]): PhoneInput[] | null => {
    if (repeatedSerials(drafts).size > 0) {
      toast("رقم تسلسلي مكرر في القائمة", "error");
      return null;
    }
    const inputs: PhoneInput[] = [];
    for (const d of drafts.filter((d) => !isBlank(d))) {
      const read = readDraft(d);
      if ("error" in read) {
        toast(read.error, "error");
        return null;
      }
      inputs.push(read.input);
    }
    return inputs;
  };
}
