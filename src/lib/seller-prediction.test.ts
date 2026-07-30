import { describe, it, expect } from "vitest";
import { scoreSellerLikelihood, isOwnerCustomer, hasListingIntent, type SellerSignals } from "./seller-prediction";

const base: SellerSignals = {
  isOwnerType: true,
  daysSinceContact: 120,
  tenureDays: 400,
  pastWonDeals: 0,
  hasListingIntentDemand: false,
};

describe("isOwnerCustomer", () => {
  it("malik / mülk sahibi / owner değerlerini tanır", () => {
    expect(isOwnerCustomer(["Malik"])).toBe(true);
    expect(isOwnerCustomer(["mülk sahibi"])).toBe(true);
    expect(isOwnerCustomer(["owner"])).toBe(true);
    expect(isOwnerCustomer(["Alıcı"])).toBe(false);
    expect(isOwnerCustomer(null)).toBe(false);
  });
});

describe("hasListingIntent", () => {
  it("açık + satış niyetli talebi yakalar", () => {
    expect(hasListingIntent([{ status: "new", demand_type: "Satılık portföy" }])).toBe(true);
    expect(hasListingIntent([{ status: "matched", transaction_type: "satilik" }])).toBe(true);
  });
  it("kapalı ya da alış talebini saymaz", () => {
    expect(hasListingIntent([{ status: "closed", demand_type: "satılık" }])).toBe(false);
    expect(hasListingIntent([{ status: "new", demand_type: "kiralık arıyor" }])).toBe(false);
  });
});

describe("scoreSellerLikelihood", () => {
  it("açık listeleme talebi + malik + olgun temas = yüksek", () => {
    const r = scoreSellerLikelihood({ ...base, hasListingIntentDemand: true, pastWonDeals: 1 });
    expect(r.tier).toBe("high");
    expect(r.score).toBeGreaterThanOrEqual(62);
    expect(r.reasons).toContain("Açık satış/listeleme talebi");
  });

  it("malik değil + hiç sinyal yok = düşük", () => {
    const r = scoreSellerLikelihood({ isOwnerType: false, daysSinceContact: null, tenureDays: 10, pastWonDeals: 0, hasListingIntentDemand: false });
    expect(r.tier).toBe("low");
    expect(r.score).toBeLessThan(34);
  });

  it("dormancy olgunluk penceresi (60–90g) çok yeni temastan yüksek puan verir", () => {
    const olgun = scoreSellerLikelihood({ ...base, daysSinceContact: 75 }).score;
    const cokYeni = scoreSellerLikelihood({ ...base, daysSinceContact: 5 }).score;
    expect(olgun).toBeGreaterThan(cokYeni);
  });

  it("skor 0..100 aralığında kalır", () => {
    const maks = scoreSellerLikelihood({ isOwnerType: true, daysSinceContact: 75, tenureDays: 1000, pastWonDeals: 9, hasListingIntentDemand: true });
    expect(maks.score).toBeLessThanOrEqual(100);
    expect(maks.score).toBeGreaterThanOrEqual(0);
  });

  it("geçmiş anlaşma tavanı: 2 ile 20 aynı puan", () => {
    const iki = scoreSellerLikelihood({ ...base, pastWonDeals: 2 }).score;
    const yirmi = scoreSellerLikelihood({ ...base, pastWonDeals: 20 }).score;
    expect(iki).toBe(yirmi);
  });
});
