import { describe, expect, it } from "vitest";
import {
  EF_WHOLESALE_DEFAULT,
  computeEfEconomics,
  parseEfWholesale,
  parseWholesaleTl,
  serializeEfWholesale,
  wholesaleUnitCostKurus,
} from "./ef-economics";

describe("ef.wholesale ayarı", () => {
  it("yoksa / bozuksa varsayılan 0/0", () => {
    expect(parseEfWholesale(null)).toEqual(EF_WHOLESALE_DEFAULT);
    expect(parseEfWholesale("{bozuk")).toEqual(EF_WHOLESALE_DEFAULT);
    expect(parseEfWholesale(JSON.stringify({ valuationTl: -1, pdfTl: 0 }))).toEqual(EF_WHOLESALE_DEFAULT);
    expect(EF_WHOLESALE_DEFAULT).toEqual({ valuationTl: 0, pdfTl: 0 });
  });

  it("yazılıp okunur", () => {
    const raw = serializeEfWholesale({ valuationTl: 1.25, pdfTl: 0.5 });
    expect(parseEfWholesale(raw)).toEqual({ valuationTl: 1.25, pdfTl: 0.5 });
  });

  it("sıfır GEÇERLİ giriş; negatif/çok ondalık/harf geçersiz; virgül kabul", () => {
    expect(parseWholesaleTl("0")).toBe(0);
    expect(parseWholesaleTl("1,25")).toBe(1.25);
    expect(parseWholesaleTl("1.234,5")).toBe(1234.5);
    expect(parseWholesaleTl("-1")).toBeNull();
    expect(parseWholesaleTl("1,23456")).toBeNull();
    expect(parseWholesaleTl("abc")).toBeNull();
    expect(parseWholesaleTl("")).toBeNull();
  });
});

describe("computeEfEconomics", () => {
  const usage = [
    { item: "valuation_arsa", units: 5 },
    { item: "valuation_arsa", units: 5 },
    { item: "valuation_konut", units: 5 },
    { item: "pdf_first", units: 2 },
    { item: "report_detail", units: 0 },
    { item: "icat_edilmis", units: 9 },
  ];

  it("maliyet = işlem sayısı × tarife (kontör sayısı değil)", () => {
    const e = computeEfEconomics(usage, { valuationTl: 2, pdfTl: 1 }, 100000);
    expect(e.transactions).toBe(5);
    expect(e.units).toBe(17);
    // 3 değerleme × 2 TL + 1 pdf × 1 TL = 7 TL
    expect(e.costKurus).toBe(700);
    expect(e.marginKurus).toBe(100000 - 700);
    expect(e.unknownItems).toBe(1);
  });

  it("varsayılan 0/0 tarifede maliyet 0, marj = gelir", () => {
    const e = computeEfEconomics(usage, EF_WHOLESALE_DEFAULT, 50000);
    expect(e.costKurus).toBe(0);
    expect(e.marginKurus).toBe(50000);
  });

  it("harcanan kontör başına ortalama gelir; harcama yoksa null", () => {
    expect(computeEfEconomics(usage, EF_WHOLESALE_DEFAULT, 17000).revenuePerSpentUnitKurus).toBe(1000);
    expect(computeEfEconomics([], EF_WHOLESALE_DEFAULT, 17000).revenuePerSpentUnitKurus).toBeNull();
  });

  it("gelir yokken maliyet negatif marj üretir", () => {
    const e = computeEfEconomics(usage, { valuationTl: 1, pdfTl: 0 }, 0);
    expect(e.marginKurus).toBe(-300);
  });

  it("rapor detayının toptan maliyeti yok", () => {
    expect(wholesaleUnitCostKurus("report_detail", { valuationTl: 9, pdfTl: 9 })).toBe(0);
  });
});
