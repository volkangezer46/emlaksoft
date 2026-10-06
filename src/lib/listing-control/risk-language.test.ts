import { describe, expect, it } from "vitest";
import { bandFromAnomalySeverity, bandFromLeakSeverity, bandFromScore, bandLabel, maxBand } from "./risk-language";
import { leakSeverity } from "./sla-plan";
import { anomalyLostCommission } from "./lost-commission";
import { estimateLostCommission } from "@/lib/leak-shield";
import { detectAdvisorPatterns } from "./advisor-patterns";
import { riskLabel } from "@/components/listing-control/helpers";

describe("tek risk dili", () => {
  it("skor bantları: 90/70/40", () => {
    expect(bandFromScore(95)).toBe("critical");
    expect(bandFromScore(90)).toBe("critical");
    expect(bandFromScore(89)).toBe("high");
    expect(bandFromScore(70)).toBe("high");
    expect(bandFromScore(40)).toBe("medium");
    expect(bandFromScore(39)).toBe("low");
    expect(bandFromScore(null)).toBe("none");
  });
  it("riskLabel ile aynı sonucu verir (iki yerde farklı etiket yok)", () => {
    for (const n of [0, 39, 40, 69, 70, 89, 90, 100, null]) {
      expect(riskLabel(n).level).toBe(bandFromScore(n));
      expect(riskLabel(n).label).toBe(bandLabel(bandFromScore(n)));
    }
  });
  it("anomali şiddeti ve kapanış önemi aynı dört banda eşlenir", () => {
    expect(bandFromAnomalySeverity("info")).toBe("low");
    expect(bandFromAnomalySeverity("critical")).toBe("critical");
    expect(bandFromLeakSeverity(leakSeverity(600_000, 30))).toBe("critical");
    expect(bandFromLeakSeverity(leakSeverity(400_000, 14))).toBe("high");
    expect(bandFromLeakSeverity(leakSeverity(10, 1))).toBe("low");
    expect(bandFromLeakSeverity(null)).toBe("none");
  });
  it("maxBand en yüksek bandı seçer", () => {
    expect(maxBand("low", "high", "medium")).toBe("high");
    expect(maxBand()).toBe("none");
  });
});

describe("tahmini kaçan komisyon (Kalkan ile aynı hesap)", () => {
  it("yalnız potansiyel kayıp işlem için; Kalkan hesabıyla birebir", () => {
    const a = anomalyLostCommission("potential_lost_deal", { listPrice: 3_000_000, commissionRate: 2 });
    const k = estimateLostCommission({ reason: "x", dealHappened: true, closedByUs: false, competitorClosed: false, dealAmount: null, listPrice: 3_000_000, commissionRate: 2 });
    expect(a?.amount).toBe(k.estimatedLostCommission);
    expect(a?.amount).toBe(60_000);
    expect(anomalyLostCommission("price_mismatch", { listPrice: 3_000_000, commissionRate: 2 })).toBeNull();
  });
  it("oran yoksa varsayılan, fiyat yoksa null", () => {
    expect(anomalyLostCommission("potential_lost_deal", { listPrice: 1_000_000, commissionRate: null })?.rate).toBeGreaterThan(0);
    expect(anomalyLostCommission("potential_lost_deal", { listPrice: null, commissionRate: 3 })).toBeNull();
  });
});

describe("danışman örüntüsü", () => {
  const now = 100 * 86_400_000;
  const day = 86_400_000;
  it("30 günde en az 3 farklı portföy", () => {
    const ev = [
      { advisorId: "a", propertyId: "p1", atMs: now - 2 * day },
      { advisorId: "a", propertyId: "p2", atMs: now - 5 * day },
      { advisorId: "a", propertyId: "p3", atMs: now - 9 * day },
      { advisorId: "a", propertyId: "p3", atMs: now - 1 * day },
      { advisorId: "b", propertyId: "p9", atMs: now - 1 * day },
      { advisorId: "b", propertyId: "p9", atMs: now - 2 * day },
      { advisorId: null, propertyId: "p1", atMs: now - day },
    ];
    const r = detectAdvisorPatterns(ev, now);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ advisorId: "a", distinctProperties: 3, events: 4 });
  });
  it("pencere dışı olaylar sayılmaz", () => {
    const ev = [1, 2, 3].map((i) => ({ advisorId: "a", propertyId: `p${i}`, atMs: now - 40 * day }));
    expect(detectAdvisorPatterns(ev, now)).toEqual([]);
  });
});
