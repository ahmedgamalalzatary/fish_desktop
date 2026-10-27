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
  const byKind = tab("moves", "stock", {
    label: "",
    all: "",
    options: [],
    matches: (row, value) => (row as { kind: string }).kind === value,
  });
  const rows = [{ kind: "sale" }, { kind: "purchase" }, { kind: "sale" }];

  it("keeps the rows the picked value matches", () => {
    expect(narrowRows(byKind, rows, "sale")).toEqual([{ kind: "sale" }, { kind: "sale" }]);
  });

  it("keeps every row when nothing is picked", () => {
    expect(narrowRows(byKind, rows, "")).toBe(rows);
  });

  it("keeps every row of a tab without a filter", () => {
    expect(narrowRows(tab("stock", "stock"), rows, "sale")).toBe(rows);
  });
});
