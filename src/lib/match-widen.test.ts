import { describe, expect, it } from "vitest";
import type { MatchDemand, MatchProperty } from "./matching";
import { suggestWidening, widenDemandPatch } from "./match-widen";

const demand = (over: Partial<MatchDemand> = {}): MatchDemand => ({
  id: "d1",
  transaction_type: "Satılık",
  property_type: "Daire",
  province_id: "prov",
  district_id: "dist-a",
  neighborhood_id: null,
  budget_min: null,
  budget_max: 1_000_000,
  rooms: "3+1",
  min_sqm: null,
  urgency: null,
  status: "active",
  criteria: { required: ["budget", "location"] },
  ...over,
});
const prop = (id: string, over: Partial<MatchProperty> = {}): MatchProperty => ({
  id,
  property_code: id.toUpperCase(),
  title: `Portföy ${id}`,
  transaction_type: "Satılık",
  property_type: "Daire",
  status: "live",
  list_price: 900_000,
  province_id: "prov",
  district_id: "dist-a",
  neighborhood_id: null,
  features: { rooms: "3+1", sqm: 110 },
  ...over,
});

describe("widenDemandPatch (CRM-G6)", () => {
  it("bütçe adımları yuvarlanır, bütçesiz talepte öneri yok", () => {
    expect(widenDemandPatch(demand(), "budget10")).toEqual({ budget_max: 1_100_000 });
    expect(widenDemandPatch(demand({ budget_max: null }), "budget20")).toBeNull();
  });
  it("ilçe kaldırılınca konum zorunluluğu da düşer", () => {
    const p = widenDemandPatch(demand(), "drop_district");
    expect(p?.district_id).toBeNull();
    expect(p?.criteria?.required).toEqual(["budget"]);
  });
  it("uygulanamayan varyant null", () => {
    expect(widenDemandPatch(demand({ neighborhood_id: null }), "drop_neighborhood")).toBeNull();
    expect(widenDemandPatch(demand({ min_sqm: null }), "sqm10")).toBeNull();
  });
});

describe("suggestWidening", () => {
  it("yalnız gerçekten kazandıran varyantları kazanca göre sıralar", () => {
    const properties = [
      prop("a", { list_price: 1_150_000 }), // yalnız bütçe +%20 ile (olmazsa olmaz bütçe katı)
      prop("b", { district_id: "dist-b" }), // ilçe kaldırılınca
      prop("c", { district_id: "dist-b", list_price: 950_000 }),
    ];
    const out = suggestWidening({ demand: demand(), properties, customerId: null, limit: 5 });
    const byKind = Object.fromEntries(out.map((s) => [s.kind, s.gain]));
    // Olmazsa olmazların hepsi kalkınca üç aday da açılır; ilçe kaldırma iki, bütçe +%20 bir aday kazandırır.
    expect(out[0]!.kind).toBe("drop_required");
    expect(byKind).toMatchObject({ drop_required: 3, drop_district: 2, budget20: 1 });
    expect(out.every((s) => s.gain > 0)).toBe(true);
  });
  it("aday yoksa öneri yok (uydurma kazanç yok)", () => {
    expect(suggestWidening({ demand: demand(), properties: [], customerId: null })).toEqual([]);
  });
});
