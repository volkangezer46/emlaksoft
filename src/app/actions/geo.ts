"use server";

import { createClient } from "@/lib/supabase/server";
import { compareTr } from "@/lib/tr-text";

export type GeoOption = { id: string; name: string };

/**
 * İl → ilçe → mahalle kademeli seçimin veri ucu.
 *
 * NEDEN SERVER ACTION, NEDEN HEPSİNİ ÖNDEN YÜKLEMİYORUZ: 81 il, 973 ilçe,
 * 31.922 mahalle var. Mahallelerin tamamı ~1,5 MB'lık bir yük demek; her
 * portföy formunda bunu göndermek anlamsız. Ama seçim yapıldıktan sonra
 * alt küme küçük: bir ilde en fazla 39 ilçe, bir ilçede en fazla 183 mahalle.
 * Yani "il seçilince ilçeleri getir" tek bir küçük istek — sonrasında arama
 * tamamen istemcide, ağ turu olmadan çalışır.
 *
 * YETKİ: geo_* tabloları herkese açık okunur (RLS politikası `USING (true)`),
 * kiracıya özel veri içermez. Yine de kullanıcı oturumuyla giden istemci
 * kullanılıyor; service_role'a gerek yok.
 */

export async function listDistricts(provinceId: string): Promise<GeoOption[]> {
  if (!provinceId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("geo_districts")
    .select("id, name")
    .eq("province_id", provinceId)
    .eq("is_active", true);

  if (error || !data) return [];
  // Sıralama DB'de değil burada: PostgreSQL'in varsayılan koleksiyonu
  // Türkçe harf sırasını bilmez ("Çankaya" C'lerden sonra düşer).
  return data.sort((a, b) => compareTr(a.name, b.name));
}

export async function listNeighborhoods(districtId: string): Promise<GeoOption[]> {
  if (!districtId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("geo_neighborhoods")
    .select("id, name")
    .eq("district_id", districtId)
    .eq("is_active", true);

  if (error || !data) return [];
  return data.sort((a, b) => compareTr(a.name, b.name));
}

/**
 * İl seçmeden doğrudan ilçe aramak için — "Kadıköy" yazan kullanıcı önce
 * İstanbul'u bulmak zorunda kalmasın. `geo_districts.name` üzerinde trigram
 * indeksi var, bu yüzden `ilike` taraması ucuz.
 */
export async function searchDistricts(query: string, limit = 20) {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("geo_districts")
    .select("id, name, province_id, province:geo_provinces(name)")
    .ilike("name", `%${q}%`)
    .eq("is_active", true)
    .limit(limit);

  if (error || !data) return [];
  // supabase-js gömülü ilişkiyi dizi olarak tipler (tekil olsa bile); iki
  // biçimi de karşılıyoruz ki tip üretimi değişse de kırılmasın.
  const nameOf = (rel: unknown): string => {
    const row = Array.isArray(rel) ? rel[0] : rel;
    return (row as { name?: string } | null)?.name ?? "";
  };
  return data.map((d) => ({
    id: d.id,
    name: d.name,
    provinceId: d.province_id as string,
    provinceName: nameOf(d.province),
  }));
}
