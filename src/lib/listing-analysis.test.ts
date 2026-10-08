import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CACHE_MS,
  analysisIdempotencyKey,
  analysisInputKey,
  computeListingAnalysis,
  isAnalysisFresh,
  roundNicePrice,
  type AnalysisEstimate,
  type AnalysisInput,
} from "./listing-analysis";

const EST: AnalysisEstimate = {
  estimatedValue: 5_000_000,
  lowValue: 4_700_000,
  highValue: 5_300_000,
  medianSqmPrice: 50_000,
  compCount: 9,
  wonCount: 4,
  activeCount: 5,
  confidence: "orta",
};

function input(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    listPrice: 6_000_000,
    sqm: 100,
    estimate: EST,
    efIndex: null,
    regionAvgDaysListed: 60,
    daysOnMarket: 100,
    isRent: false,
    quality: {
      title: "Kadıköy Satılık 3+1 Daire 120 m²",
      description: "x".repeat(250),
      features: { rooms: "3+1", sqm: 100, floor: 3, heating: "Kombi", building_age: 5, facade: "Güney" },
      hasLocation: true,
      hasVirtualTour: false,
      photo: { photoCount: 8, warned: 0, passed: 4, warnings: [] },
    },
    ...over,
  };
}

describe("computeListingAnalysis", () => {
  it("emsal yoksa null (kontör düşmez)", () => {
    expect(computeListingAnalysis(input({ estimate: { ...EST, confidence: "yetersiz" } }))).toBeNull();
    expect(computeListingAnalysis(input({ estimate: { ...EST, estimatedValue: null } }))).toBeNull();
    expect(computeListingAnalysis(input({ estimate: { ...EST, compCount: 0 } }))).toBeNull();
    expect(computeListingAnalysis(input({ listPrice: null }))).toBeNull();
    expect(computeListingAnalysis(input({ listPrice: 0 }))).toBeNull();
  });

  it("piyasa üstü: sapma, m² fiyatı ve tahmin etiketli revizyon", () => {
    const r = computeListingAnalysis(input())!;
    expect(r.position).toEqual({ deviationPct: 20, verdict: "piyasa üstü" });
    expect(r.listSqmPrice).toBe(60_000);
    expect(r.sqmGapPct).toBe(20);
    expect(r.revision).toMatchObject({ suggestedPrice: 5_000_000, label: "Tahmin", ceilingPrice: 5_300_000 });
    expect(r.revision!.reducePct).toBeCloseTo(16.7, 1);
  });

  it("revizyon yalnız emsal güveni orta/yüksekse; düşükte not", () => {
    const r = computeListingAnalysis(input({ estimate: { ...EST, confidence: "düşük" } }))!;
    expect(r.revision).toBeNull();
    expect(r.revisionNote).toMatch(/emsal sayısı az/i);
  });

  it("piyasa seviyesinde ve altında revizyon önerilmez", () => {
    const eq = computeListingAnalysis(input({ listPrice: 5_100_000 }))!;
    expect(eq.position.verdict).toBe("piyasa seviyesinde");
    expect(eq.revision).toBeNull();
    const low = computeListingAnalysis(input({ listPrice: 4_000_000 }))!;
    expect(low.position.verdict).toBe("piyasa altı");
    expect(low.revision).toBeNull();
  });

  it("m² yoksa m² fiyatı ve sapması null", () => {
    const r = computeListingAnalysis(input({ sqm: null }))!;
    expect(r.listSqmPrice).toBeNull();
    expect(r.sqmGapPct).toBeNull();
  });

  it("bölge hız notu ve EmlakFiyati endeks sapması yalnız veri varsa", () => {
    const r = computeListingAnalysis(input({ efIndex: { ad: "Kadıköy", donem: "2026-09-01", n: 120, medianM2: 48_000, guven: "yuksek" } }))!;
    expect(r.efIndex?.gapPct).toBe(25);
    expect(r.market.note).toMatch(/belirgin üzerinde/);
    const none = computeListingAnalysis(input({ regionAvgDaysListed: null }))!;
    expect(none.market.note).toBeNull();
    expect(none.efIndex).toBeNull();
  });

  it("kontrol listesi: eksik açıklama, özellik ve foto uyarı verir", () => {
    const r = computeListingAnalysis(
      input({
        quality: { title: "kısa", description: null, features: { rooms: "3+1" }, hasLocation: false, hasVirtualTour: false, photo: { photoCount: 2, warned: 1, passed: 0, warnings: ["Fotoğraf sayısı"] } },
      }),
    )!;
    const by = Object.fromEntries(r.checklist.map((c) => [c.id, c.status]));
    expect(by).toMatchObject({ photos: "warn", title: "warn", description: "warn", features: "warn", location: "warn", tour: "na" });
    const ok = computeListingAnalysis(input())!;
    expect(ok.checklist.filter((c) => c.status === "warn")).toHaveLength(0);
  });

  it("foto okunamadıysa 'na' (uydurma yok)", () => {
    const r = computeListingAnalysis(input({ quality: { ...input().quality, photo: null } }))!;
    expect(r.checklist.find((c) => c.id === "photos")?.status).toBe("na");
  });
});

describe("önbellek ve idempotency", () => {
  it("24 saat penceresi", () => {
    expect(isAnalysisFresh(1000, 1000 + ANALYSIS_CACHE_MS - 1)).toBe(true);
    expect(isAnalysisFresh(1000, 1000 + ANALYSIS_CACHE_MS)).toBe(false);
    expect(isAnalysisFresh(Number.NaN, 5)).toBe(false);
    expect(isAnalysisFresh(2000, 1000)).toBe(false);
  });
  it("girdi anahtarı fiyat/m²/bölge değişince değişir", () => {
    const a = analysisInputKey({ listPrice: 1, sqm: 2, districtId: "d", propertyType: "Daire", transactionType: "Satılık" });
    expect(analysisInputKey({ listPrice: 1, sqm: 2, districtId: "d", propertyType: "Daire", transactionType: "Satılık" })).toBe(a);
    expect(analysisInputKey({ listPrice: 2, sqm: 2, districtId: "d", propertyType: "Daire", transactionType: "Satılık" })).not.toBe(a);
  });
  it("idempotency anahtarı cüzdan biçimine uyar ve pencere içinde sabit", () => {
    const k1 = analysisIdempotencyKey("11111111-1111-4111-8111-111111111111", "x|1", 1_000);
    expect(k1).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
    expect(analysisIdempotencyKey("11111111-1111-4111-8111-111111111111", "x|1", 2_000)).toBe(k1);
    expect(analysisIdempotencyKey("11111111-1111-4111-8111-111111111111", "x|1", 1_000 + ANALYSIS_CACHE_MS)).not.toBe(k1);
  });
  it("öneri fiyatı okunur basamağa yuvarlanır", () => {
    expect(roundNicePrice(5_012_345, false)).toBe(5_000_000);
    expect(roundNicePrice(24_730, true)).toBe(24_750);
  });
});
