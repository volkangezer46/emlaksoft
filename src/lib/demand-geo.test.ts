import { describe, expect, it } from "vitest";
import { EMPTY_CRITERIA } from "./demand-criteria";
import { pruneRequiredKeys } from "./demand-geo";

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
