import { describe, expect, it } from "vitest";
import {
  barsGeometry,
  bucketCountFor,
  bucketDates,
  computeTrend,
  hasSeries,
  parsePeriod,
  periodHref,
  sparkPath,
  summarizeSeries,
} from "./premium-math";

describe("sparkPath", () => {
  it("2'den az nokta için null (uydurma çizim yok)", () => {
    expect(sparkPath([])).toBeNull();
    expect(sparkPath([5])).toBeNull();
    expect(sparkPath([NaN, 3])).toBeNull();
  });
  it("en büyük değer en küçük y'yi alır ve alan tabana kapanır", () => {
    const p = sparkPath([0, 10], { width: 100, height: 40, padding: 4 })!;
    expect(p.coords[0]).toEqual({ x: 0, y: 36 });
    expect(p.coords[1]).toEqual({ x: 100, y: 4 });
    expect(p.line.startsWith("M0,36 C50,36 50,4 100,4")).toBe(true);
    expect(p.area.endsWith("L100,40 L0,40 Z")).toBe(true);
    expect(p.flat).toBe(false);
  });
  it("eğri kontrol noktaları uç noktaların y'sini kullanır (aşma yok)", () => {
    const p = sparkPath([1, 9, 2, 8, 3])!;
    const ys = p.coords.map((c) => c.y);
    const nums = [...p.line.matchAll(/C([\d.]+),([\d.]+) ([\d.]+),([\d.]+)/g)];
    expect(nums).toHaveLength(4);
    nums.forEach((m, i) => {
      expect(Number(m[2])).toBe(ys[i]);
      expect(Number(m[4])).toBe(ys[i + 1]);
    });
  });
  it("düz seri dikey ortaya oturur", () => {
    const p = sparkPath([0, 0, 0], { height: 40 })!;
    expect(p.flat).toBe(true);
    expect(new Set(p.coords.map((c) => c.y))).toEqual(new Set([20]));
  });
  it("hasSeries", () => {
    expect(hasSeries([1, 2])).toBe(true);
    expect(hasSeries([1])).toBe(false);
    expect(hasSeries(undefined)).toBe(false);
  });
});

describe("barsGeometry", () => {
  it("null: tek nokta", () => expect(barsGeometry([3])).toBeNull());
  it("en yüksek çubuk tam yükseklik; son çubuk işaretli; sıfır taban çizgisi", () => {
    const b = barsGeometry([0, 5, 10], { width: 30, height: 20, gap: 0 })!;
    expect(b[2].h).toBe(20);
    expect(b[2].last).toBe(true);
    expect(b[0].h).toBe(1.5);
    expect(b[0].y).toBe(18.5);
    expect(b[1].h).toBe(10);
  });
  it("hepsi sıfır: yükseklik uydurulmaz", () => {
    const b = barsGeometry([0, 0, 0])!;
    expect(b.every((x) => x.h === 1.5)).toBe(true);
  });
});

describe("computeTrend", () => {
  it("artış / azalış / eşit", () => {
    expect(computeTrend(12, 10)).toMatchObject({ dir: "up", label: "%20", good: true });
    expect(computeTrend(0, 4)).toMatchObject({ dir: "down", label: "%100", good: false });
    expect(computeTrend(5, 5)).toMatchObject({ dir: "flat", label: "%0", good: null });
  });
  it("invert: artış kötü", () => {
    expect(computeTrend(12, 10, true)).toMatchObject({ dir: "up", good: false });
    expect(computeTrend(8, 10, true)).toMatchObject({ dir: "down", good: true });
  });
  it("önceki 0: sahte yüzde yok", () => {
    expect(computeTrend(3, 0)).toMatchObject({ dir: "new", label: "yeni", pct: null });
    expect(computeTrend(0, 0)).toMatchObject({ dir: "flat", label: "%0" });
  });
  it("büyük değerler kırpılır, sonsuz güvenli", () => {
    expect(computeTrend(100000, 1).label).toBe("%999+");
    expect(computeTrend(Infinity, 1).label).toBe("—");
  });
});

describe("dönem", () => {
  it("parsePeriod yalnız 7/30/90 kabul eder", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod("15")).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
    expect(parsePeriod(["7", "30"])).toBe(7);
  });
  it("periodHref diğer paramları korur, varsayılanda donem düşer", () => {
    expect(periodHref("/app", {}, 30)).toBe("/app");
    expect(periodHref("/app", {}, 7)).toBe("/app?donem=7");
    expect(periodHref("/app", { tv: "1", donem: "90" }, 7)).toBe("/app?tv=1&donem=7");
    expect(periodHref("/app", { x: undefined }, 30)).toBe("/app");
  });
  it("bucketCountFor", () => {
    expect([7, 30, 90].map((p) => bucketCountFor(p as 7 | 30 | 90))).toEqual([7, 10, 9]);
  });
});

describe("bucketDates", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 9, 3, 12);
  it("pencerede eşit kovalara böler, dışarıyı atar", () => {
    const iso = (ago: number) => new Date(now - ago).toISOString();
    const out = bucketDates([iso(1000), iso(DAY + 1000), iso(6.5 * DAY), iso(8 * DAY), "geçersiz"], now, 7, 7);
    expect(out).toEqual([1, 0, 0, 0, 0, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("summarizeSeries", () => {
  it("özet cümlesi", () => {
    expect(summarizeSeries([0, 5, 3])).toBe("Son 3 nokta: en düşük 0, en yüksek 5, son 3");
    expect(summarizeSeries([])).toBe("Veri yok");
  });
});
