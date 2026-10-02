import { createHash } from "node:crypto";
import { z } from "zod";
import {
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";
import type {
  GeoSourceDistrict,
  GeoSourceNeighborhood,
  GeoSourceProvince,
} from "@/lib/geo-province-sync-core";

const TURKIYE_API_ORIGIN = "https://api.turkiyeapi.dev";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROVINCE_CHILDREN = 1_000;

const safeName = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const positiveId = z.number().int().positive();
const nullablePopulation = z.number().int().nonnegative().nullable().optional();

const sourceMetaSchema = z.object({
  datasetVersion: z.string().min(1).max(64),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const listMetaSchema = sourceMetaSchema.extend({
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

const provinceResponseSchema = z.object({
  data: z.object({
    id: z.number().int().min(1).max(81),
    name: safeName,
    population: nullablePopulation,
    region: z.object({ tr: safeName }).optional(),
    coordinates: z.object({
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    }).optional(),
    stats: z.object({
      districtCount: z.number().int().positive().max(100),
      neighborhoodCount: z.number().int().positive().max(MAX_PROVINCE_CHILDREN),
    }),
  }),
  meta: sourceMetaSchema,
});

const districtsResponseSchema = z.object({
  data: z.array(z.object({
    id: positiveId,
    name: safeName,
    provinceId: z.number().int().min(1).max(81),
    population: nullablePopulation,
    stats: z.object({
      neighborhoodCount: z.number().int().nonnegative().max(MAX_PROVINCE_CHILDREN),
    }),
  })).max(MAX_PROVINCE_CHILDREN),
  meta: listMetaSchema,
});

const neighborhoodsResponseSchema = z.object({
  data: z.array(z.object({
    id: positiveId,
    name: safeName,
    provinceId: z.number().int().min(1).max(81),
    districtId: positiveId,
    population: nullablePopulation,
    postalCode: z.string().regex(/^\d{5}$/).nullable().optional(),
  })).max(MAX_PROVINCE_CHILDREN),
  meta: listMetaSchema,
});

export type GeoProvinceSyncPayload = {
  province: GeoSourceProvince;
  expectedDistrictCount: number;
  expectedNeighborhoodCount: number;
  districts: GeoSourceDistrict[];
  neighborhoods: GeoSourceNeighborhood[];
};

export type GeoProvinceSnapshot = {
  payload: GeoProvinceSyncPayload;
  sourceVersion: string;
  sourceLastUpdated: string;
  sourceHash: string;
};

export class GeoProviderContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Geo provider returned an invalid or incomplete province snapshot.");
    this.name = "GeoProviderContractError";
    this.code = code;
  }
}

function assertPlateCode(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 81) {
    throw new RangeError("Province plate code must be an integer from 1 to 81.");
  }
  return value;
}

function uniqueIds(rows: ReadonlyArray<{ id: number }>): boolean {
  return new Set(rows.map((row) => row.id)).size === rows.length;
}

function assertCompletePage(
  meta: z.infer<typeof listMetaSchema>,
  rowCount: number,
  code: string,
): void {
  if (
    meta.offset !== 0
    || meta.limit > MAX_PROVINCE_CHILDREN
    || meta.count !== rowCount
    || meta.total !== rowCount
  ) {
    throw new GeoProviderContractError(code);
  }
}

function stableSourceHash(payload: GeoProvinceSyncPayload): string {
  const canonical = {
    province: payload.province,
    districts: [...payload.districts].sort((left, right) => left.id - right.id),
    neighborhoods: [...payload.neighborhoods].sort((left, right) => left.id - right.id),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function validateGeoProvinceSnapshot(
  plateCode: number,
  rawProvince: unknown,
  rawDistricts: unknown,
  rawNeighborhoods: unknown,
): GeoProvinceSnapshot {
  const expectedPlateCode = assertPlateCode(plateCode);
  const provinceResult = provinceResponseSchema.safeParse(rawProvince);
  const districtsResult = districtsResponseSchema.safeParse(rawDistricts);
  const neighborhoodsResult = neighborhoodsResponseSchema.safeParse(rawNeighborhoods);
  if (!provinceResult.success || !districtsResult.success || !neighborhoodsResult.success) {
    throw new GeoProviderContractError("schema_mismatch");
  }

  const provinceResponse = provinceResult.data;
  const districtsResponse = districtsResult.data;
  const neighborhoodsResponse = neighborhoodsResult.data;
  const { data: province } = provinceResponse;
  const districts = districtsResponse.data;
  const neighborhoods = neighborhoodsResponse.data;

  if (province.id !== expectedPlateCode) {
    throw new GeoProviderContractError("province_mismatch");
  }
  assertCompletePage(districtsResponse.meta, districts.length, "district_page_incomplete");
  assertCompletePage(neighborhoodsResponse.meta, neighborhoods.length, "neighborhood_page_incomplete");

  const metas = [provinceResponse.meta, districtsResponse.meta, neighborhoodsResponse.meta];
  if (metas.some((meta) => (
    meta.datasetVersion !== provinceResponse.meta.datasetVersion
    || meta.lastUpdated !== provinceResponse.meta.lastUpdated
  ))) {
    throw new GeoProviderContractError("source_version_mismatch");
  }
  if (!uniqueIds(districts) || !uniqueIds(neighborhoods)) {
    throw new GeoProviderContractError("duplicate_source_id");
  }
  if (districts.some((district) => district.provinceId !== expectedPlateCode)) {
    throw new GeoProviderContractError("district_parent_mismatch");
  }

  const districtIds = new Set(districts.map((district) => district.id));
  if (neighborhoods.some((row) => (
    row.provinceId !== expectedPlateCode || !districtIds.has(row.districtId)
  ))) {
    throw new GeoProviderContractError("neighborhood_parent_mismatch");
  }

  const expectedDistrictCount = province.stats.districtCount;
  const expectedNeighborhoodCount = province.stats.neighborhoodCount;
  if (expectedDistrictCount !== districts.length) {
    throw new GeoProviderContractError("district_count_mismatch");
  }
  if (expectedNeighborhoodCount !== neighborhoods.length) {
    throw new GeoProviderContractError("neighborhood_count_mismatch");
  }

  const actualByDistrict = new Map<number, number>();
  for (const neighborhood of neighborhoods) {
    actualByDistrict.set(
      neighborhood.districtId,
      (actualByDistrict.get(neighborhood.districtId) ?? 0) + 1,
    );
  }
  if (districts.some((district) => (
    district.stats.neighborhoodCount !== (actualByDistrict.get(district.id) ?? 0)
  ))) {
    throw new GeoProviderContractError("district_neighborhood_count_mismatch");
  }

  const payload: GeoProvinceSyncPayload = {
    province: {
      id: province.id,
      name: province.name,
      population: province.population ?? null,
      region: province.region?.tr ?? null,
      latitude: province.coordinates?.latitude ?? null,
      longitude: province.coordinates?.longitude ?? null,
    },
    expectedDistrictCount,
    expectedNeighborhoodCount,
    districts: districts.map((district) => ({
      id: district.id,
      name: district.name,
      provinceId: district.provinceId,
      population: district.population ?? null,
    })),
    neighborhoods: neighborhoods.map((neighborhood) => ({
      id: neighborhood.id,
      name: neighborhood.name,
      provinceId: neighborhood.provinceId,
      districtId: neighborhood.districtId,
      population: neighborhood.population ?? null,
      postalCode: neighborhood.postalCode ?? null,
    })),
  };

  return {
    payload,
    sourceVersion: provinceResponse.meta.datasetVersion,
    sourceLastUpdated: provinceResponse.meta.lastUpdated,
    sourceHash: stableSourceHash(payload),
  };
}

function provinceEndpoint(plateCode: number, resource: "province" | "districts" | "neighborhoods"): URL {
  const safePlateCode = assertPlateCode(plateCode);
  const path = resource === "province"
    ? `/v2/provinces/${safePlateCode}`
    : `/v2/provinces/${safePlateCode}/${resource}`;
  const endpoint = new URL(path, TURKIYE_API_ORIGIN);
  if (endpoint.origin !== TURKIYE_API_ORIGIN) {
    throw new GeoProviderContractError("unsafe_provider_origin");
  }
  if (resource === "province") {
    endpoint.searchParams.set("fields", "id,name,population,region,coordinates,stats");
  } else {
    endpoint.searchParams.set("limit", String(MAX_PROVINCE_CHILDREN));
    endpoint.searchParams.set("offset", "0");
    endpoint.searchParams.set(
      "fields",
      resource === "districts"
        ? "id,name,provinceId,population,stats"
        : "id,name,provinceId,districtId,population,postalCode",
    );
  }
  return endpoint;
}

async function fetchGeoJson(endpoint: URL): Promise<unknown> {
  if (endpoint.origin !== TURKIYE_API_ORIGIN || !endpoint.pathname.startsWith("/v2/provinces/")) {
    throw new GeoProviderContractError("unsafe_provider_url");
  }
  const response = await fetchExternal(
    endpoint,
    {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    },
    { timeoutMs: REQUEST_TIMEOUT_MS },
  );
  await requireExternalSuccess(response);
  return readExternalJson<unknown>(response, MAX_RESPONSE_BYTES);
}

export async function fetchGeoProvinceSnapshot(plateCode: number): Promise<GeoProvinceSnapshot> {
  const safePlateCode = assertPlateCode(plateCode);
  const [province, districts, neighborhoods] = await Promise.all([
    fetchGeoJson(provinceEndpoint(safePlateCode, "province")),
    fetchGeoJson(provinceEndpoint(safePlateCode, "districts")),
    fetchGeoJson(provinceEndpoint(safePlateCode, "neighborhoods")),
  ]);
  return validateGeoProvinceSnapshot(safePlateCode, province, districts, neighborhoods);
}
