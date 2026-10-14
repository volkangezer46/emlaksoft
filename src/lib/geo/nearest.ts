import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistrict, getNeighborhood, getProvince, getProvinces } from "./reader";

/**
 * GPS konumundan il / ilçe / mahalle ÖNERİSİ (sahada "Konumumu kullan").
 *
 * Kaynak sırası (ilk bulunan kazanır, hepsi yaklaşık ve kullanıcı onayıyla uygulanır):
 *   1) Koordinatı olan EN YAKIN mahalle (geo_neighborhoods.lat/lng; ≤ 3 km)
 *   2) Ofisin kendi konumlu portföylerinden en yakını (≤ 1,5 km; RLS ile yalnız görülebilen portföyler) — mahalle
 *      koordinatı henüz yüklenmemiş bölgelerde gerçek veriye dayanan en iyi tahmin
 *   3) Koordinatı olan en yakın ilçe (≤ 15 km)
 *   4) En yakın il merkezi (≤ 120 km) — yalnız il
 * Hiçbiri yoksa öneri yok (uydurma yok). Coğrafya tabloları herkese açık okunur; oturumlu istemci yeterlidir.
 */

export type GeoPointSuggestion = {
  provinceId: string | null;
  provinceName: string | null;
  districtId: string | null;
  districtName: string | null;
  neighborhoodId: string | null;
  neighborhoodName: string | null;
  source: "mahalle" | "portfoy" | "ilce" | "il";
  distanceKm: number;
  label: string;
};

type Pt = { lat: number; lng: number };

/** İki nokta arası büyük daire mesafesi (km). */
export function haversineKm(a: Pt, b: Pt): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Noktaya en yakın aday (eşik içinde). */
export function pickNearest<T extends { lat: number | null; lng: number | null }>(
  origin: Pt,
  rows: readonly T[],
  maxKm: number,
): { row: T; km: number } | null {
  let best: { row: T; km: number } | null = null;
  for (const r of rows) {
    if (typeof r.lat !== "number" || typeof r.lng !== "number" || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const km = haversineKm(origin, { lat: r.lat, lng: r.lng });
    if (km <= maxKm && (!best || km < best.km)) best = { row: r, km };
  }
  return best;
}

/** Enlem/boylam kutusu (± km) — indeks dostu ön süzgeç. */
export function bbox(p: Pt, km: number) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
  return { minLat: p.lat - dLat, maxLat: p.lat + dLat, minLng: p.lng - dLng, maxLng: p.lng + dLng };
}

export function isValidPoint(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function labelOf(s: Omit<GeoPointSuggestion, "label" | "source" | "distanceKm">): string {
  return [s.neighborhoodName ? `${s.neighborhoodName} Mah.` : null, s.districtName, s.provinceName].filter(Boolean).join(", ");
}

async function chainFrom(ids: { provinceId?: string | null; districtId?: string | null; neighborhoodId?: string | null }) {
  const [neighborhood, district0] = await Promise.all([
    ids.neighborhoodId ? getNeighborhood(ids.neighborhoodId) : Promise.resolve(null),
    ids.districtId ? getDistrict(ids.districtId) : Promise.resolve(null),
  ]);
  const district = district0 ?? (neighborhood ? await getDistrict(neighborhood.districtId) : null);
  const province = await getProvince(ids.provinceId ?? district?.provinceId ?? null);
  const out = {
    provinceId: province?.id ?? null,
    provinceName: province?.name ?? null,
    districtId: district?.id ?? null,
    districtName: district?.name ?? null,
    neighborhoodId: neighborhood?.id ?? null,
    neighborhoodName: neighborhood?.name ?? null,
  };
  return out;
}

export async function suggestGeoForPoint(supabase: SupabaseClient, origin: Pt): Promise<GeoPointSuggestion | null> {
  const round = (km: number) => Math.round(km * 10) / 10;

  const nb = bbox(origin, 3);
  const pb = bbox(origin, 1.5);
  const db = bbox(origin, 15);
  const [neighborhoods, properties, districts] = await Promise.all([
    supabase
      .from("geo_neighborhoods")
      .select("id, district_id, lat, lng")
      .eq("is_active", true)
      .gte("lat", nb.minLat)
      .lte("lat", nb.maxLat)
      .gte("lng", nb.minLng)
      .lte("lng", nb.maxLng)
      .limit(300),
    supabase
      .from("properties")
      .select("lat, lng, province_id, district_id, neighborhood_id")
      .is("deleted_at", null)
      .not("district_id", "is", null)
      .gte("lat", pb.minLat)
      .lte("lat", pb.maxLat)
      .gte("lng", pb.minLng)
      .lte("lng", pb.maxLng)
      .limit(200),
    supabase
      .from("geo_districts")
      .select("id, province_id, lat, lng")
      .eq("is_active", true)
      .gte("lat", db.minLat)
      .lte("lat", db.maxLat)
      .gte("lng", db.minLng)
      .lte("lng", db.maxLng)
      .limit(100),
  ]);

  type NRow = { id: string; district_id: string; lat: number | null; lng: number | null };
  const n = pickNearest(origin, (neighborhoods.data ?? []) as NRow[], 3);
  if (n) {
    const chain = await chainFrom({ neighborhoodId: n.row.id, districtId: n.row.district_id });
    if (chain.districtId) return { ...chain, source: "mahalle", distanceKm: round(n.km), label: labelOf(chain) };
  }

  type PRow = { lat: number | null; lng: number | null; province_id: string | null; district_id: string | null; neighborhood_id: string | null };
  const p = pickNearest(origin, (properties.data ?? []) as PRow[], 1.5);
  if (p) {
    const chain = await chainFrom({ provinceId: p.row.province_id, districtId: p.row.district_id, neighborhoodId: p.row.neighborhood_id });
    if (chain.districtId) return { ...chain, source: "portfoy", distanceKm: round(p.km), label: labelOf(chain) };
  }

  type DRow = { id: string; province_id: string; lat: number | null; lng: number | null };
  const d = pickNearest(origin, (districts.data ?? []) as DRow[], 15);
  if (d) {
    const chain = await chainFrom({ districtId: d.row.id, provinceId: d.row.province_id });
    if (chain.districtId) return { ...chain, source: "ilce", distanceKm: round(d.km), label: labelOf(chain) };
  }

  const provinces = await getProvinces();
  const pr = pickNearest(origin, provinces, 120);
  if (pr) {
    const chain = {
      provinceId: pr.row.id,
      provinceName: pr.row.name,
      districtId: null,
      districtName: null,
      neighborhoodId: null,
      neighborhoodName: null,
    };
    return { ...chain, source: "il", distanceKm: round(pr.km), label: labelOf(chain) };
  }
  return null;
}
