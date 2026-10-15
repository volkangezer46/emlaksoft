import { describe, expect, it } from "vitest";
import { buildPipelineForecast, MIN_CLOSED, type ForecastDeal } from "./pipeline";

const NOW = Date.parse("2026-10-07T09:00:00Z");
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function closed(n: number, won: number, type = "sale"): ForecastDeal[] {
  return Array.from({ length: n }, (_, i) => ({
    dealType: type,
    stage: i < won ? "won" : "lost",
    dealValue: 1_000_000,
    createdAt: iso(NOW - 100 * day),
    updatedAt: iso(NOW - 60 * day),
  }));
}

describe("pipeline komisyon tahmini", () => {
  it("yeterli kapanış yoksa tahmin yok", () => {
    const r = buildPipelineForecast(closed(MIN_CLOSED - 1, 5), NOW, 3);
    expect(r.ok).toBe(false);
  });

  it("beklenen = tutar × oran × kazanma oranı; tutarsız ve verisiz tür ayrı sayılır", () => {
    const deals: ForecastDeal[] = [
      ...closed(10, 4),
      { dealType: "sale", stage: "negotiation", dealValue: 5_000_000, createdAt: iso(NOW - 10 * day), updatedAt: iso(NOW - day) },
      { dealType: "sale", stage: "new", dealValue: null, createdAt: iso(NOW - 2 * day), updatedAt: iso(NOW - day) },
      { dealType: "rent", stage: "new", dealValue: 40_000, createdAt: iso(NOW - 2 * day), updatedAt: iso(NOW - day) },
    ];
    const r = buildPipelineForecast(deals, NOW, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 5.000.000 × %3 × 0,4 = 60.000
    expect(r.total).toBe(60_000);
    expect(r.excludedNoValue).toBe(1);
    expect(r.excludedLowData).toBe(1);
    expect(r.medianCycleDays).toBe(40);
    // açılış -10 gün + 40 gün medyan = +30 gün → Kasım
    expect(r.months.find((m) => m.key === "2026-11")?.amount).toBe(60_000);
    expect(r.winRates).toEqual([{ dealType: "sale", rate: 0.4, closed: 10 }]);
  });

  it("SP1: beklenen kapanış tarihi ayı belirler; kapanış anı closedAt'ten okunur", () => {
    const deals: ForecastDeal[] = [
      ...closed(10, 4).map((d) => ({ ...d, closedAt: iso(NOW - 70 * day) })),
      { dealType: "sale", stage: "negotiation", dealValue: 1_000_000, createdAt: iso(NOW - 10 * day), updatedAt: iso(NOW - day), expectedCloseDate: "2026-12-15" },
    ];
    const r = buildPipelineForecast(deals, NOW, 3);
    if (!r.ok) throw new Error("tahmin bekleniyordu");
    expect(r.medianCycleDays).toBe(30);
    expect(r.months.find((m) => m.key === "2026-12")?.amount).toBe(12_000);
  });

  it("SP1: aşamaya özel oran verilirse tür oranının yerine kullanılır", () => {
    const deals: ForecastDeal[] = [
      ...closed(10, 4),
      { dealType: "sale", stage: "negotiation", dealValue: 1_000_000, createdAt: iso(NOW - 10 * day), updatedAt: iso(NOW - day) },
    ];
    const r = buildPipelineForecast(deals, NOW, 3, { negotiation: 0.75 });
    if (!r.ok) throw new Error("tahmin bekleniyordu");
    expect(r.total).toBe(22_500);
    expect(r.stageRateCount).toBe(1);
  });
});
