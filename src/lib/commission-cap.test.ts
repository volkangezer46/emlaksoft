import { describe, expect, it } from "vitest";
import { checkCommissionCap, computeCapNet, roundKurus, suggestCommissionSplit } from "./commission-cap";

describe("computeCapNet", () => {
  it("satışta varsayılan %4", () => expect(computeCapNet("sale", 1_000_000)).toBe(40_000));
  it("kirada 1 aylık kira", () => expect(computeCapNet("rent", 25_000)).toBe(25_000));
  it("parametreler geçersiz kılınır", () => {
    expect(computeCapNet("sale", 1_000_000, { saleCapRate: 3 })).toBe(30_000);
    expect(computeCapNet("rent", 10_000, { rentCapMonths: 2 })).toBe(20_000);
  });
  it("uç değerler 0", () => {
    expect(computeCapNet("sale", -1)).toBe(0);
    expect(computeCapNet("sale", NaN)).toBe(0);
    expect(computeCapNet("sale", 100, { saleCapRate: -1 })).toBe(0);
  });
});

describe("checkCommissionCap", () => {
  it("oran tavan içinde: aşmaz", () => {
    const r = checkCommissionCap({ kind: "sale", amount: 1_000_000, commissionRate: 3 });
    expect(r.valid).toBe(true);
    expect(r.exceeds).toBe(false);
    expect(r.excessNet).toBe(0);
  });
  it("tam tavanda aşmaz, nearCap true", () => {
    const r = checkCommissionCap({ kind: "sale", amount: 1_000_000, commissionRate: 4 });
    expect(r.exceeds).toBe(false);
    expect(r.nearCap).toBe(true);
  });
  it("oran tavanı aşar", () => {
    const r = checkCommissionCap({ kind: "sale", amount: 1_000_000, commissionRate: 5 });
    expect(r.exceeds).toBe(true);
    expect(r.excessNet).toBe(10_000);
    expect(r.excessGross).toBe(12_000);
    expect(r.capGross).toBe(48_000);
    expect(r.requestedRatePct).toBe(5);
  });
  it("KDV dahil tutar KDV hariça çevrilir", () => {
    // 48.000 KDV dahil = 40.000 hariç => tavanda
    const r = checkCommissionCap({ kind: "sale", amount: 1_000_000, commissionAmount: 48_000, vatIncluded: true });
    expect(r.requestedNet).toBe(40_000);
    expect(r.exceeds).toBe(false);
    const r2 = checkCommissionCap({ kind: "sale", amount: 1_000_000, commissionAmount: 48_000 });
    expect(r2.exceeds).toBe(true);
    expect(r2.excessNet).toBe(8_000);
  });
  it("KDV oranı parametre", () => {
    const r = checkCommissionCap({
      kind: "sale", amount: 1_000_000, commissionAmount: 44_000, vatIncluded: true, vatRate: 10,
    });
    expect(r.requestedNet).toBe(40_000);
    expect(r.capGross).toBe(44_000);
  });
  it("kira: 1 aydan fazlası aşar", () => {
    const r = checkCommissionCap({ kind: "rent", amount: 20_000, commissionAmount: 30_000 });
    expect(r.exceeds).toBe(true);
    expect(r.excessNet).toBe(10_000);
  });
  it("tutar orana göre önceliklidir", () => {
    const r = checkCommissionCap({ kind: "sale", amount: 1_000_000, commissionRate: 9, commissionAmount: 10_000 });
    expect(r.exceeds).toBe(false);
  });
  it("kuruşa yuvarlar", () => {
    const r = checkCommissionCap({ kind: "sale", amount: 333_333.33, commissionRate: 4.1234 });
    expect(r.requestedNet).toBe(Math.round(r.requestedNet * 100) / 100);
    expect(r.excessNet).toBe(Math.round(r.excessNet * 100) / 100);
  });
  it("sıfır, negatif ve NaN geçersiz", () => {
    for (const amount of [0, -5, NaN, Infinity]) {
      const r = checkCommissionCap({ kind: "sale", amount, commissionRate: 3 });
      expect(r.valid).toBe(false);
      expect(r.exceeds).toBe(false);
      expect(r.reason).toBeTruthy();
    }
    expect(checkCommissionCap({ kind: "sale", amount: 100, commissionRate: -1 }).valid).toBe(false);
    expect(checkCommissionCap({ kind: "sale", amount: 100, commissionRate: NaN }).valid).toBe(false);
    expect(checkCommissionCap({ kind: "sale", amount: 100, commissionAmount: -1 }).valid).toBe(false);
    expect(checkCommissionCap({ kind: "sale", amount: 100 }).valid).toBe(false);
    expect(checkCommissionCap({ kind: "sale", amount: 100, commissionRate: 1, vatRate: NaN }).valid).toBe(false);
    expect(checkCommissionCap({ kind: "sale", amount: 100, commissionRate: 1, saleCapRate: 0 }).valid).toBe(false);
  });
  it("sıfır komisyon geçerli ve aşmaz", () => {
    const r = checkCommissionCap({ kind: "sale", amount: 100, commissionRate: 0 });
    expect(r.valid).toBe(true);
    expect(r.exceeds).toBe(false);
  });
});

describe("suggestCommissionSplit", () => {
  it("%2+%2 bölüşüm (4 tavan)", () => {
    const s = suggestCommissionSplit(40_000);
    expect(s.buyerNet).toBe(20_000);
    expect(s.sellerNet).toBe(20_000);
    expect(s.buyerGross).toBe(24_000);
    expect(s.sellerGross).toBe(24_000);
  });
  it("tek kuruş farkı satıcıya, toplam korunur", () => {
    const s = suggestCommissionSplit(0.05);
    expect(roundKurus(s.buyerNet + s.sellerNet)).toBe(0.05);
  });
  it("özel pay ve KDV", () => {
    const s = suggestCommissionSplit(1000, { buyerSharePct: 25, vatRate: 10 });
    expect(s.buyerNet).toBe(250);
    expect(s.sellerNet).toBe(750);
    expect(s.sellerVat).toBe(75);
  });
  it("uç değerlerde sıfır / varsayılana düşer", () => {
    expect(suggestCommissionSplit(NaN).totalNet).toBe(0);
    expect(suggestCommissionSplit(-10).totalNet).toBe(0);
    expect(suggestCommissionSplit(100, { buyerSharePct: 150 }).buyerNet).toBe(50);
  });
});
