import { describe, it, expect } from "vitest";
import { diagnoseSaleBlockers, isDiagnosable, type SaleDiagnosticsInput } from "./sale-diagnostics";

const healthy: SaleDiagnosticsInput = {
  status: "live",
  daysOnMarket: 10,
  priceHealth: "green",
  priceDeltaPct: 2,
  totalViews: 40,
  views7d: 12,
  livePortals: 2,
  mediaCount: 10,
  transactionType: "sale",
};

describe("isDiagnosable", () => {
  it("yalnızca live/active için true", () => {
    expect(isDiagnosable("live")).toBe(true);
    expect(isDiagnosable("active")).toBe(true);
    expect(isDiagnosable("sold")).toBe(false);
    expect(isDiagnosable("draft")).toBe(false);
    expect(isDiagnosable("archived")).toBe(false);
  });
});

describe("diagnoseSaleBlockers", () => {
  it("sağlıklı ilan: blocker yok, healthy, yüksek skor", () => {
    const d = diagnoseSaleBlockers(healthy);
    expect(d.blockers).toHaveLength(0);
    expect(d.verdict).toBe("healthy");
    expect(d.score).toBe(100);
    expect(d.positives.length).toBeGreaterThan(0);
  });

  it("portalsız + az foto + kırmızı fiyat: birden çok kritik, at_risk", () => {
    const d = diagnoseSaleBlockers({
      ...healthy,
      priceHealth: "red",
      priceDeltaPct: 35,
      livePortals: 0,
      mediaCount: 1,
    });
    const criticals = d.blockers.filter((b) => b.severity === "critical");
    expect(criticals.map((b) => b.key)).toEqual(
      expect.arrayContaining(["price_red", "no_portal", "few_photos"]),
    );
    expect(d.verdict).toBe("at_risk");
    expect(d.score).toBeLessThan(45);
  });

  it("kritikler uyarılardan önce sıralanır", () => {
    const d = diagnoseSaleBlockers({
      ...healthy,
      priceHealth: "yellow", // warning
      livePortals: 0, // critical
      mediaCount: 6, // warning
    });
    const firstWarningIdx = d.blockers.findIndex((b) => b.severity === "warning");
    const lastCriticalIdx = [...d.blockers].map((b) => b.severity).lastIndexOf("critical");
    expect(lastCriticalIdx).toBeLessThan(firstWarningIdx);
  });

  it("uzun süre piyasada + düşük görüntülenme uyarıları tetiklenir", () => {
    const d = diagnoseSaleBlockers({
      ...healthy,
      daysOnMarket: 120,
      totalViews: 10, // ~0.08/gün
      views7d: 0,
    });
    const keys = d.blockers.map((b) => b.key);
    expect(keys).toEqual(expect.arrayContaining(["stale_90", "low_views", "no_recent_views"]));
  });

  it("kiralık ilanda metin 'kiralanamıyor' kullanır", () => {
    const d = diagnoseSaleBlockers({ ...healthy, daysOnMarket: 100, transactionType: "rent" });
    const stale = d.blockers.find((b) => b.key === "stale_90");
    expect(stale?.detail).toContain("kiralanamıyor");
  });
});
