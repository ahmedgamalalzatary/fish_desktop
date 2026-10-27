import { describe, expect, it } from "vitest";
import {
  formatGramPrice,
  formatWeight,
  parseGramPrice,
  parseGrams,
  priceForGrams,
} from "../../src/shops/fish/format";

describe("weights", () => {
  it("reads whole grams, from Arabic keyboards too", () => {
    expect(parseGrams("1255")).toBe(1255);
    expect(parseGrams("750")).toBe(750);
    expect(parseGrams("١٥٠٠")).toBe(1500);
  });

  it("rejects what is not a weight in grams", () => {
    expect(parseGrams("")).toBeNull();
    expect(parseGrams("abc")).toBeNull();
    expect(parseGrams("-1")).toBeNull();
    expect(parseGrams("1.5")).toBeNull();
  });

  it("shows every weight in grams", () => {
    expect(formatWeight(250)).toBe("250 جم");
    expect(formatWeight(1250)).toBe("1,250 جم");
    expect(formatWeight(0)).toBe("0 جم");
    expect(formatWeight(-500)).toBe("-500 جم");
  });
});

describe("price per gram", () => {
  // Stored in thousandths of a cent, so a price per gram keeps every digit an old price per kilo had.
  it("shows the price of one gram with only the digits it needs", () => {
    expect(formatGramPrice(9000)).toBe("0.09");
    expect(formatGramPrice(25550)).toBe("0.2555");
    expect(formatGramPrice(25555)).toBe("0.25555");
    expect(formatGramPrice(100000)).toBe("1.00");
    expect(formatGramPrice(0)).toBe("0.00");
  });

  it("reads a typed price per gram back exactly", () => {
    expect(parseGramPrice("0.09")).toBe(9000);
    expect(parseGramPrice("0.2555")).toBe(25550);
    expect(parseGramPrice("٠٫٢٥")).toBe(25000);
    expect(parseGramPrice("x")).toBeNull();
  });

  it("prices a weight with the backend's rounding, to the nearest cent", () => {
    // 0.18 a gram × 750 g = 135.00
    expect(priceForGrams(18000, 750)).toBe(13500);
    expect(priceForGrams(999, 333)).toBe(333);
  });
});
