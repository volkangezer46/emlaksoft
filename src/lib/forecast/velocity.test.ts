import { describe, expect, it } from "vitest";
import { salesVelocity, stageConversionPct, stageHistoricalWinRate } from "./velocity";

describe("salesVelocity", () => {
  it("açık × oran × ortalama tutar ÷ döngü; 30 güne ölçeklenir", () => {
    const r = salesVelocity({ openCount: 10, won: 3, lost: 1, wonValue: 3_000_000, avgCycleDays: 30 });
    expect(r.winRate).toBe(0.75);
    expect(r.avgDealValue).toBe(1_000_000);
    expect(r.per30Days).toBe(7_500_000);
  });

  it("az sonuçlanan, açık yok ya da döngü yoksa sayı üretmez", () => {
    expect(salesVelocity({ openCount: 10, won: 1, lost: 1, wonValue: 100, avgCycleDays: 10 }).per30Days).toBeNull();
    expect(salesVelocity({ openCount: 0, won: 3, lost: 1, wonValue: 100, avgCycleDays: 10 }).per30Days).toBeNull();
    expect(salesVelocity({ openCount: 5, won: 3, lost: 1, wonValue: 100, avgCycleDays: null }).per30Days).toBeNull();
    expect(salesVelocity({ openCount: 5, won: 0, lost: 4, wonValue: 0, avgCycleDays: 10 }).perDay).toBeNull();
  });

  it("aynı gün kapanış (0,2 gün) bir güne yuvarlanır (sonsuz hız yok)", () => {
    expect(salesVelocity({ openCount: 1, won: 3, lost: 0, wonValue: 300, avgCycleDays: 0.2 }).per30Days).toBe(3000);
  });
});

describe("aşama oranları", () => {
  it("ilerleme oranı ve tarihsel kazanma oranı", () => {
    expect(stageConversionPct({ advanced: 3, lost: 1 })).toBe(75);
    expect(stageConversionPct({ advanced: 0, lost: 0 })).toBeNull();
    expect(stageHistoricalWinRate({ hist_won: 4, hist_closed: 10 })).toBe(0.4);
    expect(stageHistoricalWinRate({ hist_won: 4, hist_closed: 9 })).toBeNull();
  });
});
