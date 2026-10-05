import { describe, expect, it } from "vitest";
import { RECOMMENDED_CATALOG_OVERRIDES, applyPlanOverrides } from "@/lib/billing/plan-overrides";
import { evaluateSeatChange, resolveSeatPeriod } from "@/lib/billing/seat-purchase-core";

const plans = applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES);
const HALF = { periodStartMs: 0, periodEndMs: 1000, nowMs: 500 };
const base = { plans, planId: "office", cycle: "monthly" as const, usedSeats: 4, currentTotalSeats: 5, ...HALF };

describe("evaluateSeatChange", () => {
  it("artışta kalan süre oranında anlık tutar çıkarır", () => {
    const r = evaluateSeatChange({ ...base, targetTotalSeats: 7 });
    expect(r.status).toBe("increase");
    expect(r.toQuote.extraSeats).toBe(2);
    expect(r.immediateChargeTry).toBe(Math.round(r.toQuote.extraMonthlyTry * 0.5 * 100) / 100);
    expect(r.effectiveAtPeriodEnd).toBe(false);
  });

  it("azaltmada dönem sonu, iade yok", () => {
    const r = evaluateSeatChange({ ...base, currentTotalSeats: 9, usedSeats: 3, targetTotalSeats: 7 });
    expect(r.status).toBe("decrease");
    expect(r.immediateChargeTry).toBe(0);
    expect(r.effectiveAtPeriodEnd).toBe(true);
    expect(r.message).toMatch(/İade ve kredi yoktur/);
  });

  it("kullanılan koltuktan aza inilemez", () => {
    const r = evaluateSeatChange({ ...base, currentTotalSeats: 9, usedSeats: 8, targetTotalSeats: 7 });
    expect(r.status).toBe("below_used");
    expect(r.minTotalSeats).toBe(8);
  });

  it("dahil koltuğun altına inilemez", () => {
    const r = evaluateSeatChange({ ...base, usedSeats: 1, targetTotalSeats: 3 });
    expect(r.status).toBe("below_included");
  });

  it("azami koltuk aşılırsa bize ulaşın", () => {
    const capped = plans.map((p) => (p.id === "office" ? { ...p, maxSeats: 12 } : p));
    const r = evaluateSeatChange({ ...base, plans: capped, targetTotalSeats: 13 });
    expect(r.status).toBe("over_max");
    expect(r.message).toMatch(/bize ulaşın/);
  });

  it("kilitli taban fiyat kullanılır", () => {
    const r = evaluateSeatChange({ ...base, targetTotalSeats: 6, locks: { baseMonthlyTry: 1990 } });
    expect(r.toQuote.baseMonthlyTry).toBe(1990);
    expect(r.fromQuote.baseMonthlyTry).toBe(1990);
  });

  it("kilitli kademeler liste kademelerini ezer", () => {
    const r = evaluateSeatChange({
      ...base,
      targetTotalSeats: 6,
      locks: { tiers: [{ fromSeat: 1, toSeat: null, monthlyTry: 100 }] },
    });
    expect(r.toQuote.extraMonthlyTry).toBe(100);
  });

  it("dönem yoksa TR takvim ayına düşer", () => {
    const p = resolveSeatPeriod(Date.UTC(2026, 9, 15), null, null);
    expect(p.endMs).toBeGreaterThan(p.startMs);
  });
});
