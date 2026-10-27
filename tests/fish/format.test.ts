import { describe, expect, it } from "vitest";
import { formatWeight, parseKg, priceForGrams } from "../../src/shops/fish/format";

describe("weights", () => {
  it("reads kilograms to the gram, from Arabic keyboards too", () => {
    expect(parseKg("1.255")).toBe(1255);
    expect(parseKg("0.75")).toBe(750);
    expect(parseKg("١٫٥")).toBe(1500);
    expect(parseKg("2")).toBe(2000);
  });

  it("rejects what is not a weight", () => {
    expect(parseKg("")).toBeNull();
    expect(parseKg("abc")).toBeNull();
    expect(parseKg("-1")).toBeNull();
  });

  it("shows grams under a kilo and kilos above", () => {
    expect(formatWeight(250)).toBe("250 جم");
    expect(formatWeight(1250)).toBe("1.25 كجم");
    expect(formatWeight(0)).toBe("0 كجم");
    expect(formatWeight(-500)).toBe("-500 جم");
  });

  it("prices a weight with the backend's rounding", () => {
    expect(priceForGrams(18000, 750)).toBe(13500);
    expect(priceForGrams(999, 333)).toBe(333);
  });
});
