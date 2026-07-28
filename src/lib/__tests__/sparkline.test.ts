import { describe, expect, it } from "vitest";
import { sparklineGeometry, trendPercent } from "@/lib/sparkline";

describe("sparklineGeometry", () => {
  it("artan seride son nokta en yukarida, ilk nokta en asagida olur", () => {
    const g = sparklineGeometry([0, 1, 2, 3], { width: 100, height: 28, padding: 2 });
    expect(g.coords).toHaveLength(4);
    expect(g.coords[0]!.x).toBe(0);
    expect(g.coords[3]!.x).toBe(100);
    // y ekseni asagi dogru: en buyuk deger en kucuk y
    expect(g.coords[3]!.y).toBeLessThan(g.coords[0]!.y);
    expect(g.coords[3]!.y).toBe(2); // padding kadar tepeden
    expect(g.coords[0]!.y).toBe(26); // height - padding
    expect(g.flat).toBe(false);
    expect(g.last).toEqual(g.coords[3]);
  });

  it("tum degerler esitse duz kabul eder ve cizgiyi dikey ortalar", () => {
    const g = sparklineGeometry([5, 5, 5], { height: 28, padding: 2 });
    expect(g.flat).toBe(true);
    expect(g.coords.every((c) => c.y === 14)).toBe(true);
  });

  it("bos dizi ve tek eleman coksmez; tek eleman yatayda ortalanir", () => {
    const bos = sparklineGeometry([]);
    expect(bos.coords).toHaveLength(1);
    expect(bos.flat).toBe(true);

    const tek = sparklineGeometry([42], { width: 100 });
    expect(tek.coords).toHaveLength(1);
    expect(tek.coords[0]!.x).toBe(50);
  });

  it("negatif degerleri min-max araliginda normalize eder", () => {
    const g = sparklineGeometry([-10, 0, 10], { height: 28, padding: 2 });
    expect(g.coords[0]!.y).toBe(26); // min -> taban
    expect(g.coords[1]!.y).toBe(14); // orta
    expect(g.coords[2]!.y).toBe(2); // max -> tepe
  });

  it("area tabana kapanan poligon uretir, points polyline formatindadir", () => {
    const g = sparklineGeometry([1, 2], { width: 100, height: 28, padding: 2 });
    expect(g.points).toBe("0,26 100,2");
    expect(g.area).toBe("0,28 0,26 100,2 100,28");
  });

  it("NaN/Infinity degerlerini eleyip kalan seriyi cizer", () => {
    const g = sparklineGeometry([1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(g.coords).toHaveLength(2);
    expect(g.flat).toBe(false);
  });
});

describe("trendPercent", () => {
  it("artis ve azalis yuzdesini yuvarlayarak dondurur", () => {
    expect(trendPercent(120, 100)).toBe(20);
    expect(trendPercent(80, 100)).toBe(-20);
    expect(trendPercent(100, 100)).toBe(0);
  });

  it("onceki donem 0 ise null doner (sahte yuzde uretme)", () => {
    expect(trendPercent(10, 0)).toBeNull();
    expect(trendPercent(0, 0)).toBeNull();
  });

  it("gecersiz sayilarda null doner", () => {
    expect(trendPercent(Number.NaN, 10)).toBeNull();
    expect(trendPercent(10, Number.NaN)).toBeNull();
  });
});
