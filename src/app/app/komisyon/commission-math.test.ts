import { describe, expect, it } from "vitest";
import { statusShares, visibleWidths } from "./commission-math";

describe("commission-math", () => {
  it("yığın yüzdeleri 100'e tamamlanır", () => {
    const s = statusShares(1, 2);
    expect(s.total).toBe(3);
    expect(s.paidPct + s.pendingPct).toBeCloseTo(100, 5);
    expect(s.collectionRate).toBe(33);
  });
  it("toplam 0 iken sahte oran yok", () => {
    const s = statusShares(0, 0);
    expect(s.collectionRate).toBeNull();
    expect(s.paidPct).toBe(0);
    expect(s.pendingPct).toBe(0);
  });
  it("negatif ve NaN tutar 0 sayılır", () => {
    const s = statusShares(NaN, -5);
    expect(s.total).toBe(0);
  });
  it("tamamı tahsil", () => {
    const s = statusShares(500, 0);
    expect(s.paidPct).toBe(100);
    expect(s.pendingPct).toBe(0);
    expect(s.collectionRate).toBe(100);
  });
  it("küçük dilim görünür kalır, toplam ~100", () => {
    const w = visibleWidths([1, 10_000]);
    expect(w[0]).toBeGreaterThan(1.5);
    expect(w[0] + w[1]).toBeCloseTo(100, 0);
    expect(visibleWidths([0, 0])).toEqual([0, 0]);
    expect(visibleWidths([0, 5])[0]).toBe(0);
  });
});
