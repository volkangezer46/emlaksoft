import { describe, expect, it } from "vitest";
import {
  planDistrictChanges,
  planNeighborhoodChanges,
} from "@/lib/geo-province-sync-core";

describe("province geo merge planning", () => {
  it("matches a renamed district by provider source id and preserves manual extras", () => {
    const result = planDistrictChanges(
      [{ id: 10, name: "Yeni İlçe Adı", provinceId: 46, population: 100 }],
      [
        { id: "district-1", name: "Eski İlçe Adı", source_id: 10, population: 90 },
        { id: "manual", name: "Elle Eklenen", source_id: null, population: null },
      ],
    );

    expect(result.updates).toEqual([{
      id: "district-1",
      name: "Yeni İlçe Adı",
      source_id: 10,
      population: 100,
    }]);
    expect(result.preservedExtra).toBe(1);
    expect(result.conflicts).toEqual([]);
  });

  it("adopts a same-name legacy row but never overwrites another provider identity", () => {
    const adopted = planDistrictChanges(
      [{ id: 10, name: "Afşin", provinceId: 46, population: 100 }],
      [{ id: "legacy", name: "  AFŞİN ", source_id: null, population: null }],
    );
    expect(adopted.updates[0]).toMatchObject({ id: "legacy", source_id: 10 });

    const conflict = planDistrictChanges(
      [{ id: 11, name: "Afşin", provinceId: 46, population: 100 }],
      [{ id: "owned", name: "Afşin", source_id: 10, population: 100 }],
    );
    expect(conflict.inserts).toEqual([]);
    expect(conflict.updates).toEqual([]);
    expect(conflict.conflicts).toEqual([{
      sourceId: 11,
      existingId: "owned",
      kind: "name_owned_by_other_source",
    }]);
  });

  it("keeps neighborhoods in their authoritative district and reports name ownership collisions", () => {
    const result = planNeighborhoodChanges(
      [{
        id: 30,
        name: "Merkez",
        provinceId: 46,
        districtId: 20,
        databaseDistrictId: "district-a",
        population: 1_000,
        postalCode: "46000",
      }],
      [{
        id: "existing",
        district_id: "district-a",
        name: "Merkez",
        source_id: 29,
        postal_code: "46000",
        population: 1_000,
      }],
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.inserts).toEqual([]);
    expect(result.preservedExtra).toBe(1);
  });
});
