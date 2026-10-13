import { describe, expect, it } from "vitest";
import {
  EDGES,
  METRICS,
  THRESHOLDS,
  bucketOf,
  formatMetric,
  goodShare,
  percentileFromHistogram,
  sentenceFor,
  verdictOf,
} from "./vitals";

describe("vitals: kova", () => {
  it("Google eşikleri her metrikte kova sınırıdır (iyi oranı tam hesaplanır)", () => {
    for (const m of METRICS) {
      expect(EDGES[m]).toContain(THRESHOLDS[m].good);
      expect(EDGES[m]).toContain(THRESHOLDS[m].poor);
      expect(EDGES[m].length).toBeLessThanOrEqual(31); // smallint 0..31 kısıtı
      expect([...EDGES[m]].sort((a, b) => a - b)).toEqual([...EDGES[m]]);
    }
  });

  it("sınır değeri kendi kovasına (dahil) düşer, aşan sonraki kovaya", () => {
    expect(bucketOf("LCP", 0)).toBe(0);
    expect(bucketOf("LCP", 500)).toBe(0);
    expect(bucketOf("LCP", 501)).toBe(1);
    expect(bucketOf("LCP", 2500)).toBe(EDGES.LCP.indexOf(2500));
    expect(bucketOf("LCP", 25_000)).toBe(EDGES.LCP.length); // açık uçlu son kova
    expect(bucketOf("CLS", 0.1)).toBe(EDGES.CLS.indexOf(0.1));
    expect(bucketOf("CLS", 0.11)).toBe(EDGES.CLS.indexOf(0.1) + 1);
    expect(bucketOf("INP", 200)).toBe(EDGES.INP.indexOf(200));
  });

  it("geçersiz/uydurma değer kovaya girmez", () => {
    expect(bucketOf("LCP", -1)).toBeNull();
    expect(bucketOf("LCP", Number.NaN)).toBeNull();
    expect(bucketOf("LCP", 500_000)).toBeNull();
    expect(bucketOf("CLS", 99)).toBeNull();
  });
});

describe("vitals: p75 ve iyi oranı", () => {
  it("örnek yoksa null (sıfır uydurulmaz)", () => {
    expect(percentileFromHistogram("LCP", [])).toBeNull();
    expect(goodShare("LCP", [])).toBeNull();
    expect(percentileFromHistogram("LCP", [{ bucket: 2, n: 0 }])).toBeNull();
  });

  it("tek kova: kova içinde doğrusal ara değer", () => {
    // 4 örnek, hepsi 1000..1500 kovasında: p75 hedefi 3 → kovanın %75'i → 1375
    const p = percentileFromHistogram("LCP", [{ bucket: 2, n: 4 }]);
    expect(p).toEqual({ value: 1375, open: false, samples: 4 });
  });

  it("çok kova: birikimli dağılım", () => {
    // 50 örnek ≤500, 30 örnek 2000..2500, 20 örnek 4000..5000 → p75 hedefi 75: ikinci grupta (25/30)
    const h = new Map([
      [0, 50],
      [EDGES.LCP.indexOf(2500), 30],
      [EDGES.LCP.indexOf(5000), 20],
    ]);
    const p = percentileFromHistogram("LCP", h)!;
    expect(p.samples).toBe(100);
    expect(p.value).toBe(Math.round(2000 + 500 * (25 / 30)));
    expect(verdictOf("LCP", p.value)).toBe("iyi");
    expect(goodShare("LCP", h)).toBeCloseTo(0.8);
  });

  it("p75 açık uçlu kovaya düşerse alt sınır ve open=true", () => {
    const p = percentileFromHistogram("INP", [{ bucket: EDGES.INP.length, n: 10 }])!;
    expect(p.open).toBe(true);
    expect(p.value).toBe(EDGES.INP[EDGES.INP.length - 1]);
    expect(verdictOf("INP", p.value)).toBe("kotu");
  });

  it("aynı kovanın tekrarları birleşir; bozuk satırlar atlanır", () => {
    const p = percentileFromHistogram("CLS", [
      { bucket: 0, n: 2 },
      { bucket: 0, n: 2 },
      { bucket: -1, n: 5 },
      { bucket: 3, n: Number.NaN },
    ])!;
    expect(p.samples).toBe(4);
    expect(p.value).toBeLessThanOrEqual(0.01);
  });

  it("eşik sınıfları ve Türkçe tek cümle", () => {
    expect(verdictOf("LCP", 2500)).toBe("iyi");
    expect(verdictOf("LCP", 3000)).toBe("gelistirilmeli");
    expect(verdictOf("LCP", 4001)).toBe("kotu");
    expect(formatMetric("LCP", 2100)).toBe("2,1 sn");
    expect(formatMetric("INP", 180)).toBe("180 ms");
    expect(formatMetric("CLS", 0.05)).toBe("0,05");
    expect(sentenceFor("LCP", { value: 2100, open: false, samples: 10 }, "mobile")).toBe("Telefonda sayfalarınız 2,1 sn'de açılıyor — iyi");
    expect(sentenceFor("CLS", { value: 0.3, open: false, samples: 10 }, "desktop")).toContain("kayıyor");
    expect(sentenceFor("LCP", { value: 20000, open: true, samples: 3 })).toContain("en az");
  });
});
