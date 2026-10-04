import { describe, expect, it } from "vitest";
import {
  explainSuggestion,
  exclusionReason,
  rankCandidates,
  scoreCandidate,
  toStoredSuggestions,
  type PoolCandidate,
  type PoolProperty,
  type ScoreContext,
} from "./score";
import { availabilityAt, decidePoolAction, isClaimOpen, slaState } from "./modes";

const NOW = Date.UTC(2026, 9, 5, 9, 0, 0); // Pazartesi 12:00 TR
const ctx: ScoreContext = { nowMs: NOW, officeAvgOpen: 10 };

const prop: PoolProperty = {
  propertyType: "Daire",
  transactionType: "Satılık",
  provinceId: "p1",
  districtId: "d1",
  neighborhoodId: "n1",
  listPrice: 5_000_000,
};

function cand(over: Partial<PoolCandidate> = {}): PoolCandidate {
  return {
    profileId: "a",
    name: "Ali",
    isActive: true,
    acceptsPool: true,
    pausedUntilMs: null,
    onLeave: false,
    ruleUnavailable: false,
    licenseExpired: false,
    openListings: 0,
    capacity: null,
    specialties: [],
    regions: [],
    performance: null,
    availability: "in_hours",
    lastAssignedAtMs: null,
    ruleWeight: 1,
    ...over,
  };
}

const perfect = cand({
  regions: [{ provinceId: "p1", districtId: "d1", neighborhoodId: "n1", weight: 5 }],
  specialties: [{ kind: "property_type", value: "Daire", transactionType: null, priceMin: 4_000_000, priceMax: 6_000_000, level: 3 }],
  capacity: 20,
  openListings: 0,
  performance: { listings: 20, deals: 10 },
});

describe("pool score", () => {
  it("mükemmel aday 100 alır ve bileşen toplamı skora eşittir", () => {
    const s = scoreCandidate(perfect, prop, ctx);
    expect(s.score).toBe(100);
    expect(s.reasons.reduce((n, r) => n + r.points, 0)).toBe(s.score);
    expect(s.reasons.map((r) => r.key)).toEqual(["region", "type", "transaction", "price", "workload", "performance", "availability"]);
  });

  it("bölge: mahalle 35, ilçe 24, il 10; ağırlık ölçekler; en yüksek seçilir", () => {
    const base = cand();
    const reg = (r: { d?: string | null; n?: string | null; w?: number }) =>
      scoreCandidate({ ...base, regions: [{ provinceId: "p1", districtId: r.d ?? null, neighborhoodId: r.n ?? null, weight: r.w ?? 5 }] }, prop, ctx).reasons[0].points;
    expect(reg({ d: "d1", n: "n1" })).toBe(35);
    expect(reg({ d: "d1" })).toBe(24);
    expect(reg({})).toBe(10);
    expect(reg({ d: "d1", n: "n1", w: 1 })).toBe(7);
    expect(reg({ d: "d2", n: "n9" })).toBe(0);
    const multi = scoreCandidate(
      { ...base, regions: [{ provinceId: "p1", districtId: null, neighborhoodId: null, weight: 5 }, { provinceId: "p1", districtId: "d1", neighborhoodId: null, weight: 5 }] },
      prop,
      ctx,
    );
    expect(multi.reasons[0].points).toBe(24);
  });

  it("tür seviyeleri 12/16/20 ve eşleşme yoksa 0 (büyük/küçük harf duyarsız)", () => {
    const t = (level: number, value = "daire") =>
      scoreCandidate(cand({ specialties: [{ kind: "property_type", value, transactionType: null, priceMin: null, priceMax: null, level }] }), prop, ctx).reasons[1].points;
    expect(t(1)).toBe(12);
    expect(t(2)).toBe(16);
    expect(t(3)).toBe(20);
    expect(t(3, "Arsa")).toBe(0);
  });

  it("segment satırı v1'de puanlanmaz", () => {
    const s = scoreCandidate(cand({ specialties: [{ kind: "segment", value: "Daire", transactionType: null, priceMin: null, priceMax: null, level: 3 }] }), prop, ctx);
    expect(s.reasons[1].points).toBe(0);
  });

  it("işlem türü: null=ikisi, uyuşmazsa 0 ama tür puanı kalır", () => {
    const row = (transactionType: string | null) =>
      scoreCandidate(cand({ specialties: [{ kind: "property_type", value: "Daire", transactionType, priceMin: null, priceMax: null, level: 2 }] }), prop, ctx);
    expect(row(null).reasons[2].points).toBe(10);
    expect(row("Satılık").reasons[2].points).toBe(10);
    const miss = row("Kiralık");
    expect(miss.reasons[2].points).toBe(0);
    expect(miss.reasons[1].points).toBe(16);
  });

  it("fiyat bandı: içinde 15, dışına her %10 sapma -3, taban 0, bant yoksa nötr 8", () => {
    const price = (listPrice: number | null, min: number | null, max: number | null) =>
      scoreCandidate(
        cand({ specialties: [{ kind: "property_type", value: "Daire", transactionType: null, priceMin: min, priceMax: max, level: 2 }] }),
        { ...prop, listPrice },
        ctx,
      ).reasons[3].points;
    expect(price(5_000_000, 4_000_000, 6_000_000)).toBe(15);
    expect(price(6_300_000, 4_000_000, 6_000_000)).toBe(12); // %5 sapma -> 1 adım
    expect(price(7_000_000, 4_000_000, 6_000_000)).toBe(9); // %16.7 -> 2 adım
    expect(price(100_000_000, 4_000_000, 6_000_000)).toBe(0);
    expect(price(5_000_000, null, null)).toBe(8);
    expect(price(null, 4_000_000, 6_000_000)).toBe(8);
  });

  it("iş yükü: kapasiteye göre; kapasite yoksa ofis ortalamasına göre", () => {
    const w = (open: number, capacity: number | null) => scoreCandidate(cand({ openListings: open, capacity }), prop, ctx).reasons[4].points;
    expect(w(0, 10)).toBe(10);
    expect(w(5, 10)).toBe(5);
    expect(w(0, null)).toBe(10);
    expect(w(10, null)).toBe(5);
    expect(w(40, null)).toBe(0);
    const zeroAvg = scoreCandidate(cand({ openListings: 0 }), prop, { ...ctx, officeAvgOpen: 0 });
    expect(zeroAvg.reasons[4].points).toBe(10);
  });

  it("performans: örnek az ise nötr 2 ve 'veri yetersiz'; yeterliyse orana göre", () => {
    const few = scoreCandidate(cand({ performance: { listings: 4, deals: 4 } }), prop, ctx).reasons[5];
    expect(few.points).toBe(2);
    expect(few.detail).toMatch(/yetersiz/);
    expect(scoreCandidate(cand(), prop, ctx).reasons[5].points).toBe(2);
    expect(scoreCandidate(cand({ performance: { listings: 20, deals: 0 } }), prop, ctx).reasons[5].points).toBe(0);
    expect(scoreCandidate(cand({ performance: { listings: 20, deals: 20 } }), prop, ctx).reasons[5].points).toBe(5);
  });

  it("müsaitlik 5/3/0", () => {
    const a = (availability: PoolCandidate["availability"]) => scoreCandidate(cand({ availability }), prop, ctx).reasons[6].points;
    expect([a("in_hours"), a("out_of_hours"), a("off")]).toEqual([5, 3, 0]);
  });
});

