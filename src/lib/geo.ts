import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { compareTr } from "@/lib/tr-text";

export type GeoOption = { id: string; name: string };

/**
 * Geo referans verisi — 81 il, ~973 ilçe. Kiracıya özel veri İÇERMEZ
 * (geo_* tabloları herkese açık okunur), bu yüzden admin client +
 * `unstable_cache` ile navigasyonlar arası paylaşılan tek kopya güvenlidir.
 *
 * TTL 15 dk: geo listesi yalnızca platform admini /admin/geo'dan düzenler,
 * gecikme toleransı yüksek. Anında tazelemek için geo-admin action'ları
 * `revalidateTag(GEO_CACHE_TAG)` çağırmalı (bkz. src/app/actions/geo-admin.ts —
 * bu dosya bilinçli olarak burada değiştirilmedi, nota bakın).
 *
 * Sıralama DB'de değil burada (`compareTr`): PostgreSQL'in varsayılan
 * koleksiyonu Türkçe harf sırasını bilmez ("Çankaya" C'lerden sonra düşer).
 */
export const GEO_CACHE_TAG = "geo";
const GEO_TTL_SECONDS = 900; // 15 dk

/** İl listesi — cache'li. Dropdown/filtre kaynakları için. */
export const getProvincesCached = unstable_cache(
  async (): Promise<GeoOption[]> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("geo_provinces")
      .select("id, name")
      .eq("is_active", true);
    if (error || !data) return [];
    return data.sort((a, b) => compareTr(a.name, b.name));
  },
  ["geo-provinces"],
  { revalidate: GEO_TTL_SECONDS, tags: [GEO_CACHE_TAG] },
);

/** Bir ilin ilçeleri — il başına ayrı cache anahtarı. */
export function getDistrictsCached(provinceId: string): Promise<GeoOption[]> {
  if (!provinceId) return Promise.resolve([]);
  return unstable_cache(
    async (): Promise<GeoOption[]> => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("geo_districts")
        .select("id, name")
        .eq("province_id", provinceId)
        .eq("is_active", true);
      if (error || !data) return [];
      return data.sort((a, b) => compareTr(a.name, b.name));
    },
    ["geo-districts", provinceId],
    { revalidate: GEO_TTL_SECONDS, tags: [GEO_CACHE_TAG] },
  )();
}
