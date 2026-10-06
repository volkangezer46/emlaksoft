import { describe, expect, it } from "vitest";
import type { PoolProperty } from "@/lib/pool/score";
import { getSettingDef } from "@/lib/settings/registry";
import { ASSIGN_WEIGHT_KEYS } from "@/lib/settings/registry/tenant";
import {
  DEFAULT_WEIGHTS,
  normalizeWeights,
  rankAdvisorsForProperty,
  scoreSmartCandidate,
  topSuggestions,
  toStoredScore,
  type SmartCandidate,
  type SmartContext,
} from "./smart-assign";

// Pazartesi 12:00 TR (09:00 UTC): mesai içi, deterministik.
const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);
const DAY = 86_400_000;

const ctx: SmartContext = { nowMs: NOW, officeAvgOpen: 10, officeAvgLoad: 14 };

const prop: PoolProperty = {
  propertyType: "Daire",
  transactionType: "Satılık",
  provinceId: "p1",
  districtId: "d1",
  neighborhoodId: "n1",
  listPrice: 5_000_000,
};

function cand(over: Partial<SmartCandidate> = {}): SmartCandidate {
  return {
    profileId: "a",
    name: "Ali",
    isActive: true,
    acceptsPool: true,
    pausedUntilMs: null,
    onLeave: false,
    ruleUnavailable: false,
    licenseExpired: false,
    openListings: 8,
    capacity: null,
    specialties: [],
    regions: [],
    performance: null,
    availability: "in_hours",
    lastAssignedAtMs: null,
    ruleWeight: 1,
    branchId: "b1",
    teamId: null,
    openDemands: 6,
    slaWithinPct: null,
    lastActivityAtMs: NOW - DAY,
    ...over,
  };
}

describe("ağırlıklar", () => {
  it("varsayılan ağırlıklar ofis ayar defteriyle aynı başlar", () => {
    for (const [k, key] of Object.entries(ASSIGN_WEIGHT_KEYS)) {
      expect(getSettingDef(key)!.default, key).toBe(DEFAULT_WEIGHTS[k as keyof typeof DEFAULT_WEIGHTS]);
    }
    expect(Object.values(DEFAULT_WEIGHTS).reduce((s, v) => s + v, 0)).toBe(100);
  });

  it("toplamı 100 olmayan ağırlıklar oransal normalize edilir; hepsi 0 ise varsayılan", () => {
    const w = normalizeWeights({ workload: 50, specialty: 50, region: 0, performance: 0, availability: 0 });
    expect(w).toEqual({ workload: 50, specialty: 50, region: 0, performance: 0, availability: 0 });
    const w2 = normalizeWeights({ workload: 10, specialty: 10, region: 10, performance: 10, availability: 10 });
    expect(Object.values(w2).reduce((s, v) => s + v, 0)).toBe(100);
    expect(normalizeWeights({ workload: 0, specialty: 0, region: 0, performance: 0, availability: 0 })).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights({ workload: -5 }).workload).toBe(DEFAULT_WEIGHTS.workload);
  });

  it("ağırlığı 0 olan ölçüt gerekçe listesinde yer almaz", () => {
    const s = scoreSmartCandidate(cand(), prop, { ...ctx, weights: { ...DEFAULT_WEIGHTS, region: 0 } });
    expect(s.reasons.map((r) => r.key)).not.toContain("region");
    expect(s.reasons.reduce((n, r) => n + r.max, 0)).toBe(100);
  });
});

