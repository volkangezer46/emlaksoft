import { describe, expect, it } from "vitest";
import { buildProfitLoss, lastMonthKeys } from "./profit-loss";

describe("ofis kâr/zarar", () => {
  it("son 12 ay anahtarları eskiden yeniye", () => {
    const k = lastMonthKeys("2026-02", 3);
    expect(k).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("net = brüt − KDV − ofis dışı paylar − gider; iptal sayılmaz; paylaşımsız komisyon uyarılır", () => {
    const pl = buildProfitLoss(
      ["2026-09", "2026-10"],
      [
        { id: "c1", createdAt: "2026-09-10T10:00:00Z", gross: 120_000, vat: 20_000, status: "paid" },
        { id: "c2", createdAt: "2026-10-02T10:00:00Z", gross: 60_000, vat: 10_000, status: "calculated" },
        { id: "c3", createdAt: "2026-10-03T10:00:00Z", gross: 999_999, vat: 0, status: "cancelled" },
      ],
      [
        { commissionId: "c1", kind: "advisor", amount: 50_000 },
        { commissionId: "c1", kind: "office", amount: 50_000 },
      ],
      [{ date: "2026-09-15", amount: 8_000 }, { date: "2026-08-01", amount: 1 }],
    );
    expect(pl.months[0]).toMatchObject({ key: "2026-09", revenue: 120_000, vat: 20_000, shares: 50_000, expenses: 8_000, net: 42_000 });
    expect(pl.months[1]).toMatchObject({ key: "2026-10", net: 50_000, commissions: 1 });
    expect(pl.unsplitCount).toBe(1);
    expect(pl.totals.net).toBe(92_000);
  });
});
