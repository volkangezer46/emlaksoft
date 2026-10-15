import { describe, expect, it } from "vitest";
import { incomeSourceMix, pctChange, shiftMonth, yearOverYear } from "./profitability";

describe("shiftMonth / pctChange", () => {
  it("ay kaydırma yıl sınırını geçer", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", -12)).toBe("2025-10");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-03", -27)).toBe("2023-12");
  });
  it("yüzde değişim; taban 0 null, eksi tabanda mutlak değer", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(100, -100)).toBe(200);
  });
});

describe("yearOverYear", () => {
  const rows = [
    { month: "2025-09-01", income: 100, expense: 60 },
    { month: "2025-10-01", income: 200, expense: 100 },
    { month: "2026-01-01", income: 50, expense: 10 },
    { month: "2026-09-01", income: 150, expense: 50 },
    { month: "2026-10-01", income: 80, expense: 40 },
  ];

  it("her ayı geçen yılın aynı ayıyla eşler, içinde bulunulan ay kısmidir", () => {
    const r = yearOverYear(rows, "2026-10", 2);
    expect(r.hasPrevYear).toBe(true);
    expect(r.months).toEqual([
      expect.objectContaining({ key: "2026-09", income: 150, prevIncome: 100, net: 100, prevNet: 40, incomeChange: 50, netChange: 150, partial: false }),
      expect.objectContaining({ key: "2026-10", income: 80, prevIncome: 200, incomeChange: -60, partial: true }),
    ]);
  });

  it("yılbaşından bugüne toplamları karşılaştırır", () => {
    const r = yearOverYear(rows, "2026-10", 12);
    expect(r.months).toHaveLength(12);
    expect(r.months[0]!.key).toBe("2025-11");
    expect(r.ytd).toMatchObject({ income: 280, expense: 100, net: 180, prevIncome: 300, prevExpense: 160, prevNet: 140 });
    expect(r.ytd.incomeChange).toBe(-6.7);
  });

  it("geçen yıl verisi yoksa hasPrevYear false", () => {
    const r = yearOverYear([{ month: "2026-10-01", income: 5, expense: 1 }], "2026-10", 3);
    expect(r.hasPrevYear).toBe(false);
    expect(r.months[2]!.incomeChange).toBeNull();
  });
});

describe("incomeSourceMix", () => {
  it("kaynakları toplar, sıralar, paylar ve kuyruğu birleştirir", () => {
    const mix = incomeSourceMix(
      [
        { month: "2026-09", income: 0, expense: 0, incomeByCategory: { komisyon: 600, kira_yonetimi: 100, hizmet: 50 } },
        { month: "2026-10", income: 0, expense: 0, incomeByCategory: { komisyon: 200, danismanlik: 50, eksi: -10 } },
      ],
      { top: 2 },
    );
    expect(mix).toEqual([
      { key: "komisyon", total: 800, share: 80 },
      { key: "kira_yonetimi", total: 100, share: 10 },
      { key: "__diger", total: 100, share: 10 },
    ]);
  });
  it("gelir yoksa boş", () => expect(incomeSourceMix([{ month: "2026-10", income: 0, expense: 0 }])).toEqual([]));
});
