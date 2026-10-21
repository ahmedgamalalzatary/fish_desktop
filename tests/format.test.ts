import { describe, expect, it } from "vitest";
import { formatAmount, formatWeight, isoDate, parseKg, parseMoney, priceForGrams } from "../src/lib/format";

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

describe("parseKg", () => {
  it("converts kilograms to grams", () => {
    expect(parseKg("1.25")).toBe(1250);
    expect(parseKg(".5")).toBe(500);
    expect(parseKg("2.")).toBe(2000);
  });
});

describe("priceForGrams", () => {
  it("matches the backend rounding", () => {
    expect(priceForGrams(18000, 1000)).toBe(18000);
    expect(priceForGrams(18000, 750)).toBe(13500);
    expect(priceForGrams(999, 333)).toBe(333);
    expect(priceForGrams(1000, 1)).toBe(1);
  });
});

describe("formatting", () => {
  it("formats amounts and weights", () => {
    expect(formatAmount(123456)).toBe("1,234.56");
    expect(formatWeight(250)).toBe("250 جم");
    expect(formatWeight(1250)).toBe("1.25 كجم");
    expect(formatWeight(0)).toBe("0 كجم");
  });

  it("uses the local calendar date", () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
