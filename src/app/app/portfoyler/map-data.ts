import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAreaCentroids } from "@/lib/geo/address-resolve-server";
import type { MapViewProperty } from "./map-view";

/**
 * Harita görünümü veri eşleyicisi: portföyün kendi koordinatı varsa o, yoksa MAHALLE merkezi (içi boş "yaklaşık" iğne).
 * Aynı mahalledeki konumsuz portföyler üst üste binmesin diye kimlikten türeyen küçük (~100 m) sabit kaydırma uygulanır.
 * Mahalle merkezi bilinmeyen kayıt haritaya girmez (eksik sayısına eklenir).
 */

export type MapSourceRow = {
  id: string;
  title: string;
  price: string;
  lat: number | null;
  lng: number | null;
  neighborhood_id: string | null;
};

function jitter(id: string): { dLat: number; dLng: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const a = ((h >>> 0) % 360) * (Math.PI / 180);
  const r = 0.0004 + (((h >>> 9) % 100) / 100) * 0.0008;
  return { dLat: Math.sin(a) * r, dLng: Math.cos(a) * r };
}

const validCoord = (lat: unknown, lng: unknown) =>
  lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;

export async function buildMapPoints(
  supabase: Pick<SupabaseClient, "from">,
  rows: readonly MapSourceRow[],
): Promise<{ points: MapViewProperty[]; dropped: number }> {
  const needs = rows.filter((r) => !validCoord(r.lat, r.lng) && r.neighborhood_id).map((r) => r.neighborhood_id!);
  const centroids = needs.length ? await loadAreaCentroids(supabase, { neighborhoodIds: needs, districtIds: [] }) : null;
  const points: MapViewProperty[] = [];
  let dropped = 0;
  for (const r of rows) {
    if (validCoord(r.lat, r.lng)) {
      points.push({ id: r.id, title: r.title, price: r.price, lat: Number(r.lat), lng: Number(r.lng) });
      continue;
    }
    const c = r.neighborhood_id ? centroids?.neighborhoods.get(r.neighborhood_id) : undefined;
    if (!c) {
      dropped += 1;
      continue;
    }
    const j = jitter(r.id);
    points.push({ id: r.id, title: r.title, price: r.price, lat: c.lat + j.dLat, lng: c.lng + j.dLng, approx: true });
  }
  return { points, dropped };
}
