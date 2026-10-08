import { describe, expect, it } from "vitest";
import type { SmartContext } from "@/lib/office-center/smart-assign";
import {
  DEFAULT_LEAD_ROUTING,
  decideReassign,
  isLeadSlaBreached,
  leadRoutingConfigFrom,
  leadToPoolProperty,
  pickLeadAssignee,
  shouldDeferAssignment,
  type LeadCandidate,
} from "./logic";

// Pazartesi 12:00 TR (09:00 UTC): mesai içi.
const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);
const ctx: SmartContext = { nowMs: NOW, officeAvgOpen: 5, officeAvgLoad: 8 };

function cand(over: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    profileId: "a",
    name: "Ali",
    role: "advisor",
    isActive: true,
    acceptsPool: true,
    pausedUntilMs: null,
    onLeave: false,
    ruleUnavailable: false,
    licenseExpired: false,
    openListings: 3,
    capacity: null,
    specialties: [],
    regions: [],
    performance: null,
    availability: "in_hours",
    lastAssignedAtMs: null,
    ruleWeight: 1,
    branchId: null,
    teamId: null,
    openDemands: 4,
    slaWithinPct: null,
    lastActivityAtMs: NOW - 3_600_000,
    ...over,
  };
}

describe("pickLeadAssignee", () => {
  const lead = { propertyType: "Daire", transactionType: "Satılık", provinceId: "p1", districtId: "d1" };

  it("least_loaded: açık talebi en az olan; eşitlikte en eski atama alan", () => {
    const r = pickLeadAssignee({
      strategy: "least_loaded",
      lead,
      ctx,
      candidates: [cand({ profileId: "a", name: "Ali", openDemands: 5 }), cand({ profileId: "b", name: "Bora", openDemands: 2, lastAssignedAtMs: NOW - 1000 }), cand({ profileId: "c", name: "Can", openDemands: 2, lastAssignedAtMs: NOW - 9000 })],
    });
    expect(r.profileId).toBe("c");
    expect(r.ranking.map((x) => x.profileId)).toEqual(["c", "b", "a"]);
  });

  it("round_robin: en uzun süredir talep almayan öne geçer; hiç almamış en önde", () => {
    const r = pickLeadAssignee({
      strategy: "round_robin",
      lead,
      ctx,
      candidates: [cand({ profileId: "a", lastAssignedAtMs: NOW - 1000, openDemands: 0 }), cand({ profileId: "b", lastAssignedAtMs: NOW - 5000, openDemands: 9 }), cand({ profileId: "c", lastAssignedAtMs: null, openDemands: 9, name: "Can" })],
    });
    expect(r.profileId).toBe("c");
    const r2 = pickLeadAssignee({ strategy: "round_robin", lead, ctx, candidates: [cand({ profileId: "a", lastAssignedAtMs: NOW - 1000 }), cand({ profileId: "b", lastAssignedAtMs: NOW - 5000, name: "Bora" })] });
    expect(r2.profileId).toBe("b");
  });

  it("smart: bölge uzmanı iş yükü fazla olsa da öne geçer", () => {
    const r = pickLeadAssignee({
      strategy: "smart",
      lead,
      ctx,
      candidates: [
        cand({ profileId: "uzman", name: "Uzman", openDemands: 6, regions: [{ provinceId: "p1", districtId: "d1", neighborhoodId: null, weight: 5 }], specialties: [{ kind: "property_type", value: "Daire", transactionType: "Satılık", priceMin: null, priceMax: null, level: 3 }] }),
        cand({ profileId: "bos", name: "Boş", openDemands: 1 }),
      ],
    });
    expect(r.profileId).toBe("uzman");
    expect(r.reason).toContain("Akıllı atama");
  });

  it("elenenler (izinli, pasif, duraklatılmış) seçilmez; excludeIds yeniden atamada mevcut sorumluyu atlar", () => {
    const r = pickLeadAssignee({
      strategy: "least_loaded",
      lead,
      ctx,
      excludeIds: ["x"],
      candidates: [cand({ profileId: "x", openDemands: 0 }), cand({ profileId: "izinli", onLeave: true, openDemands: 0 }), cand({ profileId: "pasif", isActive: false, openDemands: 0 }), cand({ profileId: "ok", openDemands: 7, name: "Ok" })],
    });
    expect(r.profileId).toBe("ok");
  });

  it("danışman rolü varsa yöneticiye düşülmez; yoksa yöneticiye düşülür; hiç aday yoksa null", () => {
    const withAdvisor = pickLeadAssignee({ strategy: "least_loaded", lead, ctx, candidates: [cand({ profileId: "m", role: "owner", openDemands: 0 }), cand({ profileId: "d", role: "advisor", openDemands: 9, name: "Dani" })] });
    expect(withAdvisor.profileId).toBe("d");
    const onlyOwner = pickLeadAssignee({ strategy: "least_loaded", lead, ctx, candidates: [cand({ profileId: "m", role: "owner" })] });
    expect(onlyOwner.profileId).toBe("m");
    const none = pickLeadAssignee({ strategy: "smart", lead, ctx, candidates: [cand({ onLeave: true })] });
    expect(none.profileId).toBeNull();
  });

  it("talep, havuz puanlayıcı girdisine eşlenir (bütçe üst sınırı fiyat olur)", () => {
    expect(leadToPoolProperty({ propertyType: "Daire", budgetMax: 3_000_000, districtId: "d1" })).toMatchObject({ propertyType: "Daire", listPrice: 3_000_000, districtId: "d1", provinceId: null });
    expect(leadToPoolProperty({ budgetMax: 0 }).listPrice).toBeNull();
  });
});

