import { describe, expect, it } from "vitest";
import { divergingBars, hasNetData, netSeries, shareOfMax, shareOfTotal } from "./report-math";

describe("report-math", () => {
  const months = [
    { label: "Oca", income: 100, expense: 40 },
    { label: "Şub", income: 20, expense: 80 },
    { label: "Mar", income: 0, expense: 0 },
  ];
  it("net = gelir - gider", () => {
    expect(netSeries(months).map((p) => p.net)).toEqual([60, -60, 0]);
  });
  it("sonlu olmayan değer 0 sayılır", () => {
    expect(netSeries([{ label: "x", income: NaN, expense: 5 }])[0].net).toBe(-5);
  });
  it("veri yoksa net görseli yok", () => {
    expect(hasNetData(netSeries([{ label: "a", income: 0, expense: 0 }]))).toBe(false);
    expect(hasNetData(netSeries(months))).toBe(true);
  });
  it("sapma çubukları mutlak büyüğe ölçeklenir, sıfır net çubuksuz", () => {
    const b = divergingBars(netSeries(months));
    expect(b[0].pct).toBe(100);
    expect(b[1].pct).toBe(100);
    expect(b[2].pct).toBe(0);
    expect(divergingBars(netSeries([{ label: "a", income: 0, expense: 0 }]))[0].pct).toBe(0);
  });
  it("shareOfMax", () => {
    expect(shareOfMax(50, 100)).toBe(50);
    expect(shareOfMax(1, 1000)).toBe(3);
    expect(shareOfMax(0, 10)).toBe(0);
    expect(shareOfMax(5, 0)).toBe(0);
  });
  it("shareOfTotal", () => {
    expect(shareOfTotal(1, 3)).toBe(33);
    expect(shareOfTotal(1, 0)).toBe(0);
  });
});
