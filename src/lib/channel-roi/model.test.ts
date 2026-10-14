import { describe, expect, it } from "vitest";
import { adsSpendByMonth, computeChannelRoi, istMonth, parseRoiPeriod, parseSpendAmount, parseSpendMonth, roiWindow } from "./model";

const NOW = Date.parse("2026-10-14T09:00:00Z");

describe("roiWindow", () => {
  it("son N ayı İstanbul takvimiyle verir (bu ay dahil)", () => {
    const w = roiWindow(NOW, 3);
    expect(w.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(w.startDay).toBe("2026-08-01");
    // 1 Ağustos 00:00 İstanbul = 31 Temmuz 21:00 UTC
    expect(w.startIso).toBe("2026-07-31T21:00:00.000Z");
  });
  it("yıl geçişi", () => {
    expect(roiWindow(Date.parse("2026-01-10T00:00:00Z"), 2).months).toEqual(["2025-12", "2026-01"]);
  });
  it("ay sınırında İstanbul saati esas", () => {
    expect(istMonth(Date.parse("2026-09-30T22:30:00Z"))).toBe("2026-10");
  });
});

describe("computeChannelRoi", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const base = {
    months,
    nowMs: NOW,
    spend: [
      { month: "2026-09", channel: "paid_search" as const, amount: 1000, source: "google_ads" as const },
      { month: "2026-09", channel: "paid_search" as const, amount: 500, source: "manual" as const },
      { month: "2026-10", channel: "social" as const, amount: 300, source: "manual" as const },
      // dönem dışı: sayılmaz
      { month: "2026-07", channel: "social" as const, amount: 9999, source: "manual" as const },
    ],
    signups: [
      { tenantId: "a", channel: "paid_search" as const, attributed: true, createdAt: "2026-09-05T10:00:00Z" },
      { tenantId: "b", channel: "paid_search" as const, attributed: true, createdAt: "2026-09-06T10:00:00Z" },
      { tenantId: "c", channel: "paid_search" as const, attributed: true, createdAt: "2026-10-01T10:00:00Z" },
      { tenantId: "d", channel: null, attributed: false, createdAt: "2026-10-02T10:00:00Z" },
      { tenantId: "e", channel: null, attributed: true, createdAt: "2026-10-03T10:00:00Z" },
      // dönem dışı kayıt
      { tenantId: "z", channel: "social" as const, attributed: true, createdAt: "2026-06-01T10:00:00Z" },
    ],
    payments: [
      { tenantId: "a", paidAt: "2026-09-14T10:00:00Z", net: 1000 },
      { tenantId: "a", paidAt: "2026-10-14T08:00:00Z", net: 1000 },
      { tenantId: "b", paidAt: "2026-10-10T10:00:00Z", net: 500 },
      { tenantId: "z", paidAt: "2026-07-01T10:00:00Z", net: 7000 },
    ],
    refunds: [{ tenantId: "b", net: 100 }],
  };

  it("harcama, kayıt, ödeyen, gelir, CAC ve geri ödeme", () => {
    const { rows, total } = computeChannelRoi(base);
    const paid = rows.find((r) => r.channel === "paid_search")!;
    expect(paid.spend).toBe(1500);
    expect(paid.spendAds).toBe(1000);
    expect(paid.spendManual).toBe(500);
    expect(paid.signups).toBe(3);
    expect(paid.payers).toBe(2);
    expect(paid.revenue).toBe(2400); // 2000 + (500 - 100)
    expect(paid.cac).toBe(750);
    expect(paid.costPerSignup).toBe(500);
    expect(paid.conversion).toBeCloseTo(2 / 3);
    expect(paid.roas).toBeCloseTo(1.6);
    // a: 2000 / 1 ay (30 gün) = 2000; b: 400 / 1 = 400 → ortalama 1200; 750 / 1200 = 0.6
    expect(paid.paybackMonths).toBe(0.6);

    const social = rows.find((r) => r.channel === "social")!;
    expect(social.spend).toBe(300);
    expect(social.signups).toBe(0);
    expect(social.cac).toBeNull();
    expect(social.paybackMonths).toBeNull();

    expect(rows.find((r) => r.channel === "bilinmiyor")?.signups).toBe(1);
    expect(rows.find((r) => r.channel === "unknown")?.signups).toBe(1);
    expect(rows[rows.length - 1].channel).toBe("bilinmiyor");

    expect(total.spend).toBe(1800);
    expect(total.signups).toBe(5);
    expect(total.payers).toBe(2);
    expect(total.revenue).toBe(2400);
    expect(total.cac).toBe(900);
  });

  it("veri yoksa satır yok, toplam sıfır ve oranlar boş", () => {
    const { rows, total } = computeChannelRoi({ months, nowMs: NOW, spend: [], signups: [], payments: [], refunds: [] });
    expect(rows).toEqual([]);
    expect(total.spend).toBe(0);
    expect(total.cac).toBeNull();
    expect(total.roas).toBeNull();
    expect(total.conversion).toBeNull();
  });

  it("iade geliri sıfırın altına indirmez", () => {
    const { rows } = computeChannelRoi({
      months,
      nowMs: NOW,
      spend: [],
      signups: [{ tenantId: "x", channel: "email", attributed: true, createdAt: "2026-10-01T10:00:00Z" }],
      payments: [{ tenantId: "x", paidAt: "2026-10-02T10:00:00Z", net: 100 }],
      refunds: [{ tenantId: "x", net: 300 }],
    });
    expect(rows[0].revenue).toBe(0);
    expect(rows[0].payers).toBe(1);
  });
});

describe("adsSpendByMonth", () => {
  it("mikro birimi TL'ye çevirir ve aya toplar", () => {
    const out = adsSpendByMonth(
      [
        { day: "2026-09-01", cost_micros: 1_500_000 },
        { day: "2026-09-30", cost_micros: 2_000_000 },
        { day: "2026-05-01", cost_micros: 9_000_000 },
      ],
      ["2026-09", "2026-10"],
    );
    expect(out).toEqual([{ month: "2026-09", channel: "paid_search", amount: 3.5, source: "google_ads" }]);
  });
});

describe("form ayrıştırıcıları", () => {
  it("ay", () => {
    expect(parseSpendMonth("2026-09")).toBe("2026-09-01");
    expect(parseSpendMonth("2026-13")).toBeNull();
    expect(parseSpendMonth("09-2026")).toBeNull();
  });
  it("tutar", () => {
    expect(parseSpendAmount("12.500,50")).toBe(12500.5);
    expect(parseSpendAmount("12.500")).toBe(12500);
    expect(parseSpendAmount("12500.5")).toBe(12500.5);
    expect(parseSpendAmount("₺ 750")).toBe(750);
    expect(parseSpendAmount("-5")).toBeNull();
    expect(parseSpendAmount("abc")).toBeNull();
    expect(parseSpendAmount("")).toBeNull();
  });
  it("dönem", () => {
    expect(parseRoiPeriod("12")).toBe(12);
    expect(parseRoiPeriod("7")).toBe(6);
    expect(parseRoiPeriod(undefined)).toBe(6);
  });
});
