import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankCandidates, scoreCandidate, toStoredSuggestions, trLocative, type PoolCandidate, type PoolProperty, type ScoreContext } from "./score";
import { isIncomingPoolSource, parseIncomingPoolSource, poolSourceLabel } from "./sources";

const NOW = Date.UTC(2026, 9, 5, 9, 0, 0);
const ctx: ScoreContext = { nowMs: NOW, officeAvgOpen: 4, labels: { district: "Kadıköy" } };
const prop: PoolProperty = { propertyType: "Daire", transactionType: "Satılık", provinceId: "p1", districtId: "d1", neighborhoodId: null, listPrice: 6_000_000 };

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
    openListings: 3,
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

describe("tek cümle gerekçe", () => {
  it("bölge + tür + iş yükü: \"Kadıköy'de uzman · daire · şu an 3 aktif iş\"", () => {
    const c = cand({
      regions: [{ provinceId: "p1", districtId: "d1", neighborhoodId: null, weight: 5 }],
      specialties: [{ kind: "property_type", value: "Daire", transactionType: null, priceMin: null, priceMax: null, level: 3 }],
    });
    expect(scoreCandidate(c, prop, ctx).summary).toBe("Kadıköy'de uzman · daire · şu an 3 aktif iş");
  });

  it("uzmanlık yoksa bunu söyler; elenen adayda neden yazar", () => {
    expect(scoreCandidate(cand(), prop, ctx).summary).toBe("Uzmanlık eşleşmesi yok · şu an 3 aktif iş");
    expect(scoreCandidate(cand({ onLeave: true }), prop, ctx).summary).toBe("Elendi: Bugün izinli");
    expect(scoreCandidate(cand({ openListings: 0 }), prop, ctx).summary).toContain("şu an aktif işi yok");
  });

  it("ilçe adı bilinmiyorsa genel \"Bölgede uzman\"; saklanan öneride summary taşınır", () => {
    const c = cand({ regions: [{ provinceId: "p1", districtId: "d1", neighborhoodId: null, weight: 4 }] });
    expect(scoreCandidate(c, prop, { nowMs: NOW, officeAvgOpen: 4 }).summary).toMatch(/^Bölgede uzman/);
    const stored = toStoredSuggestions(rankCandidates([c], prop, ctx));
    expect(stored[0]!.summary).toContain("Kadıköy'de uzman");
  });

  it("uzman + az yüklü danışman, uzmansız danışmanın önüne geçer (alan + bölge + iş yükü)", () => {
    const expert = cand({
      profileId: "e",
      name: "Uzman",
      openListings: 1,
      regions: [{ provinceId: "p1", districtId: "d1", neighborhoodId: null, weight: 5 }],
      specialties: [{ kind: "property_type", value: "Daire", transactionType: "Satılık", priceMin: null, priceMax: null, level: 3 }],
    });
    const other = cand({ profileId: "o", name: "Diğer", openListings: 0 });
    const ranked = rankCandidates([other, expert], prop, ctx);
    expect(ranked[0]!.profileId).toBe("e");
  });
});

describe("trLocative", () => {
  it("ünlü uyumu ve sert ünsüz", () => {
    expect(trLocative("Kadıköy")).toBe("Kadıköy'de");
    expect(trLocative("Beşiktaş")).toBe("Beşiktaş'ta");
    expect(trLocative("Ataşehir")).toBe("Ataşehir'de");
    expect(trLocative("Sarıyer")).toBe("Sarıyer'de");
    expect(trLocative("Üsküdar")).toBe("Üsküdar'da");
    expect(trLocative("Şişli")).toBe("Şişli'de");
  });
});

describe("createProperty kaynak sözleşmesi", () => {
  it("dış kaynaktan gelen ilan havuza düşer ve kaynak havuz kaydına yazılır; sabit manual yok", () => {
    const src = readFileSync("src/app/actions/properties.ts", "utf8");
    expect(src).toContain('parseIncomingPoolSource(formData.get("pool_source"))');
    expect(src).toContain("isIncomingPoolSource(poolSource) ||");
    expect(src).toContain("source: poolSource,");
    expect(src).not.toMatch(/enqueueListingPool\([\s\S]{0,200}source: "manual"/);
  });
});

describe("havuz kaynakları", () => {
  it("yalnız dış kaynaklar formdan kabul edilir; bilinmeyen/içe aktarma/devir manual olur", () => {
    expect(parseIncomingPoolSource("extension")).toBe("extension");
    expect(parseIncomingPoolSource("portal_form")).toBe("portal_form");
    expect(parseIncomingPoolSource("network")).toBe("network");
    expect(parseIncomingPoolSource("api")).toBe("api");
    expect(parseIncomingPoolSource("import")).toBe("manual");
    expect(parseIncomingPoolSource("transfer")).toBe("manual");
    expect(parseIncomingPoolSource("x; drop table")).toBe("manual");
    expect(parseIncomingPoolSource(null)).toBe("manual");
  });

  it("etiketler ve gelen-kaynak ayrımı", () => {
    expect(poolSourceLabel("extension")).toBe("Eklenti");
    expect(poolSourceLabel("network")).toBe("Ağ / MLS");
    expect(isIncomingPoolSource("api")).toBe(true);
    expect(isIncomingPoolSource("manual")).toBe(false);
  });
});
