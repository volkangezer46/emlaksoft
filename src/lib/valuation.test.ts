import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  estimateComparables: vi.fn(),
  endeksaConfigured: vi.fn(),
  endeksaValuation: vi.fn(),
  tapusorConfigured: vi.fn(),
  tapusorInsight: vi.fn(),
}));

vi.mock("@/lib/comparables", () => ({
  estimateFromComparables: mocks.estimateComparables,
}));
vi.mock("@/lib/integrations/endeksa", () => ({
  isEndeksaConfiguredFull: mocks.endeksaConfigured,
  getEndeksaValuation: mocks.endeksaValuation,
}));
vi.mock("@/lib/integrations/tapusor", () => ({
  isTapusorConfiguredFull: mocks.tapusorConfigured,
  getTapusorParcelInsight: mocks.tapusorInsight,
}));

import { estimateMultiSourceValue, valuationEvidenceConfidence } from "./valuation";

describe("professional valuation evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.endeksaConfigured.mockResolvedValue(false);
    mocks.tapusorConfigured.mockResolvedValue(false);
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
    mocks.endeksaConfigured.mockResolvedValue(true);
    mocks.endeksaValuation.mockRejectedValue(new Error("provider detail must not leak"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await estimateMultiSourceValue({
      listPrice: 5_000_000,
      sqm: 100,
      districtHint: "Kadıköy",
      provinceName: "İstanbul",
    });

    expect(result.mid).toBe(5_000_000);
    expect(result.low).toBeNull();
    expect(result.high).toBeNull();
    expect(result.confidence).toBe(0.25);
    expect(result.sources).toContainEqual(expect.objectContaining({
      name: "Kaynak kullanılabilirlik uyarısı",
      weight: 0,
      note: expect.stringContaining("Endeksa verisi alınamadı"),
    }));
    expect(consoleError).toHaveBeenCalledWith("valuation provider unavailable", {
      provider: "endeksa",
      errorType: "Error",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("provider detail must not leak");
  });

  it("preserves legal warnings even when Tapusor returns no investment score", async () => {
    mocks.tapusorConfigured.mockResolvedValue(true);
    mocks.tapusorInsight.mockResolvedValue({
      estimatedValue: 4_800_000,
      investmentScore: null,
      legalFlags: ["İpotek kaydı doğrulanmalı"],
    });

    const result = await estimateMultiSourceValue({
      listPrice: null,
      sqm: 100,
      districtHint: "Kadıköy",
      provinceName: "İstanbul",
    });

    expect(result.sources).toContainEqual({
      name: "Tapusor hukuki/teknik uyarıları",
      weight: 0,
      value: 0,
      note: "İpotek kaydı doğrulanmalı",
    });
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
      hasEndeksa: false,
      hasTapusor: false,
    })).toBe(0);
    expect(valuationEvidenceConfidence({
      hasListPrice: true,
      comparableConfidence: null,
      hasEndeksa: false,
      hasTapusor: false,
    })).toBe(0.25);
    expect(valuationEvidenceConfidence({
      hasListPrice: true,
      comparableConfidence: "yüksek",
      hasEndeksa: false,
      hasTapusor: false,
    })).toBe(0.8);
    expect(valuationEvidenceConfidence({
      hasListPrice: true,
      comparableConfidence: "yüksek",
      hasEndeksa: true,
      hasTapusor: true,
    })).toBe(0.95);
  });
});
