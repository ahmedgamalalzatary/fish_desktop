import { describe, expect, it } from "vitest";
import { formatAmount, formatPhones, isoDate, parseCount, phoneDetails, parseMoney } from "../src/lib/format";

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

  it("counts phones in Arabic", () => {
    expect(formatPhones(1)).toBe("جهاز واحد");
    expect(formatPhones(2)).toBe("جهازان");
    expect(formatPhones(5)).toBe("5 أجهزة");
    expect(formatPhones(12)).toBe("12 جهاز");
    expect(formatPhones(0)).toBe("0 جهاز");
  });

  it("describes a phone, leaving out what is not recorded", () => {
    expect(phoneDetails({ storage: "256GB", color: "أسود", battery: 85 })).toBe("256GB · أسود · بطارية 85%");
    expect(phoneDetails({ storage: "", color: "", battery: null })).toBe("");
  });

  it("uses the local calendar date", () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