describe("pool eleme", () => {
  it("her eleme nedeni ayrı ayrı yakalanır", () => {
    expect(exclusionReason(cand({ isActive: false }), ctx)).toMatch(/pasif/);
    expect(exclusionReason(cand({ acceptsPool: false }), ctx)).toMatch(/kapalı/);
    expect(exclusionReason(cand({ pausedUntilMs: NOW + 1 }), ctx)).toMatch(/duraklat/);
    expect(exclusionReason(cand({ pausedUntilMs: NOW - 1 }), ctx)).toBeNull();
    expect(exclusionReason(cand({ onLeave: true }), ctx)).toMatch(/izinli/);
    expect(exclusionReason(cand({ ruleUnavailable: true }), ctx)).toMatch(/müsait değil/);
    expect(exclusionReason(cand({ licenseExpired: true }), ctx)).toMatch(/Yetki belgesi/);
    expect(exclusionReason(cand({ capacity: 5, openListings: 5 }), ctx)).toMatch(/Kapasite dolu \(5\/5\)/);
    expect(exclusionReason(cand({ capacity: 5, openListings: 4 }), ctx)).toBeNull();
    expect(exclusionReason(cand({ capacity: 0, openListings: 0 }), ctx)).toMatch(/Kapasite/);
  });

  it("elenen puan almaz, sona gider ve nedeniyle listelenir", () => {
    const ranked = rankCandidates([cand({ profileId: "x", name: "Elenen", onLeave: true }), perfect], prop, ctx);
    expect(ranked[0].profileId).toBe("a");
    expect(ranked[1].excluded?.reason).toMatch(/izinli/);
    expect(ranked[1].score).toBe(0);
    expect(explainSuggestion(ranked[1])).toMatch(/^Elendi:/);
  });

  it("aday yoksa boş liste", () => {
    expect(rankCandidates([], prop, ctx)).toEqual([]);
  });
});

