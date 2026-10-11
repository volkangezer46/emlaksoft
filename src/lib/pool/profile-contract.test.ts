import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rankAdvisorsForProperty, scoreSmartCandidate, type SmartCandidate, type SmartContext } from "@/lib/office-center/smart-assign";
import { rankCandidates, rankForProfile, scoreCandidate, scoreForProfile, type PoolProperty } from "./score";

/**
 * Konsey #11: havuz ve Ofis Merkezi akıllı ataması TEK puanlayıcıyı (pool/score.ts scoreForProfile) kullanır.
 * Bu sözleşme (1) kopya hesabın geri gelmesini kaynakta yakalar, (2) iki profilin aynı elemeyi ve aynı uzmanlık/bölge
 * girdilerini paylaştığını davranışla kanıtlar.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);
const prop: PoolProperty = { propertyType: "Daire", transactionType: "Satılık", provinceId: "p1", districtId: "d1", neighborhoodId: "n1", listPrice: 5_000_000 };
const ctx: SmartContext = { nowMs: NOW, officeAvgOpen: 10, officeAvgLoad: 14 };

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
    specialties: [{ kind: "property_type", value: "Daire", transactionType: "Satılık", priceMin: 3_000_000, priceMax: 8_000_000, level: 3 }],
    regions: [],
    performance: null,
    availability: "in_hours",
    lastAssignedAtMs: null,
    ruleWeight: 1,
    branchId: "b1",
    teamId: null,
    openDemands: 6,
    slaWithinPct: null,
    lastActivityAtMs: NOW - 86_400_000,
    ...over,
  };
}

describe("tek puanlayıcı, iki profil", () => {
  it("office-center puanlama alt hesaplarını kopyalamaz; yalnız scoreForProfile/rankForProfile çağırır", () => {
    const src = read("src/lib/office-center/smart-assign.ts");
    expect(src).toContain("scoreForProfile");
    expect(src).toContain("rankForProfile");
    for (const dup of ["workloadFactor", "performanceFactor", "availabilityFactor", "regionPoints", "specialtyReasons", "factorReason"]) {
      expect(src, dup).not.toContain(dup);
    }
  });

  it("havuz sıralaması rankForProfile(pool) ile birebir aynıdır", () => {
    const list = [cand({ profileId: "a", name: "Ali" }), cand({ profileId: "b", name: "Bora", openListings: 2 })];
    expect(rankCandidates(list, prop, ctx)).toEqual(rankForProfile({ kind: "pool" }, list, prop, ctx));
    expect(scoreCandidate(list[0], prop, ctx)).toEqual(scoreForProfile({ kind: "pool" }, list[0], prop, ctx));
  });

  it("iki profil AYNI elemeyi uygular (pasif, havuza kapalı, izinli); elenenin nedeni aynıdır", () => {
    for (const over of [{ isActive: false }, { acceptsPool: false }, { onLeave: true }] as Partial<SmartCandidate>[]) {
      const c = cand(over);
      const pool = scoreCandidate(c, prop, ctx);
      const office = scoreSmartCandidate(c, prop, ctx);
      expect(pool.excluded?.reason).toBeDefined();
      expect(office.excluded?.reason).toBe(pool.excluded?.reason);
      expect(office.score).toBe(0);
    }
  });

  it("aynı adaylar iki profilde de uzmanı bölgesiz/uzmansızdan üstte sıralar (ortak girdi)", () => {
    const expert = cand({ profileId: "e", name: "Uzman" });
    const novice = cand({ profileId: "n", name: "Acemi", specialties: [] });
    const poolTop = rankCandidates([novice, expert], prop, ctx)[0].profileId;
    const officeTop = rankAdvisorsForProperty(prop, [novice, expert], ctx)[0].profileId;
    expect(poolTop).toBe("e");
    expect(officeTop).toBe("e");
  });

  it("şube kısıtı yalnız ofis profilinde ek elemedir ve havuz elemesinden önce gelir", () => {
    const c = cand({ branchId: "b2" });
    const r = scoreSmartCandidate(c, prop, { ...ctx, restrictToBranchId: "b1" });
    expect(r.excluded?.reason).toContain("şube");
  });
});
