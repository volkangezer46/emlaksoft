import { describe, expect, it } from "vitest";
import { grantSegments, marginFlow, officeUsageBars, reconTone } from "./viz-model";

describe("ef-kontor viz model", () => {
  it("ofis çubukları: sıralı, ortak ölçek, sınırlı, sıfır çizilmez", () => {
    const offices = [
      { tenantId: "a", units: 10 },
      { tenantId: "b", units: 40 },
      { tenantId: "c", units: 0 },
      { tenantId: "d", units: 20 },
    ];
    const bars = officeUsageBars(offices, { b: "Büyük" }, 2);
    expect(bars.map((b) => b.tenantId)).toEqual(["b", "d"]);
    expect(bars[0]!.pct).toBe(100);
    expect(bars[1]!.pct).toBe(50);
    expect(bars[0]!.label).toBe("Büyük");
    expect(bars[1]!.label).toBe("(adsız ofis)");
  });
  it("harcama yoksa boş", () => {
    expect(officeUsageBars([{ tenantId: "a", units: 0 }], {})).toEqual([]);
  });
  it("marj akışı: maliyet bilinmiyorsa çizilmez", () => {
    expect(marginFlow({ revenueNetKurus: 1000, costKurus: 0, marginKurus: 1000 }, true)).toBeNull();
    expect(marginFlow({ revenueNetKurus: 0, costKurus: 0, marginKurus: 0 }, false)).toBeNull();
  });
  it("marj akışı: gelir -> maliyet -> marj ölçeği", () => {
    const f = marginFlow({ revenueNetKurus: 10000, costKurus: 2500, marginKurus: 7500 }, false)!;
    expect(f.map((b) => b.key)).toEqual(["revenue", "cost", "margin"]);
    expect(f.map((b) => b.pct)).toEqual([100, 25, 75]);
  });
  it("negatif marj mutlak ölçekle kırpılır", () => {
    const f = marginFlow({ revenueNetKurus: 1000, costKurus: 3000, marginKurus: -2000 }, false)!;
    expect(f[2]!.pct).toBeCloseTo(66.7, 1);
  });
  it("plan hakkı dilimleri toplamı ~100", () => {
    const s = grantSegments([
      { kind: "pack", label: "Paket", units: 30 },
      { kind: "plan", label: "Plan", units: 70 },
      { kind: "x", label: "Boş", units: 0 },
    ]);
    expect(s).toHaveLength(2);
    expect(s.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 5);
  });
  it("mutabakat tonu", () => {
    expect(reconTone("ok")).toBe("success");
    expect(reconTone("drift")).toBe("warn");
    expect(reconTone("error")).toBe("danger");
  });
});
