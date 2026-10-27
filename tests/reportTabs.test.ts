import { describe, expect, it } from "vitest";
import { allTabs, narrowRows } from "../src/lib/reportTabs";
import type { ReportTab } from "../src/lib/shop";

const tab = (value: string, place: "sales" | "stock", filter?: ReportTab<unknown>["filter"]) =>
  ({ value, label: value, place, filter }) as ReportTab<unknown>;

describe("allTabs", () => {
  it("puts the shop's sales tabs after the invoices and its stock tabs last, in the shop's order", () => {
    const tabs = allTabs([tab("stock", "stock"), tab("products", "sales"), tab("moves", "stock")]);
    expect(tabs.map((t) => t.value)).toEqual([
      "summary",
      "profit",
      "sales",
      "products",
      "cashiers",
      "purchases",
      "suppliers",
      "expenses",
      "stock",
      "moves",
    ]);
  });
});

describe("narrowRows", () => {
  type Row = { kind: string; amount: number };
  const rows: Row[] = [
    { kind: "sale", amount: 1 },
    { kind: "purchase", amount: 2 },
    { kind: "sale", amount: 3 },
  ];
  const byKind = tab("moves", "stock", {
    label: "",
    all: "",
    options: [],
    apply: (rs, value) => (rs as Row[]).filter((r) => r.kind === value),
  });

  it("keeps the rows the picked value keeps", () => {
    expect(narrowRows(byKind, rows, "sale")).toEqual([rows[0], rows[2]]);
  });

  it("can turn the rows into others, e.g. merge them", () => {
    const merged = tab("cats", "sales", {
      label: "",
      all: "",
      options: [],
      apply: (rs) => [{ kind: "all", amount: (rs as Row[]).reduce((s, r) => s + r.amount, 0) }],
    });
    expect(narrowRows(merged, rows, "merge")).toEqual([{ kind: "all", amount: 6 }]);
  });

  it("keeps every row when nothing is picked", () => {
    expect(narrowRows(byKind, rows, "")).toBe(rows);
  });

  it("keeps every row of a tab without a filter", () => {
    expect(narrowRows(tab("stock", "stock"), rows, "sale")).toBe(rows);
  });
});
