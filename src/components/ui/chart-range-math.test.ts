import { describe, expect, it } from "vitest";
import {
  changePct,
  clampRange,
  dragEdge,
  indexAtFraction,
  isFullRange,
  moveWindow,
  presetsFor,
  rangeForPreset,
  summarizeRange,
} from "./chart-range-math";

describe("chart-range-math", () => {
  it("clampRange sınırlar ve en az 2 nokta bırakır", () => {
    expect(clampRange([-5, 99], 10)).toEqual([0, 9]);
    expect(clampRange([4, 4], 10)).toEqual([4, 5]);
    expect(clampRange([9, 9], 10)).toEqual([8, 9]);
    expect(clampRange([7, 2], 10)).toEqual([2, 7]);
  });

  it("hazır aralıklar yalnız mevcut veriden kısa olanları ve Tümü'yü verir", () => {
    expect(presetsFor(5, "month").map((p) => p.key)).toEqual(["3a", "all"]);
    expect(presetsFor(24, "month").map((p) => p.key)).toEqual(["3a", "6a", "1y", "all"]);
    expect(presetsFor(40, "day").map((p) => p.key)).toEqual(["7g", "30g", "all"]);
    expect(presetsFor(2, "month").map((p) => p.key)).toEqual(["all"]);
  });

  it("rangeForPreset son N noktayı seçer (tahmin kuyruğu dahil)", () => {
    expect(rangeForPreset(12, 3)).toEqual([9, 11]);
    expect(rangeForPreset(14, 6, 11)).toEqual([6, 13]);
    expect(rangeForPreset(12, null)).toEqual([0, 11]);
    expect(isFullRange([0, 11], 12)).toBe(true);
  });

  it("kenar sürükleme karşı kenarı geçemez", () => {
    expect(dragEdge([2, 6], "start", 9, 12)).toEqual([5, 6]);
    expect(dragEdge([2, 6], "end", 0, 12)).toEqual([2, 3]);
    expect(moveWindow([2, 5], 10, 12)).toEqual([8, 11]);
  });

  it("changePct tabanı 0 ise null döner", () => {
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(5, 0)).toBeNull();
  });

  it("toplam özeti önceki aynı uzunluktaki pencereye göre değişimi verir", () => {
    const v = [10, 10, 10, 20, 20, 20];
    const s = summarizeRange(v, [3, 5], "total");
    expect(s.main).toBe(60);
    expect(s.change).toEqual({ pct: 100, basis: "previous" });
    expect(summarizeRange(v, [0, 5], "total").change).toBeNull();
  });

  it("son değer özeti aralık başına göre değişimi verir; null noktaları atlar", () => {
    const s = summarizeRange([100, null, 150, null], [0, 3], "last");
    expect(s.main).toBe(150);
    expect(s.change?.pct).toBe(50);
    expect(summarizeRange([1, 2], [0, 1], "none").main).toBeNull();
    expect(summarizeRange([null, null], [0, 1], "total").main).toBeNull();
  });

  it("indexAtFraction en yakın noktaya yuvarlar", () => {
    expect(indexAtFraction(0.5, 11)).toBe(5);
    expect(indexAtFraction(2, 11)).toBe(10);
    expect(indexAtFraction(0.3, 1)).toBe(0);
  });
});
