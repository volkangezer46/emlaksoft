import { describe, expect, it } from "vitest";
import { DEFAULT_LISTING_CONTROL_CONFIG, normalizeListingControlConfig } from "./config";
import { colorForScore, computeHealthScore, freshnessValue, priceConsistencyValue, type HealthInputs } from "./health-score";
import { computeRiskScore, type RiskInputs } from "./risk-score";

const allOne: HealthInputs = {
  onPortal: 1, price: 1, advisor: 1, authority: 1, photos: 1, freshness: 1, idUrlValid: 1, contact: 1, eids: 1, checkRecency: 1,
};

describe("risk skoru", () => {
  const cfg = DEFAULT_LISTING_CONTROL_CONFIG;
  it("plan örneği: 30 + 30 + 20 + 7 + 0 = 87", () => {
    const input: RiskInputs = {
      checkState: "confirmed_missing",
      hasCrmClosure: false,
      explained: false,
      hoursUnexplained: 10, // ≥ ilk SLA saati → yoğunluk 1
      priceDeviationRatio: 0.01 + 0.7 * (0.05 - 0.01), // yoğunluk 0.7
      authorityDaysLeft: 100,
    };
    const r = computeRiskScore(input, cfg);
    expect(r.score).toBe(87);
    expect(r.points.find((p) => p.key === "price_changed")?.points).toBe(7);
    expect(r.points.map((p) => p.key)).toEqual(["portal_missing", "no_crm_action", "no_explanation", "price_changed", "authority_expired"]);
  });

  it("yalnız şüpheli: 0.15 × 30 = 4.5 → 5; açıklama/CRM bileşeni yok", () => {
    const r = computeRiskScore({ checkState: "suspect", hasCrmClosure: false, explained: false, hoursUnexplained: 0, priceDeviationRatio: null, authorityDaysLeft: null }, cfg);
    expect(r.score).toBe(5);
  });

  it("açıklama girilince açıklama bileşeni sıfırlanır; CRM kapanışı varsa 'işlem yok' sıfır", () => {
    const r = computeRiskScore({ checkState: "confirmed_missing", hasCrmClosure: true, explained: true, hoursUnexplained: 50, priceDeviationRatio: null, authorityDaysLeft: null }, cfg);
    expect(r.score).toBe(30);
  });

  it("100'ü aşmaz ve ağırlıklar ayarlanabilir", () => {
    const heavy = normalizeListingControlConfig({ riskWeights: { portalMissing: 100, noCrmAction: 100, noExplanation: 100, priceChanged: 100, authorityExpired: 100 } });
    const r = computeRiskScore({ checkState: "confirmed_missing", hasCrmClosure: false, explained: false, hoursUnexplained: 99, priceDeviationRatio: 1, authorityDaysLeft: -3 }, heavy);
    expect(r.score).toBe(100);
    const light = normalizeListingControlConfig({ riskWeights: { portalMissing: 10 } });
    expect(computeRiskScore({ checkState: "confirmed_missing", hasCrmClosure: true, explained: true, hoursUnexplained: 0, priceDeviationRatio: null, authorityDaysLeft: null }, light).score).toBe(10);
  });

  it("yetki: bitmiş 1.0, 15 gün içinde 0.5", () => {
    const base = { checkState: "verified" as const, hasCrmClosure: false, explained: false, hoursUnexplained: 0, priceDeviationRatio: null };
    expect(computeRiskScore({ ...base, authorityDaysLeft: -1 }, cfg).score).toBe(10);
    expect(computeRiskScore({ ...base, authorityDaysLeft: 10 }, cfg).score).toBe(5);
    expect(computeRiskScore({ ...base, authorityDaysLeft: 40 }, cfg).score).toBe(0);
  });
});

describe("sağlık skoru", () => {
  it("varsayılan ağırlıklar toplam 100; hepsi 1 → 100 yeşil", () => {
    const sum = Object.values(DEFAULT_LISTING_CONTROL_CONFIG.healthWeights).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    const r = computeHealthScore(allOne);
    expect(r.score).toBe(100);
    expect(r.color).toBe("green");
    expect(r.partial).toBe(false);
  });

  it("ölçülemeyen bileşen paydadan çıkar (cezalandırmaz) ve partial=true", () => {
    const r = computeHealthScore({ ...allOne, photos: null, eids: null });
    expect(r.score).toBe(100);
    expect(r.partial).toBe(true);
    expect(r.components.find((c) => c.key === "photos")?.value).toBeNull();
  });

  it("hiçbir şey ölçülemezse skor null ve renk gri", () => {
    const none: HealthInputs = { onPortal: null, price: null, advisor: null, authority: null, photos: null, freshness: null, idUrlValid: null, contact: null, eids: null, checkRecency: null };
    const r = computeHealthScore(none);
    expect(r.score).toBeNull();
    expect(r.color).toBe("gray");
  });

  it("renk eşikleri: ≥85 yeşil, 60-84 sarı, 40-59 turuncu, <40 kırmızı", () => {
    const c = DEFAULT_LISTING_CONTROL_CONFIG.healthColors;
    expect([85, 84, 60, 59, 40, 39].map((s) => colorForScore(s, c))).toEqual(["green", "yellow", "yellow", "orange", "orange", "red"]);
  });

  it("portalda yok (0) skoru ağırlığı kadar düşürür", () => {
    const r = computeHealthScore({ ...allOne, onPortal: 0 });
    expect(r.score).toBe(75);
  });

  it("tazelik ve fiyat tutarlılığı yardımcıları", () => {
    expect(freshnessValue(10)).toBe(1);
    expect(freshnessValue(60)).toBeCloseTo(0.5);
    expect(freshnessValue(120)).toBe(0);
    expect(freshnessValue(null)).toBeNull();
    expect(priceConsistencyValue(1_000_000, [1_005_000], 0.01, 0.05)).toBe(1);
    expect(priceConsistencyValue(1_000_000, [1_030_000], 0.01, 0.05)).toBeCloseTo(0.5);
    expect(priceConsistencyValue(1_000_000, [1_100_000], 0.01, 0.05)).toBe(0);
    expect(priceConsistencyValue(1_000_000, [], 0.01, 0.05)).toBeNull();
  });
});

describe("config normalizasyonu", () => {
  it("bozuk/eksik girdide varsayılana düşer ve aralığa kırpar", () => {
    expect(normalizeListingControlConfig(null)).toEqual(DEFAULT_LISTING_CONTROL_CONFIG);
    expect(normalizeListingControlConfig("x")).toEqual(DEFAULT_LISTING_CONTROL_CONFIG);
    const c = normalizeListingControlConfig({ stateMachine: { minGapMinutes: 9999 }, price: { toleranceRatio: "abc" } });
    expect(c.stateMachine.minGapMinutes).toBe(120);
    expect(c.price.toleranceRatio).toBe(DEFAULT_LISTING_CONTROL_CONFIG.price.toleranceRatio);
  });

  it("SLA kademeleri monoton: takım lideri ≤ şube ≤ sahip", () => {
    const c = normalizeListingControlConfig({ sla: { teamLeadHours: 10, branchManagerHours: 2, ownerHours: 1 } });
    expect(c.sla.teamLeadHours).toBe(10);
    expect(c.sla.branchManagerHours).toBe(10);
    expect(c.sla.ownerHours).toBe(10);
  });

  it("kritik fiyat eşiği toleranstan küçük olamaz", () => {
    const c = normalizeListingControlConfig({ price: { toleranceRatio: 0.1, criticalRatio: 0.02 } });
    expect(c.price.criticalRatio).toBe(0.1);
  });
});
