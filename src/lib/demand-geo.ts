import type { SupabaseClient } from "@supabase/supabase-js";
import type { DemandCriteria } from "@/lib/demand-criteria";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GeoChain = {
  province_id?: string | null;
  district_id?: string | null;
  neighborhood_id?: string | null;
};

/**
 * İl → ilçe → mahalle zinciri tutarlı mı (denetim B13)? Yalnız biçim değil, gerçek hiyerarşi:
 * ilçe seçili ile ait olmalı; mahalle seçili ilçeye ait olmalı; ilçe/mahalle varsa üst seviye zorunlu.
 * Hata mesajı döner, geçerliyse null. Okuma hatasında güvenli tarafta kalınır (reddedilir).
 */
export async function validateGeoChain(supabase: SupabaseClient, chain: GeoChain): Promise<string | null> {
  const province = chain.province_id || null;
  const district = chain.district_id || null;
  const neighborhood = chain.neighborhood_id || null;
  for (const id of [province, district, neighborhood]) {
    if (id && !UUID_RE.test(id)) return "Bölge seçimi geçersiz.";
  }
  if (district && !province) return "İlçe seçmek için il seçilmelidir.";
  if (neighborhood && !district) return "Mahalle seçmek için ilçe seçilmelidir.";

  if (district) {
    const { data, error } = await supabase.from("geo_districts").select("province_id").eq("id", district).maybeSingle();
    if (error) return "Bölge doğrulanamadı. Lütfen tekrar deneyin.";
    if (!data || data.province_id !== province) return "Seçilen ilçe, seçilen ile ait değil.";
  }
  if (neighborhood) {
    const { data, error } = await supabase.from("geo_neighborhoods").select("district_id").eq("id", neighborhood).maybeSingle();
    if (error) return "Bölge doğrulanamadı. Lütfen tekrar deneyin.";
    if (!data || data.district_id !== district) return "Seçilen mahalle, seçilen ilçeye ait değil.";
  }
  return null;
}

type CriteriaPresence = {
  property_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  province_id: string | null;
  district_id: string | null;
  neighborhood_id: string | null;
};

/**
 * Sütunlar değişince `criteria.required` artık değeri kalmayan anahtarı "zorunlu" tutmasın:
 * değeri olmayan kriterler zorunlu listesinden düşürülür (yalnız sütunlardan bilinenler).
 */
export function pruneRequiredKeys(criteria: DemandCriteria, cols: CriteriaPresence): DemandCriteria {
  const hasLocation =
    Boolean(cols.province_id || cols.district_id || cols.neighborhood_id) || (criteria.extra_locations?.length ?? 0) > 0;
  const present: Partial<Record<string, boolean>> = {
    property_type: cols.property_type != null,
    budget: cols.budget_min != null || cols.budget_max != null,
    rooms: cols.rooms != null,
    sqm: cols.min_sqm != null || criteria.max_sqm != null,
    location: hasLocation,
  };
  const required = (criteria.required ?? []).filter((k) => present[k] !== false);
  return { ...criteria, required };
}
