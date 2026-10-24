import { isoDate } from "./format";

export type Preset = "today" | "yesterday" | "week" | "month" | "last-month" | "year" | "custom";
export type Range = { from: string; to: string };

export const presets: { value: Preset; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "yesterday", label: "أمس" },
  { value: "week", label: "آخر 7 أيام" },
  { value: "month", label: "هذا الشهر" },
  { value: "last-month", label: "الشهر الماضي" },
  { value: "year", label: "هذه السنة" },
  { value: "custom", label: "فترة محددة" },
];

export function presetRange(preset: Preset): Range {
  const now = new Date();
  const d = (y: number, m: number, day: number) => isoDate(new Date(y, m, day));
  const [y, m, day] = [now.getFullYear(), now.getMonth(), now.getDate()];
  switch (preset) {
    case "yesterday":
      return { from: d(y, m, day - 1), to: d(y, m, day - 1) };
    case "week":
      return { from: d(y, m, day - 6), to: d(y, m, day) };
    case "month":
      return { from: d(y, m, 1), to: d(y, m, day) };
    case "last-month":
      return { from: d(y, m - 1, 1), to: d(y, m, 0) };
    case "year":
      return { from: d(y, 0, 1), to: d(y, m, day) };
    default:
      return { from: d(y, m, day), to: d(y, m, day) };
  }
}
