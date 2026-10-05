import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  estimateComparables: vi.fn(),
  endeksForPlace: vi.fn(),
}));

vi.mock("@/lib/comparables", () => ({
  estimateFromComparables: mocks.estimateComparables,
}));
vi.mock("@/lib/integrations/emlakfiyati/client", () => ({
  getEndeksForPlace: mocks.endeksForPlace,
}));

import { estimateMultiSourceValue, valuationEvidenceConfidence } from "./valuation";

const summary = (over: Record<string, unknown> = {}) => ({
  path: "istanbul/kadikoy",
  ad: "Kadıköy",
  level: 2,
  tip: "konut",
  donem: "2026-10-01",
  n: 110,
  medianM2: 185_417,
  p25: 142_557,
  p75: 219_833,
  medianPrice: 20_000_000,
  monthlyChange: 1.2,
  yearlyChange: null,
  guven: "high",
  insufficient: false,
  trend: [],
  ...over,
});

describe("professional valuation evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.endeksForPlace.mockResolvedValue({ status: "disabled", requestedPath: null });
    mocks.estimateComparables.mockResolvedValue({
      estimatedValue: null,
      confidence: "yetersiz",
      spreadPct: null,
      compCount: 0,
      wonCount: 0,
      medianSqmPrice: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps an optional provider outage visible in the durable source record", async () => {
    mocks.endeksForPlace.mockResolvedValue({ status: "error", requestedPath: "istanbul/kadikoy" });

    const result = await estimateMultiSourceValue({
      listPrice: 5_000_000,
      sqm: 100,
      districtHint: "Kadıköy",
      provinceName: "İstanbul",
      propertyType: "Daire",
      transactionType: "Satılık",
    });

    expect(result.mid).toBe(5_000_000);
    expect(result.low).toBeNull();
    expect(result.high).toBeNull();
    expect(result.confidence).toBe(0.25);
    expect(result.sources).toContainEqual(expect.objectContaining({
      name: "Kaynak kullanılabilirlik uyarısı",
      weight: 0,
      note: expect.stringContaining("EmlakFiyati verisi alınamadı"),
    }));
  });

  it("uses the EmlakFiyati index as a weighted market source (median TL/m2 x sqm)", async () => {
    mocks.endeksForPlace.mockResolvedValue({ status: "ok", summary: summary(), requestedPath: "istanbul/kadikoy" });

    const result = await estimateMultiSourceValue({
      listPrice: null,
      sqm: 100,
      districtHint: "Kadıköy",
      provinceName: "İstanbul",
      propertyType: "Daire",
      transactionType: "Satılık",
    });

    expect(mocks.endeksForPlace).toHaveBeenCalledWith({
      province: "İstanbul",
      district: "Kadıköy",
      neighborhood: undefined,
      tip: "konut",
    });
    expect(result.sources).toContainEqual(expect.objectContaining({
      name: "EmlakFiyati endeksi",
      weight: 0.4,
      value: 18_541_700,
    }));
    expect(result.mid).toBe(18_541_700);
    expect(result.confidence).toBe(0.35);
  });

  it("lowers weight and says so when the sample is insufficient", async () => {
    mocks.endeksForPlace.mockResolvedValue({
      status: "ok",
      summary: summary({ insufficient: true, guven: "low", n: 2 }),
      requestedPath: "istanbul/kadikoy",
    });

    const result = await estimateMultiSourceValue({
      listPrice: 5_000_000,
      sqm: 100,
      districtHint: "Kadıköy",
      provinceName: "İstanbul",
      propertyType: "Daire",
      transactionType: "Satılık",
    });

    const source = result.sources.find((s) => s.name === "EmlakFiyati endeksi");
    expect(source?.weight).toBe(0.08);
    expect(source?.note).toContain("örneklem yetersiz");
    // yetersiz örneklem kanıt sayılmaz: yalnız liste fiyatı skoru
    expect(result.confidence).toBe(0.25);
  });

  it("does not call EmlakFiyati for unsupported types or rentals (no invented data)", async () => {
    await estimateMultiSourceValue({
      listPrice: 5_000_000, sqm: 100, districtHint: "Kadıköy", provinceName: "İstanbul",
      propertyType: "İşyeri", transactionType: "Satılık",
    });
    await estimateMultiSourceValue({
      listPrice: 5_000_000, sqm: 100, districtHint: "Kadıköy", provinceName: "İstanbul",
      propertyType: "Daire", transactionType: "Kiralık",
    });
    expect(mocks.endeksForPlace).not.toHaveBeenCalled();
  });

  it("does not label an intentionally unconfigured optional provider as an outage", async () => {
    const result = await estimateMultiSourceValue({
      listPrice: 5_000_000,
      sqm: 100,
      districtHint: "Kadıköy",
      provinceName: "İstanbul",
    });

    expect(result.sources.some((source) => source.name === "Kaynak kullanılabilirlik uyarısı")).toBe(false);
  });

  it("scores actual evidence instead of treating every source count equally", () => {
    expect(valuationEvidenceConfidence({
      hasListPrice: false,
      comparableConfidence: null,
      marketIndex: "none",
    })).toBe(0);
    expect(valuationEvidenceConfidence({
      hasListPrice: true,
      comparableConfidence: null,
      marketIndex: "none",
    })).toBe(0.25);
    expect(valuationEvidenceConfidence({
      hasListPrice: true,
      comparableConfidence: "yüksek",
      marketIndex: "none",
    })).toBe(0.8);
    expect(valuationEvidenceConfidence({
      hasListPrice: true,
      comparableConfidence: "yüksek",
      marketIndex: "high",
    })).toBe(0.95);
    expect(valuationEvidenceConfidence({
      hasListPrice: true,
      comparableConfidence: null,
      marketIndex: "medium",
    })).toBe(0.4);
  });
});
