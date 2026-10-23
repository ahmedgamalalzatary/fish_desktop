import { describe, expect, it } from "vitest";
import { formatAmount, formatPieces, isoDate, itemName, parseCount, parseMoney } from "../src/lib/format";

describe("parseMoney", () => {
  it("converts typed amounts to cents", () => {
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("180")).toBe(18000);
    expect(parseMoney("19.99")).toBe(1999);
  });

  it("accepts Arabic digits and separators", () => {
    expect(parseMoney("١٢٫٥")).toBe(1250);
    expect(parseMoney("12,5")).toBe(1250);
  });

  it("rejects invalid input", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-3")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNull();
  });
});

describe("parseCount", () => {
  it("accepts whole pieces only", () => {
    expect(parseCount("3")).toBe(3);
    expect(parseCount("٤")).toBe(4);
    expect(parseCount("0")).toBe(0);
    expect(parseCount("1.5")).toBeNull();
    expect(parseCount("")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats amounts", () => {
    expect(formatAmount(123456)).toBe("1,234.56");
  });

  it("counts pieces in Arabic", () => {
    expect(formatPieces(1)).toBe("قطعة واحدة");
    expect(formatPieces(2)).toBe("قطعتان");
    expect(formatPieces(5)).toBe("5 قطع");
    expect(formatPieces(12)).toBe("12 قطعة");
    expect(formatPieces(0)).toBe("0 قطعة");
  });

  it("names a variant after its product", () => {
    expect(itemName("iPhone 15", "128GB")).toBe("iPhone 15 — 128GB");
    expect(itemName("شاحن 20W", "")).toBe("شاحن 20W");
  });

  it("uses the local calendar date", () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
