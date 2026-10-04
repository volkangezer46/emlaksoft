import { describe, expect, it } from "vitest";
import {
  applyPlanOverrides,
  diffAgainstDefault,
  parsePlanOverrides,
  sanitizePlanOverride,
  serializePlanOverrides,
} from "./plan-overrides";
import { PLANS, planAmountOf } from "./plans";

describe("plan overrides", () => {
  it("kayıt yoksa veya bozuksa varsayılan katalog döner", () => {
    expect(applyPlanOverrides(parsePlanOverrides(null))).toEqual([...PLANS]);
    expect(applyPlanOverrides(parsePlanOverrides("{bozuk"))).toEqual([...PLANS]);
  });

  it("fiyat ve limit düzenlemesini bindirir, diğer alanları korur", () => {
    const raw = serializePlanOverrides({ office: { monthlyTry: 2990, limits: { seats: 8 } } });
    const defs = applyPlanOverrides(parsePlanOverrides(raw));
    const office = defs.find((p) => p.id === "office")!;
    expect(office.monthlyTry).toBe(2990);
    expect(office.limits.seats).toBe(8);
    expect(office.limits.branches).toBe(3);
    expect(office.name).toBe("Ofis");
    expect(planAmountOf(office, "yearly")).toBe(Math.round(2990 * 12 * 0.8));
  });

  it("negatif, ondalık ve aşırı değerleri reddeder", () => {
    expect(sanitizePlanOverride({ monthlyTry: -5 })).toEqual({});
    expect(sanitizePlanOverride({ monthlyTry: 10.5 })).toEqual({});
    expect(sanitizePlanOverride({ monthlyTry: 5_000_000 })).toEqual({});
    expect(sanitizePlanOverride({ limits: { seats: null, customers: 0 } })).toEqual({});
  });

  it("aynı anda tek popüler paket bırakır", () => {
    const defs = applyPlanOverrides({ advisor: { popular: true } });
    expect(defs.filter((p) => p.popular)).toHaveLength(1);
  });

  it("varsayılanla aynı düzenleme boş fark üretir", () => {
    expect(diffAgainstDefault(PLANS[0]!, PLANS[0]!)).toEqual({});
  });
});
