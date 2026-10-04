import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { GeoItem } from "./parse";

/**
 * Doğal dil ayrıştırıcısının konum listeleri — geo_* tabloları herkese açık okunur (RLS using true),
 * kiracı verisi içermez; kullanıcı oturumlu istemciyle okunur, service_role gerekmez.
 * 81 il + ~973 ilçe küçük; mahalleler (31.922) yalnız bulunan ilçe için çekilir.
 */

export const loadNlProvincesAndDistricts = cache(async (): Promise<{ provinces: GeoItem[]; districts: GeoItem[] }> => {
  const supabase = await createClient();
  const [prov, dist] = await Promise.all([
    supabase.from("geo_provinces").select("id, name").limit(200),
    supabase.from("geo_districts").select("id, name, province_id").eq("is_active", true).limit(1500),
  ]);
  return {
    provinces: (prov.data ?? []).map((p) => ({ id: p.id as string, name: p.name as string })),
    districts: (dist.data ?? []).map((d) => ({
      id: d.id as string,
      name: d.name as string,
      parentId: d.province_id as string | null,
    })),
  };
});

export async function loadNlNeighborhoods(districtId: string): Promise<GeoItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("geo_neighborhoods")
    .select("id, name, district_id")
    .eq("district_id", districtId)
    .eq("is_active", true)
    .limit(400);
  return (data ?? []).map((n) => ({ id: n.id as string, name: n.name as string, parentId: n.district_id as string | null }));
}
