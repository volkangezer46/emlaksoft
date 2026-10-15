import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { GEO_CACHE_TAG } from "./types";

/**
 * İlçe merkez koordinatları (geo_districts.lat/lng) — bölge analizi haritası (PF-11) için. Coğrafya verisi global ve
 * kiracısızdır; tek önbellekli kopya (reader.ts ile aynı desen, 15 dk + geo yazımında etiketle tazelenir).
 * Koordinatı olmayan ilçe haritada gösterilmez (uydurma konum yok).
 */
const loadCenters = unstable_cache(
  async (): Promise<Array<[string, number, number]>> => {
    const admin = createAdminClient();
    const out: Array<[string, number, number]> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("geo_districts")
        .select("id, lat, lng")
        .not("lat", "is", null)
        .not("lng", "is", null)
        .order("id")
        .range(from, from + 999);
      if (error || !data) break;
      for (const r of data as Array<{ id: string; lat: number | string; lng: number | string }>) {
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push([r.id, lat, lng]);
      }
      if (data.length < 1000) break;
    }
    return out;
  },
  ["geo-district-centers-v1"],
  { revalidate: 900, tags: [GEO_CACHE_TAG] },
);

export async function getDistrictCenters(ids: Iterable<string>): Promise<Map<string, { lat: number; lng: number }>> {
  const want = new Set(ids);
  const map = new Map<string, { lat: number; lng: number }>();
  if (want.size === 0) return map;
  for (const [id, lat, lng] of await loadCenters()) if (want.has(id)) map.set(id, { lat, lng });
  return map;
}