describe("pool sıralama ve adil dağıtım", () => {
  const mk = (id: string, pts: number, last: number | null, w = 1) =>
    // availability ile puan ayarı: bölge ağırlığı üzerinden temel fark
    cand({
      profileId: id,
      name: id,
      lastAssignedAtMs: last,
      ruleWeight: w,
      regions: [{ provinceId: "p1", districtId: "d1", neighborhoodId: "n1", weight: pts }],
      availability: "off",
    });

  it("±3 içinde son atamadan en eski öne geçer; fark büyükse puan kazanır", () => {
    // ağırlık 5 -> 35, ağırlık 4 -> 28 (fark 7: küme dışı)
    const ranked = rankCandidates([mk("yeni", 5, NOW - 1000), mk("eski", 5, NOW - 999_999), mk("dusuk", 4, null)], prop, { ...ctx, officeAvgOpen: 0 });
    expect(ranked.map((r) => r.profileId)).toEqual(["eski", "yeni", "dusuk"]);
  });

  it("hiç atama almamış (null) en öne; eşitlikte kural ağırlığı", () => {
    const r1 = rankCandidates([mk("a", 5, NOW - 5), mk("b", 5, null)], prop, ctx);
    expect(r1[0].profileId).toBe("b");
    const r2 = rankCandidates([mk("a", 5, null, 1), mk("b", 5, null, 3)], prop, ctx);
    expect(r2[0].profileId).toBe("b");
  });

  it("saklanan öneri kişisel veri (ad) içermez", () => {
    const stored = toStoredSuggestions(rankCandidates([perfect], prop, ctx));
    expect(JSON.stringify(stored)).not.toContain("Ali");
    expect(stored[0]).toHaveProperty("profile_id", "a");
  });
});

describe("pool modları", () => {
  const sug = (score: number, id = "a") => ({ profileId: id, name: id, score, reasons: [] });
  const base = { slaMinutes: 20, nowMs: NOW, minScore: 60 };

  it("auto: eşik üstünde atar, altında bekler", () => {
    expect(decidePoolAction({ ...base, mode: "auto", suggestions: [sug(75)] })).toEqual({ kind: "auto_assign", profileId: "a", score: 75 });
    expect(decidePoolAction({ ...base, mode: "auto", suggestions: [sug(59)] })).toEqual({ kind: "await_owner", reason: "below_threshold" });
    expect(decidePoolAction({ ...base, mode: "auto", suggestions: [sug(60)] }).kind).toBe("auto_assign");
  });

  it("claim: sla dakikası kadar pencere açar; sla yoksa 30 dk", () => {
    const d = decidePoolAction({ ...base, mode: "claim", suggestions: [sug(10, "x"), sug(5, "y")] });
    expect(d).toEqual({ kind: "open_claim", claimOpenUntilMs: NOW + 20 * 60_000, eligibleProfileIds: ["x", "y"] });
    const d2 = decidePoolAction({ ...base, slaMinutes: null, mode: "claim", suggestions: [sug(10)] });
    expect(d2.kind === "open_claim" && d2.claimOpenUntilMs).toBe(NOW + 30 * 60_000);
  });

  it("uygun aday yoksa her modda ofis sahibi bekler; manuel/yarı otomatik bekler", () => {
    for (const mode of ["manual", "semi_auto", "auto", "claim"] as const) {
      expect(decidePoolAction({ ...base, mode, suggestions: [] })).toEqual({ kind: "await_owner", reason: "no_candidates" });
    }
    const onlyExcluded = { profileId: "z", name: "z", score: 0, reasons: [], excluded: { reason: "x" } };
    expect(decidePoolAction({ ...base, mode: "auto", suggestions: [onlyExcluded] }).kind).toBe("await_owner");
    expect(decidePoolAction({ ...base, mode: "manual", suggestions: [sug(90)] })).toEqual({ kind: "await_owner", reason: "manual" });
    expect(decidePoolAction({ ...base, mode: "semi_auto", suggestions: [sug(90)] })).toEqual({ kind: "await_owner", reason: "semi_auto" });
  });

  it("SLA durumu ve sahiplenme penceresi", () => {
    const created = NOW - 60 * 60_000;
    expect(slaState({ dueMs: null, createdMs: created, nowMs: NOW })).toBe("none");
    expect(slaState({ dueMs: NOW - 1, createdMs: created, nowMs: NOW })).toBe("breached");
    expect(slaState({ dueMs: NOW + 60_000, createdMs: created, nowMs: NOW })).toBe("due_soon");
    expect(slaState({ dueMs: NOW + 3 * 3_600_000, createdMs: created, nowMs: NOW })).toBe("ok");
    expect(isClaimOpen(NOW, NOW)).toBe(true);
    expect(isClaimOpen(NOW - 1, NOW)).toBe(false);
    expect(isClaimOpen(null, NOW)).toBe(false);
  });

  it("mesai: hafta içi 09-18 içinde, dışında, hafta sonu off", () => {
    expect(availabilityAt(Date.UTC(2026, 9, 5, 9, 0))).toBe("in_hours"); // Pzt 12:00 TR
    expect(availabilityAt(Date.UTC(2026, 9, 5, 20, 0))).toBe("out_of_hours"); // Pzt 23:00 TR
    expect(availabilityAt(Date.UTC(2026, 9, 3, 9, 0))).toBe("off"); // Cumartesi
  });
});
