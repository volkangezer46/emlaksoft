/** Coğrafya merkezi — paylaşılan tipler (sunucu/istemci ortak). */

export type GeoLevel = "province" | "district" | "neighborhood";

export const GEO_LEVEL_LABEL: Record<GeoLevel, string> = {
  province: "İl",
  district: "İlçe",
  neighborhood: "Mahalle",
};

export type GeoOption = { id: string; name: string };

export type GeoProvince = {
  id: string;
  name: string;
  plateCode: number;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
};

export type GeoDistrict = {
  id: string;
  name: string;
  provinceId: string;
  isActive: boolean;
};

export type GeoNeighborhood = {
  id: string;
  name: string;
  districtId: string;
  isActive: boolean;
};

/** Zincir (kimlikler). Boş değer null. */
export type GeoChain = {
  province_id?: string | null;
  district_id?: string | null;
  neighborhood_id?: string | null;
};

export type ResolvedGeo = {
  provinceId: string | null;
  provinceName: string | null;
  districtId: string | null;
  districtName: string | null;
  neighborhoodId: string | null;
  neighborhoodName: string | null;
};

/** Metinden çözümleme sonucu. */
export type GeoResolution =
  | { status: "ok"; geo: ResolvedGeo; via: "exact" | "alias" | "fuzzy" }
  | { status: "ambiguous"; candidates: ResolvedGeo[] }
  | { status: "unmatched"; reason: string };

export type GeoResolveInput = {
  province?: string | null;
  district?: string | null;
  neighborhood?: string | null;
};

export const GEO_CACHE_TAG = "geo";
