import type { ReportTab } from "./shop";

export type SharedTab = "summary" | "profit" | "sales" | "cashiers" | "purchases" | "suppliers" | "expenses";
/** A shared tab, or the `value` of one of the shop's report tabs. */
export type Tab = SharedTab | (string & {});

/** The shared tabs, with the shop's own after the invoices ("sales") or at the end ("stock"). */
export function allTabs(shopTabs: ReportTab<unknown>[]): { value: Tab; label: string }[] {
  const of = (place: ReportTab<unknown>["place"]) =>
    shopTabs.filter((t) => t.place === place).map((t) => ({ value: t.value, label: t.label }));
  return [
    { value: "summary", label: "الملخص" },
    { value: "profit", label: "الأرباح" },
    { value: "sales", label: "الفواتير" },
    ...of("sales"),
    { value: "cashiers", label: "الموظفون" },
    { value: "purchases", label: "المشتريات" },
    { value: "suppliers", label: "الموردون" },
    { value: "expenses", label: "المصروفات" },
    ...of("stock"),
  ];
}

/** A shop tab's rows as the value picked in its drop-down shows them; "" keeps them as loaded. */
export function narrowRows<T>(tab: ReportTab<T>, rows: T[], value: string): T[] {
  return tab.filter && value ? tab.filter.apply(rows, value) : rows;
}
