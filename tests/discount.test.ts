import { describe, expect, test } from "vitest";
import { discountAmount } from "../src/lib/discount";

describe("discountAmount", () => {
  test("takes a fixed amount off, up to the whole subtotal", () => {
    expect(discountAmount(100_000, "fixed", "50")).toBe(5_000);
    expect(discountAmount(100_000, "fixed", "1000")).toBe(100_000);
    expect(discountAmount(100_000, "fixed", "1000.01")).toBeNull();
    expect(discountAmount(100_000, "fixed", "0")).toBeNull();
  });

  test("takes a whole percent off, rounded to the cent like the backend", () => {
    expect(discountAmount(100_000, "percent", "10")).toBe(10_000);
    expect(discountAmount(999, "percent", "10")).toBe(100);
    expect(discountAmount(994, "percent", "10")).toBe(99);
    expect(discountAmount(1_000, "percent", "١٠٠")).toBe(1_000);
    expect(discountAmount(1_000, "percent", "101")).toBeNull();
    expect(discountAmount(1_000, "percent", "12.5")).toBeNull();
    expect(discountAmount(1_000, "percent", "")).toBeNull();
  });
});