describe("puanlama", () => {
  it("puan = gerekçe puanlarının toplamı; her gerekçe max'ını aşmaz", () => {
    const s = scoreSmartCandidate(cand(), prop, ctx);
    expect(s.score).toBe(s.reasons.reduce((n, r) => n + r.points, 0));
    for (const r of s.reasons) expect(r.points).toBeLessThanOrEqual(r.max);
    expect(s.summary).toMatch(/İş yükü \+\d+/);
  });

  it("bölge + uzmanlık eşleşen danışman eşleşmeyenden yüksek puan alır", () => {
    const expert = cand({
      profileId: "e",
      name: "Ece",
      regions: [{ provinceId: "p1", districtId: "d1", neighborhoodId: "n1", weight: 5 }],
      specialties: [{ kind: "property_type", value: "Daire", transactionType: "Satılık", priceMin: null, priceMax: null, level: 3 }],
    });
    const plain = cand({ profileId: "p", name: "Pelin" });
    const [first, second] = rankAdvisorsForProperty(prop, [plain, expert], ctx);
    expect(first.profileId).toBe("e");
    expect(first.score).toBeGreaterThan(second.score);
    expect(first.reasons.find((r) => r.key === "region")!.points).toBe(DEFAULT_WEIGHTS.region);
    expect(first.reasons.find((r) => r.key === "specialty")!.points).toBe(DEFAULT_WEIGHTS.specialty);
  });

  it("iş yükü azalınca puan artar; kapasite doluysa elenir", () => {
    const light = scoreSmartCandidate(cand({ openListings: 1, openDemands: 1 }), prop, ctx);
    const heavy = scoreSmartCandidate(cand({ openListings: 20, openDemands: 15 }), prop, ctx);
    expect(light.reasons.find((r) => r.key === "workload")!.points).toBeGreaterThan(heavy.reasons.find((r) => r.key === "workload")!.points);
    const full = scoreSmartCandidate(cand({ openListings: 5, capacity: 5 }), prop, ctx);
    expect(full.excluded?.reason).toMatch(/Kapasite dolu/);
  });

  it("performans: veri yetersizse nötr; kapanış oranı ve SLA uyumu birlikte sayılır", () => {
    const none = scoreSmartCandidate(cand(), prop, ctx).reasons.find((r) => r.key === "performance")!;
    expect(none.points).toBe(Math.round(DEFAULT_WEIGHTS.performance * 0.4));
    expect(none.detail).toMatch(/nötr/);
    const strong = scoreSmartCandidate(cand({ performance: { listings: 10, deals: 4 }, slaWithinPct: 100 }), prop, ctx).reasons.find((r) => r.key === "performance")!;
    expect(strong.points).toBe(DEFAULT_WEIGHTS.performance);
    const weak = scoreSmartCandidate(cand({ performance: { listings: 10, deals: 0 }, slaWithinPct: 0 }), prop, ctx).reasons.find((r) => r.key === "performance")!;
    expect(weak.points).toBe(0);
  });

  it("müsaitlik: izinli elenir; mesai dışı ve eski aktivite puanı düşürür", () => {
    expect(scoreSmartCandidate(cand({ onLeave: true }), prop, ctx).excluded?.reason).toBe("Bugün izinli");
    const now = scoreSmartCandidate(cand(), prop, ctx).reasons.find((r) => r.key === "availability")!;
    const stale = scoreSmartCandidate(cand({ availability: "out_of_hours", lastActivityAtMs: NOW - 45 * DAY }), prop, ctx).reasons.find((r) => r.key === "availability")!;
    expect(now.points).toBeGreaterThan(stale.points);
    expect(stale.detail).toMatch(/45 gündür aktivite yok/);
    const never = scoreSmartCandidate(cand({ lastActivityAtMs: null }), prop, ctx).reasons.find((r) => r.key === "availability")!;
    expect(never.detail).toMatch(/aktivite kaydı yok/);
  });
});

describe("kısıt ve adil dağıtım", () => {
  it("şube müdürü kısıtı: başka şubedeki danışman elenir, aynı şube aday kalır", () => {
    const ranked = rankAdvisorsForProperty(prop, [cand({ profileId: "a", branchId: "b1" }), cand({ profileId: "b", name: "Banu", branchId: "b2" })], {
      ...ctx,
      restrictToBranchId: "b1",
    });
    expect(ranked.find((s) => s.profileId === "a")!.excluded).toBeUndefined();
    expect(ranked.find((s) => s.profileId === "b")!.excluded?.reason).toMatch(/Başka şubede/);
  });

  it("eşit puanda son atamadan en eski (hiç almamış en önde) öne geçer", () => {
    const recent = cand({ profileId: "r", name: "Aaa", lastAssignedAtMs: NOW - DAY });
    const never = cand({ profileId: "n", name: "Zzz", lastAssignedAtMs: null });
    const older = cand({ profileId: "o", name: "Bbb", lastAssignedAtMs: NOW - 10 * DAY });
    const ranked = rankAdvisorsForProperty(prop, [recent, never, older], ctx);
    expect(ranked.map((s) => s.profileId)).toEqual(["n", "o", "r"]);
  });

  it("elenenler sona gider; ilk 3 öneri yalnız uygun adaylardan oluşur", () => {
    const list = [
      cand({ profileId: "x", name: "X", isActive: false }),
      cand({ profileId: "1", name: "Bir" }),
      cand({ profileId: "2", name: "İki", openListings: 1, openDemands: 0 }),
      cand({ profileId: "3", name: "Üç", openListings: 3, openDemands: 2 }),
      cand({ profileId: "4", name: "Dört", openListings: 30, openDemands: 30 }),
    ];
    const ranked = rankAdvisorsForProperty(prop, list, ctx);
    expect(ranked[ranked.length - 1].profileId).toBe("x");
    const top = topSuggestions(ranked);
    expect(top).toHaveLength(3);
    expect(top.every((s) => !s.excluded)).toBe(true);
    expect(top[0].profileId).toBe("2");
  });

  it("saklanan puan kişisel veri taşımaz (id, toplam, bileşen etiketleri)", () => {
    const stored = toStoredScore(rankAdvisorsForProperty(prop, [cand()], ctx)[0]);
    expect(Object.keys(stored)).toEqual(["total", "reasons"]);
    expect(Object.keys(stored.reasons[0])).toEqual(["key", "label", "points", "max"]);
  });
});
