import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_CRITERIA } from "./demand-criteria";
import { pruneRequiredKeys, validateGeoChain } from "./demand-geo";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const D1 = "33333333-3333-4333-8333-333333333333";
const N1 = "44444444-4444-4444-8444-444444444444";

function fakeGeo(opts: { districtProvince?: string | null; neighborhoodDistrict?: string | null; error?: boolean }) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (opts.error) return { data: null, error: { message: "x" } };
              if (table === "geo_districts") {
                return { data: opts.districtProvince ? { province_id: opts.districtProvince } : null, error: null };
              }
              return { data: opts.neighborhoodDistrict ? { district_id: opts.neighborhoodDistrict } : null, error: null };
            },
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe("validateGeoChain (B13)", () => {
  it("tutarlı zincir geçer", async () => {
    const sb = fakeGeo({ districtProvince: P1, neighborhoodDistrict: D1 });
    expect(await validateGeoChain(sb, { province_id: P1, district_id: D1, neighborhood_id: N1 })).toBeNull();
  });
  it("ilçe başka ile aitse reddeder", async () => {
    const sb = fakeGeo({ districtProvince: P2 });
    expect(await validateGeoChain(sb, { province_id: P1, district_id: D1 })).toContain("ilçe");
  });
  it("mahalle başka ilçeye aitse reddeder; üst seviye olmadan alt seviye olmaz", async () => {
    const sb = fakeGeo({ districtProvince: P1, neighborhoodDistrict: P2 });
    expect(await validateGeoChain(sb, { province_id: P1, district_id: D1, neighborhood_id: N1 })).toContain("mahalle");
    expect(await validateGeoChain(sb, { district_id: D1 })).toContain("il");
    expect(await validateGeoChain(sb, { neighborhood_id: N1 })).toContain("ilçe");
  });
  it("geçersiz kimlik ve okuma hatası reddedilir", async () => {
    expect(await validateGeoChain(fakeGeo({}), { province_id: "x" })).toContain("geçersiz");
    expect(await validateGeoChain(fakeGeo({ error: true }), { province_id: P1, district_id: D1 })).toContain("doğrulanamadı");
  });
});

describe("pruneRequiredKeys (B13)", () => {
  it("değeri kalmayan zorunlu anahtarı düşürür, değeri olanı korur", () => {
    const c = { ...EMPTY_CRITERIA, required: ["budget", "rooms", "location", "floor"] as never };
    const out = pruneRequiredKeys(c, {
      property_type: null,
      budget_min: null,
      budget_max: 500_000,
      rooms: null,
      min_sqm: null,
      province_id: null,
      district_id: null,
      neighborhood_id: null,
    });
    // bütçe var → kalır; oda ve bölge yok → düşer; kat sütun değil (kriter) → dokunulmaz
    expect(out.required).toEqual(["budget", "floor"]);
  });
});
