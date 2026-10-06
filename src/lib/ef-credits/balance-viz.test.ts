import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { balanceSeries, forecastDepletion, stackedBalance, thresholdTopPct } from "./balance-viz";

const NOW = Date.parse("2026-10-15T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("stackedBalance", () => {
  it("oranlar toplamı 100 ve toplam 0 ise null", () => {
    const s = stackedBalance({ available: 60, reserved: 10, spent: 30 })!;
    expect(s.total).toBe(100);
    expect(s.segments.map((x) => x.pct)).toEqual([60, 10, 30]);
    expect(stackedBalance({ available: 0, reserved: 0, spent: 0 })).toBeNull();
  });
  it("negatif ve NaN yok sayılır", () => {
    const s = stackedBalance({ available: -5, reserved: Number.NaN, spent: 10 })!;
    expect(s.segments.map((x) => x.value)).toEqual([0, 0, 10]);
  });
});

describe("balanceSeries", () => {
  it("eskiden yeniye sıralar, balanceAfter null olanı atar", () => {
    const r = balanceSeries([
      { at: iso(NOW), units: -1, balanceAfter: 8 },
      { at: iso(NOW - DAY_MS), units: -1, balanceAfter: 9 },
      { at: iso(NOW - 2 * DAY_MS), units: 10, balanceAfter: null },
    ]);
    expect(r.values).toEqual([9, 8]);
  });
});

describe("thresholdTopPct", () => {
  it("serinin üstündeki eşik çizilmez", () => {
    expect(thresholdTopPct(50, 40)).toBeNull();
    expect(thresholdTopPct(0, 40)).toBeNull();
    expect(thresholdTopPct(20, 40)!).toBeGreaterThan(thresholdTopPct(40, 40)!);
  });
});

describe("forecastDepletion", () => {
  const spend = (daysAgo: number, u = -2) => ({ at: iso(NOW - daysAgo * DAY_MS), units: u, balanceAfter: null });
  it("yetersiz geçmişte tahmin yok", () => {
    expect(forecastDepletion([spend(1), spend(2), spend(3)], 50, NOW)).toBeNull();
    expect(forecastDepletion([spend(1), spend(2), spend(3), spend(4), spend(5)], 50, NOW)).toBeNull();
  });
  it("yeterli geçmişte hız ve gün hesaplanır", () => {
    const rows = [spend(28), spend(21), spend(14), spend(7), spend(1)];
    const f = forecastDepletion(rows, 50, NOW)!;
    expect(f.burnPerDay).toBeCloseTo(10 / 28, 5);
    expect(f.daysLeft).toBe(Math.floor(50 / (10 / 28)));
    expect(f.dateMs).toBe(NOW + f.daysLeft * DAY_MS);
  });
  it("bakiye 0 ise ve 60 günden eski harcama sayılmazsa null", () => {
    const rows = [spend(28), spend(21), spend(14), spend(7), spend(1)];
    expect(forecastDepletion(rows, 0, NOW)).toBeNull();
    expect(forecastDepletion(rows.map((_, i) => spend(70 + i)), 50, NOW)).toBeNull();
  });
});
