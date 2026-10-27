import { describe, expect, it } from "vitest";
import { formatPhones, phoneDetails } from "../../src/shops/mobile/format";

describe("phone wording", () => {
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
});
