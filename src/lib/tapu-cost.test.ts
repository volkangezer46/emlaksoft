import { describe, expect, it } from "vitest";
import { computeTapuCost } from "./tapu-cost";

describe("computeTapuCost", () => {
  it("alıcı + satıcı harcı parametrik", () => {
    const r = computeTapuCost({ declaredValue: 2_000_000, buyerRatePct: 2, sellerRatePct: 2 });
    expect(r.valid).toBe(true);
    expect(r.buyerFee).toBe(40_000);
    expect(r.sellerFee).toBe(40_000);
    expect(r.totalFee).toBe(80_000);
    expect(r.base).toBe(2_000_000);
    expect(r.underDeclared).toBe(false);
    expect(r.warning).toBeNull();
  });
  it("taraflar farklı oran", () => {
    const r = computeTapuCost({ declaredValue: 1_000_000, buyerRatePct: 1.5, sellerRatePct: 0.5 });
    expect(r.buyerFee).toBe(15_000);
    expect(r.sellerFee).toBe(5_000);
  });
  it("sıfır oran geçerli", () => {
    const r = computeTapuCost({ declaredValue: 1000, buyerRatePct: 0, sellerRatePct: 0 });
    expect(r.valid).toBe(true);
    expect(r.totalFee).toBe(0);
  });
  it("düşük beyan uyarısı", () => {
    const r = computeTapuCost({
      declaredValue: 1_000_000, buyerRatePct: 2, sellerRatePct: 2, appraisedValue: 2_000_000,
    });
    expect(r.underDeclared).toBe(true);
    expect(r.declaredToAppraisedPct).toBe(50);
    expect(r.valueGap).toBe(1_000_000);
    expect(r.warning).toContain("mevzuat");
  });
  it("eşikte uyarı yok, eşik parametre", () => {
    const base = { declaredValue: 900_000, buyerRatePct: 2, sellerRatePct: 2, appraisedValue: 1_000_000 };
    expect(computeTapuCost(base).underDeclared).toBe(false);
    expect(computeTapuCost({ ...base, thresholdPct: 95 }).underDeclared).toBe(true);
  });
  it("beyan rayiçten yüksekse uyarı yok", () => {
    const r = computeTapuCost({
      declaredValue: 3_000_000, buyerRatePct: 2, sellerRatePct: 2, appraisedValue: 2_000_000,
    });
    expect(r.underDeclared).toBe(false);
    expect(r.valueGap).toBe(0);
  });
  it("rayiç 0 yok sayılır", () => {
    const r = computeTapuCost({ declaredValue: 100, buyerRatePct: 2, sellerRatePct: 2, appraisedValue: 0 });
    expect(r.valid).toBe(true);
    expect(r.declaredToAppraisedPct).toBeNull();
  });
  it("kuruşa yuvarlar", () => {
    const r = computeTapuCost({ declaredValue: 123_456.78, buyerRatePct: 1.234, sellerRatePct: 2.345 });
    expect(r.buyerFee).toBe(Math.round(r.buyerFee * 100) / 100);
    expect(r.totalFee).toBe(Math.round(r.totalFee * 100) / 100);
  });
  it("geçersiz girdiler", () => {
    const ok = { declaredValue: 100, buyerRatePct: 2, sellerRatePct: 2 };
    expect(computeTapuCost({ ...ok, declaredValue: 0 }).valid).toBe(false);
    expect(computeTapuCost({ ...ok, declaredValue: -1 }).valid).toBe(false);
    expect(computeTapuCost({ ...ok, declaredValue: NaN }).valid).toBe(false);
    expect(computeTapuCost({ ...ok, buyerRatePct: -1 }).valid).toBe(false);
    expect(computeTapuCost({ ...ok, sellerRatePct: NaN }).valid).toBe(false);
    expect(computeTapuCost({ ...ok, appraisedValue: -5 }).valid).toBe(false);
    expect(computeTapuCost({ ...ok, thresholdPct: 120 }).valid).toBe(false);
  });
});
