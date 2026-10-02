import { describe, expect, it } from "vitest";
import {
  GeoProviderContractError,
  validateGeoProvinceSnapshot,
} from "@/lib/geo-provider";

const meta = { datasetVersion: "2025", lastUpdated: "2026-05-21" };

function fixtures() {
  return {
    province: {
      data: {
        id: 46,
        name: "Kahramanmaraş",
        population: 1_134_105,
        region: { tr: "Akdeniz" },
        coordinates: { latitude: 37.5753, longitude: 36.9228 },
        stats: { districtCount: 2, neighborhoodCount: 3 },
      },
      meta,
    },
    districts: {
      data: [
        { id: 2001, name: "Onikişubat", provinceId: 46, population: 460_000, stats: { neighborhoodCount: 2 } },
        { id: 2002, name: "Dulkadiroğlu", provinceId: 46, population: 220_000, stats: { neighborhoodCount: 1 } },
      ],
      meta: { ...meta, count: 2, total: 2, limit: 1_000, offset: 0 },
    },
    neighborhoods: {
      data: [
        { id: 3001, name: "A Mahallesi", provinceId: 46, districtId: 2001, population: 1_000, postalCode: "46050" },
        { id: 3002, name: "B Mahallesi", provinceId: 46, districtId: 2001, population: 2_000, postalCode: "46060" },
        { id: 3003, name: "C Mahallesi", provinceId: 46, districtId: 2002, population: 3_000, postalCode: "46100" },
      ],
      meta: { ...meta, count: 3, total: 3, limit: 1_000, offset: 0 },
    },
  };
}

function contractCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(GeoProviderContractError);
    return (error as GeoProviderContractError).code;
  }
}

describe("province geo provider contract", () => {
  it("accepts one complete, internally consistent province snapshot", () => {
    const source = fixtures();
    const result = validateGeoProvinceSnapshot(
      46,
      source.province,
      source.districts,
      source.neighborhoods,
    );

    expect(result.payload.province).toMatchObject({ id: 46, name: "Kahramanmaraş" });
    expect(result.payload.expectedDistrictCount).toBe(2);
    expect(result.payload.expectedNeighborhoodCount).toBe(3);
    expect(result.payload.neighborhoods).toHaveLength(3);
    expect(result.sourceVersion).toBe("2025");
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when pagination says the source response is partial", () => {
    const source = fixtures();
    source.neighborhoods.meta.total = 4;
    expect(contractCode(() => validateGeoProvinceSnapshot(
      46,
      source.province,
      source.districts,
      source.neighborhoods,
    ))).toBe("neighborhood_page_incomplete");
  });

  it("rejects a neighborhood outside the requested administrative chain", () => {
    const source = fixtures();
    source.neighborhoods.data[0].districtId = 9999;
    expect(contractCode(() => validateGeoProvinceSnapshot(
      46,
      source.province,
      source.districts,
      source.neighborhoods,
    ))).toBe("neighborhood_parent_mismatch");
  });

  it("rejects inconsistent dataset versions", () => {
    const source = fixtures();
    source.districts.meta.datasetVersion = "2024";
    expect(contractCode(() => validateGeoProvinceSnapshot(
      46,
      source.province,
      source.districts,
      source.neighborhoods,
    ))).toBe("source_version_mismatch");
  });

  it("rejects duplicate source identifiers", () => {
    const source = fixtures();
    source.neighborhoods.data[1].id = source.neighborhoods.data[0].id;
    expect(contractCode(() => validateGeoProvinceSnapshot(
      46,
      source.province,
      source.districts,
      source.neighborhoods,
    ))).toBe("duplicate_source_id");
  });

  it("keeps distinct source ids with the same district/name for database conflict accounting", () => {
    const source = fixtures();
    source.neighborhoods.data[1].name = source.neighborhoods.data[0].name;
    const result = validateGeoProvinceSnapshot(
      46,
      source.province,
      source.districts,
      source.neighborhoods,
    );
    expect(result.payload.neighborhoods).toHaveLength(3);
    expect(result.payload.neighborhoods[0].id).not.toBe(result.payload.neighborhoods[1].id);
  });
});
