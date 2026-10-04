import { describe, expect, it } from "vitest";
import { computeCouponDiscount, normalizeCouponCode, parseCouponForm } from "./coupon";
import { parsePlanForm } from "./plan-form";
import { PLANS } from "./plans";

describe("kupon", () => {
  it("indirim hesabı: yüzde, tutar, tavan", () => {
    expect(computeCouponDiscount("percent", 20, 1000)).toBe(200);
    expect(computeCouponDiscount("amount", 300, 1000)).toBe(300);
    expect(computeCouponDiscount("amount", 5000, 1000)).toBe(999);
    expect(computeCouponDiscount("percent", 100, 1000)).toBe(999);
    expect(computeCouponDiscount("percent", 10, 0)).toBe(0);
  });
  it("kod normalleşir ve form doğrulanır", () => {
    expect(normalizeCouponCode(" yaz 25 ")).toBe("YAZ25");
    const ok = parseCouponForm({ code: "yaz25", kind: "percent", value: "25" }, ["office"]);
    expect("coupon" in ok).toBe(true);
    for (const bad of [
      { code: "a", kind: "percent", value: "5" },
      { code: "ABC", kind: "percent", value: "150" },
      { code: "ABC", kind: "amount", value: "-4" },
      { code: "ABC", kind: "percent", value: "5", plan_ids: "hack" },
      { code: "ABC", kind: "percent", value: "5", valid_from: "2026-05-02", valid_until: "2026-05-01" },
    ]) {
      expect("error" in parseCouponForm(bad, ["office"]), JSON.stringify(bad)).toBe(true);
    }
  });
});

describe("plan formu", () => {
  const base = PLANS[1]!;
  const form = {
    name: "Ofis", blurb: "x", eyebrow: "Y", monthly_try: "2490", yearly_paid_months: "10",
    seats: "5", branches: "3", features: "a\nb",
  };
  it("geçerli formu kabul eder, negatif/ondalık/aşırı değeri reddeder", () => {
    expect("plan" in parsePlanForm(base, form)).toBe(true);
    for (const patch of [{ monthly_try: "-1" }, { monthly_try: "9.5" }, { monthly_try: "99999999" }, { seats: "0" }, { yearly_paid_months: "13" }, { features: "" }]) {
      expect("error" in parsePlanForm(base, { ...form, ...patch }), JSON.stringify(patch)).toBe(true);
    }
  });
});
