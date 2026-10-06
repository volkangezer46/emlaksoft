import { describe, expect, it } from "vitest";
import { categoryChartMode, categoryShares } from "./expense-category-chart";

describe("gider kategori grafiği", () => {
  it("7+ dilimde pasta kullanılmaz", () => {
    expect(categoryChartMode(6)).toBe("donut");
    expect(categoryChartMode(7)).toBe("bars");
    expect(categoryChartMode(0)).toBe("donut");
  });
  it("sıralar, pay ve çubuk genişliği hesaplar", () => {
    const r = categoryShares([
      { label: "A", total: 25 },
      { label: "B", total: 75 },
    ]);
    expect(r.map((x) => x.label)).toEqual(["B", "A"]);
    expect(r.map((x) => x.share)).toEqual([75, 25]);
    expect(r[0]!.barPct).toBe(100);
    expect(r[1]!.barPct).toBeCloseTo(100 / 3, 5);
  });
  it("negatif/NaN sıfır sayılır", () => {
    const r = categoryShares([{ total: -4 }, { total: Number.NaN }]);
    expect(r.every((x) => x.share === 0 && x.barPct === 0)).toBe(true);
  });
});