describe("mesai ve SLA", () => {
  const SUNDAY_NOON = Date.UTC(2026, 9, 4, 9, 0, 0);
  const MONDAY_22 = Date.UTC(2026, 9, 5, 19, 0, 0); // 22:00 TR

  it("mesai dışı atama yalnız 'yalnız mesai' açıkken ertelenir", () => {
    expect(shouldDeferAssignment({ hoursOnly: true }, SUNDAY_NOON)).toBe(true);
    expect(shouldDeferAssignment({ hoursOnly: true }, MONDAY_22)).toBe(true);
    expect(shouldDeferAssignment({ hoursOnly: true }, NOW)).toBe(false);
    expect(shouldDeferAssignment({ hoursOnly: false }, SUNDAY_NOON)).toBe(false);
  });

  it("SLA çalışma dakikasıyla ölçülür: 30 dk içinde ihlal yok, 31 dk sonra var; yanıtlanan asla", () => {
    const created = new Date(NOW - 20 * 60_000).toISOString();
    expect(isLeadSlaBreached({ createdAt: created, responded: false, nowMs: NOW, slaMinutes: 30 })).toBe(false);
    expect(isLeadSlaBreached({ createdAt: new Date(NOW - 31 * 60_000).toISOString(), responded: false, nowMs: NOW, slaMinutes: 30 })).toBe(true);
    expect(isLeadSlaBreached({ createdAt: new Date(NOW - 300 * 60_000).toISOString(), responded: true, nowMs: NOW, slaMinutes: 30 })).toBe(false);
  });

  it("gece gelen talep sabah ilk saatte borçla başlamaz (çalışma dışı sayılmaz)", () => {
    const created = new Date(Date.UTC(2026, 9, 4, 19, 0, 0)).toISOString(); // Pazar 22:00 TR
    const morning = Date.UTC(2026, 9, 5, 6, 10, 0); // Pzt 09:10 TR
    expect(isLeadSlaBreached({ createdAt: created, responded: false, nowMs: morning, slaMinutes: 30 })).toBe(false);
  });

  it("son atamadan itibaren yeni süre tanınır", () => {
    const old = new Date(NOW - 600 * 60_000).toISOString();
    const reassigned = new Date(NOW - 10 * 60_000).toISOString();
    expect(isLeadSlaBreached({ createdAt: old, lastAssignedAt: reassigned, responded: false, nowMs: NOW, slaMinutes: 30 })).toBe(false);
  });

  it("decideReassign: kapalıyken bekler; açıkken reassign, üst sınırda escalate", () => {
    const base = { createdAt: new Date(NOW - 120 * 60_000).toISOString(), responded: false, nowMs: NOW, slaMinutes: 30, maxReassign: 2 };
    expect(decideReassign({ ...base, enabled: false, reassignCount: 0 })).toBe("wait");
    expect(decideReassign({ ...base, enabled: true, reassignCount: 0 })).toBe("reassign");
    expect(decideReassign({ ...base, enabled: true, reassignCount: 2 })).toBe("escalate");
    expect(decideReassign({ ...base, enabled: true, reassignCount: 0, responded: true })).toBe("wait");
  });
});

describe("leadRoutingConfigFrom", () => {
  const keys = { strategy: "s", hoursOnly: "h", reassign: "r", maxReassign: "m", slaMin: "l" };
  it("varsayılanlar bugünkü davranışı korur", () => {
    expect(leadRoutingConfigFrom({}, keys)).toEqual(DEFAULT_LEAD_ROUTING);
    expect(DEFAULT_LEAD_ROUTING.strategy).toBe("least_loaded");
    expect(DEFAULT_LEAD_ROUTING.reassignOnBreach).toBe(false);
    expect(DEFAULT_LEAD_ROUTING.hoursOnly).toBe(false);
  });
  it("geçerli değerler okunur, bozuklar varsayılana düşer, üst sınır 5", () => {
    expect(leadRoutingConfigFrom({ s: "smart", h: true, r: true, m: 9, l: "30" }, keys)).toEqual({ strategy: "smart", hoursOnly: true, reassignOnBreach: true, maxReassign: 5, slaMinutes: 30 });
    expect(leadRoutingConfigFrom({ s: "uydurma", m: "abc", l: -1 }, keys).strategy).toBe("least_loaded");
  });
});
