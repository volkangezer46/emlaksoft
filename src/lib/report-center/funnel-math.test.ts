import { describe, expect, it } from "vitest";
import { funnelSteps, pct, sourceRoi, weakestStep } from "./funnel-math";

describe("funnelSteps", () => {
  it("basamak ve genel oranlar; düşen kayıt sayısı", () => {
    const steps = funnelSteps({ customers: 200, appointments: 80, offers: 20, won: 5 });
    expect(steps.map((s) => s.stepPct)).toEqual([null, 40, 25, 25]);
    expect(steps.map((s) => s.overallPct)).toEqual([100, 40, 10, 2.5]);
    expect(steps.map((s) => s.dropped)).toEqual([0, 120, 60, 15]);
  });

  it("boş kohortta oranlar null (sahte %0 yok)", () => {
    const steps = funnelSteps({ customers: 0, appointments: 0, offers: 0, won: 0 });
    expect(steps.every((s) => s.stepPct === null && s.overallPct === null)).toBe(true);
    expect(weakestStep(steps)).toBeNull();
  });

  it("en zayıf geçiş en düşük basamak oranıdır", () => {
    expect(weakestStep(funnelSteps({ customers: 100, appointments: 10, offers: 8, won: 4 }))?.key).toBe("appointments");
  });
});

describe("sourceRoi", () => {
  it("maliyet yoksa oranlar null; varsa yuvarlanır", () => {
    expect(sourceRoi({ customers: 10, won: 1, cost: null, commission: 5000 })).toEqual({ costPerCustomer: null, costPerWon: null, roiMultiple: null });
    expect(sourceRoi({ customers: 10, won: 2, cost: 3000, commission: 9600 })).toEqual({ costPerCustomer: 300, costPerWon: 1500, roiMultiple: 3.2 });
    expect(sourceRoi({ customers: 0, won: 0, cost: 3000, commission: null })).toEqual({ costPerCustomer: null, costPerWon: null, roiMultiple: null });
  });

  it("pct sıfıra bölmez", () => {
    expect(pct(1, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33.3);
  });
});
