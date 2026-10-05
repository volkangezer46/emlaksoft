import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { compareTr } from "@/lib/tr-text";
import { geoFold } from "./normalize";
import { validateChain } from "./validate";
import {
  GEO_CACHE_TAG,
  type GeoChain,
  type GeoDistrict,
  type GeoNeighborhood,
  type GeoOption,
  type GeoProvince,
} from "./types";

/**
 * COĞRAFYA OKUYUCULARI — sistemin il/ilçe/mahalle verisini okuyan TEK kapı.
 *
 * Veri global ve kiracısızdır (geo_* tabloları herkese açık okunur); bu yüzden
 * admin client + `unstable_cache` ile paylaşılan tek kopya güvenlidir. Yazım
 * `invalidateGeoCache()` (updateTag) ile anında tazelenir. Sıralama DB'de değil
 * burada (`compareTr`): PostgreSQL Türkçe harf sırasını bilmez.
 *
 * Pasif kayıt: yeni seçimde görünmez (varsayılan), mevcut kayıtta kalır
 * (`includeInactive: true` ya da kimlikle okuma).
 */

const TTL = 900; // 15 dk; yazımda updateTag ile anında tazelenir
const OPTS = { revalidate: TTL, tags: [GEO_CACHE_TAG] };

type ProvinceRow = { id: string; name: string; plate_code: number; lat: number | null; lng: number | null; is_active: boolean };
type DistrictRow = { id: string; name: string; province_id: string; is_active: boolean };
type NeighborhoodRow = { id: string; name: string; district_id: string; is_active: boolean };

const byName = <T extends { name: string }>(a: T, b: T) => compareTr(a.name, b.name);

/** Tüm iller (aktif+pasif) — saf okuma, süzme çağırana ait. */
const loadProvinces = unstable_cache(
  async (): Promise<GeoProvince[]> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("geo_provinces")
      .select("id, name, plate_code, lat, lng, is_active");
    if (error || !data) return [];
    return (data as ProvinceRow[])
      .map((r) => ({ id: r.id, name: r.name, plateCode: r.plate_code, lat: r.lat, lng: r.lng, isActive: r.is_active }))
      .sort(byName);
  },
  ["geo-provinces-v2"],
  OPTS,
);

/** Tüm ilçeler (≈973) — ad çözümleme, arama, ilçe→il için tek dizin. */
const loadDistricts = unstable_cache(
  async (): Promise<GeoDistrict[]> => {
    const admin = createAdminClient();
    // PostgREST satır tavanı (1000) ilçe sayısına çok yakın: sayfalayarak oku.
    const data: DistrictRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await admin
        .from("geo_districts")
        .select("id, name, province_id, is_active")
        .order("id")
        .range(from, from + 999);
      if (error || !page) return [];
      data.push(...(page as DistrictRow[]));
      if (page.length < 1000) break;
    }
    return data
      .map((r) => ({ id: r.id, name: r.name, provinceId: r.province_id, isActive: r.is_active }))
      .sort(byName);
  },
  ["geo-districts-v2"],
  OPTS,
);

function loadNeighborhoodsOf(districtId: string): Promise<GeoNeighborhood[]> {
  return unstable_cache(
    async (): Promise<GeoNeighborhood[]> => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("geo_neighborhoods")
        .select("id, name, district_id, is_active")
        .eq("district_id", districtId)
        .limit(2000);
      if (error || !data) return [];
      return (data as NeighborhoodRow[])
        .map((r) => ({ id: r.id, name: r.name, districtId: r.district_id, isActive: r.is_active }))
        .sort(byName);
    },
    ["geo-neighborhoods-v2", districtId],
    OPTS,
  )();
}

const toOption = (x: { id: string; name: string }): GeoOption => ({ id: x.id, name: x.name });

// ---------------------------------------------------------------- listeleme

/** İller. Varsayılan: yalnız aktif (yeni seçim). Mevcut kaydı düzenleyen ekranlar `includeInactive`. */
export async function getProvinces(opts?: { includeInactive?: boolean }): Promise<GeoProvince[]> {
  const all = await loadProvinces();
  return opts?.includeInactive ? all : all.filter((p) => p.isActive);
}

/** Dropdown için {id, name}. */
export async function getProvinceOptions(opts?: { includeInactive?: boolean }): Promise<GeoOption[]> {
  return (await getProvinces(opts)).map(toOption);
}

export async function getDistricts(provinceId: string, opts?: { includeInactive?: boolean }): Promise<GeoDistrict[]> {
  if (!provinceId) return [];
  const all = await loadDistricts();
  return all.filter((d) => d.provinceId === provinceId && (opts?.includeInactive || d.isActive));
}

export async function getDistrictOptions(provinceId: string, opts?: { includeInactive?: boolean }): Promise<GeoOption[]> {
  return (await getDistricts(provinceId, opts)).map(toOption);
}

export async function getNeighborhoods(districtId: string, opts?: { includeInactive?: boolean }): Promise<GeoNeighborhood[]> {
  if (!districtId) return [];
  const all = await loadNeighborhoodsOf(districtId);
  return opts?.includeInactive ? all : all.filter((n) => n.isActive);
}

export async function getNeighborhoodOptions(districtId: string, opts?: { includeInactive?: boolean }): Promise<GeoOption[]> {
  return (await getNeighborhoods(districtId, opts)).map(toOption);
}

/** Tüm ilçe dizini (aktif+pasif). Yalnız sunucu içi toplu çözümleme için. */
export async function getAllDistricts(): Promise<GeoDistrict[]> {
  return loadDistricts();
}

// ----------------------------------------------------------- kimlikle arama

export async function getProvince(id: string | null | undefined): Promise<GeoProvince | null> {
  if (!id) return null;
  return (await loadProvinces()).find((p) => p.id === id) ?? null;
}

export async function getDistrict(id: string | null | undefined): Promise<GeoDistrict | null> {
  if (!id) return null;
  return (await loadDistricts()).find((d) => d.id === id) ?? null;
}

/** Mahalle tek kayıt (31 bin satırlık dizini tutmayız; kimlikle tek sorgu). */
export async function getNeighborhood(id: string | null | undefined): Promise<GeoNeighborhood | null> {
  if (!id) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("geo_neighborhoods")
    .select("id, name, district_id, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as NeighborhoodRow;
  return { id: r.id, name: r.name, districtId: r.district_id, isActive: r.is_active };
}

export async function getProvinceName(id: string | null | undefined): Promise<string | null> {
  return (await getProvince(id))?.name ?? null;
}

export async function getDistrictName(id: string | null | undefined): Promise<string | null> {
  return (await getDistrict(id))?.name ?? null;
}

/** Çoklu ilçe adı: id → ad. Bilinmeyen kimlik haritada yok. */
export async function getDistrictNameMap(ids: Iterable<string>): Promise<Map<string, string>> {
  const want = new Set(ids);
  const out = new Map<string, string>();
  if (want.size === 0) return out;
  for (const d of await loadDistricts()) if (want.has(d.id)) out.set(d.id, d.name);
  return out;
}

export async function getProvinceNameMap(ids?: Iterable<string>): Promise<Map<string, string>> {
  const want = ids ? new Set(ids) : null;
  const out = new Map<string, string>();
  for (const p of await loadProvinces()) if (!want || want.has(p.id)) out.set(p.id, p.name);
  return out;
}

/** İlçenin ili (ilçe→il). */
export async function getProvinceIdOfDistrict(districtId: string): Promise<string | null> {
  return (await getDistrict(districtId))?.provinceId ?? null;
}

// ------------------------------------------------------------------- arama

/** İl seçmeden ilçe ara ("Kadıköy" → İstanbul). Türkçe katlamalı içerir eşleşmesi. */
export async function searchDistricts(query: string, limit = 20) {
  const q = geoFold(query);
  if (q.length < 2) return [];
  const [districts, provinceNames] = await Promise.all([loadDistricts(), getProvinceNameMap()]);
  const out: Array<{ id: string; name: string; provinceId: string; provinceName: string }> = [];
  for (const d of districts) {
    if (!d.isActive) continue;
    if (!geoFold(d.name).includes(q)) continue;
    out.push({ id: d.id, name: d.name, provinceId: d.provinceId, provinceName: provinceNames.get(d.provinceId) ?? "" });
    if (out.length >= limit) break;
  }
  return out;
}

/** Serbest metin → eşleşen il ve ilçe kimlikleri (liste araması için). */
export async function searchGeoIds(query: string, limits = { provinces: 20, districts: 50 }): Promise<{ provinceIds: string[]; districtIds: string[] }> {
  const q = geoFold(query);
  if (!q) return { provinceIds: [], districtIds: [] };
  const [provinces, districts] = await Promise.all([loadProvinces(), loadDistricts()]);
  return {
    provinceIds: provinces.filter((p) => geoFold(p.name).includes(q)).slice(0, limits.provinces).map((p) => p.id),
    districtIds: districts.filter((d) => geoFold(d.name).includes(q)).slice(0, limits.districts).map((d) => d.id),
  };
}

// --------------------------------------------------------------- doğrulama

/**
 * İl → ilçe → mahalle zinciri gerçek hiyerarşiye uyuyor mu? Hata mesajı döner, geçerliyse null.
 * `allowInactive`: mevcut kaydı değiştirmeden kaydeden akışlar için.
 */
export async function validateGeoChain(chain: GeoChain, opts?: { allowInactive?: boolean }): Promise<string | null> {
  return validateChain({ province: getProvince, district: getDistrict, neighborhood: getNeighborhood }, chain, opts);
}

/** Bir ilçe/mahalleden üst zinciri çıkarır (talep geo senkronu için). */
export async function getParentsOf(chain: GeoChain): Promise<{ provinceId: string | null; districtId: string | null }> {
  let districtId = chain.district_id || null;
  if (!districtId && chain.neighborhood_id) districtId = (await getNeighborhood(chain.neighborhood_id))?.districtId ?? null;
  const provinceId = chain.province_id || (districtId ? await getProvinceIdOfDistrict(districtId) : null);
  return { provinceId: provinceId ?? null, districtId };
}

/** Yönetici sağlık/sayım ekranları için toplam sayılar (aktif+pasif). */
export async function getGeoTotals(): Promise<{ provinces: number; districts: number; neighborhoods: number | null }> {
  const [p, d] = await Promise.all([loadProvinces(), loadDistricts()]);
  const admin = createAdminClient();
  const { count } = await admin.from("geo_neighborhoods").select("id", { count: "exact", head: true });
  return { provinces: p.length, districts: d.length, neighborhoods: count ?? null };
}

/** Kimlik listesiyle mahalle okuma (yinelenmeyen, sınırlı). Bilinmeyen kimlik sonuçta yok. */
export async function getNeighborhoodsByIds(ids: Iterable<string>): Promise<GeoNeighborhood[]> {
  const list = [...new Set([...ids].filter(Boolean))];
  const out: GeoNeighborhood[] = [];
  const admin = createAdminClient();
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await admin.from("geo_neighborhoods").select("id, name, district_id, is_active").in("id", list.slice(i, i + 200));
    for (const r of (data ?? []) as NeighborhoodRow[]) out.push({ id: r.id, name: r.name, districtId: r.district_id, isActive: r.is_active });
  }
  return out;
}

export async function getDistrictsByIds(ids: Iterable<string>): Promise<GeoDistrict[]> {
  const want = new Set(ids);
  if (want.size === 0) return [];
  return (await loadDistricts()).filter((d) => want.has(d.id));
}

export async function getProvincesByIds(ids: Iterable<string>): Promise<GeoProvince[]> {
  const want = new Set(ids);
  if (want.size === 0) return [];
  return (await loadProvinces()).filter((p) => want.has(p.id));
}

/** Toplam kayıt sayısı (aktif+pasif) — sistem durumu ekranı: `{ count }` biçimi. */
export async function geoRowCount(level: "province" | "district" | "neighborhood"): Promise<{ count: number | null }> {
  const admin = createAdminClient();
  const table = level === "province" ? "geo_provinces" : level === "district" ? "geo_districts" : "geo_neighborhoods";
  const { count } = await admin.from(table).select("id", { count: "exact", head: true });
  return { count: count ?? null };
}

/**
 * Eski `from("geo_districts").select("id, name, province_id, province:geo_provinces(name)")` biçimi:
 * `{ data: { id, name, province_id, province: { name } } | null }`.
 */
export async function districtWithProvinceResult(id: string | null | undefined): Promise<{
  data: { id: string; name: string; province_id: string; province: { name: string } | null } | null;
}> {
  const d = await getDistrict(id);
  if (!d) return { data: null };
  const province = await getProvince(d.provinceId);
  return { data: { id: d.id, name: d.name, province_id: d.provinceId, province: province ? { name: province.name } : null } };
}

/**
 * `{ data }` biçiminde il listesi — eski `supabase.from(...)` çağrısının yerini alır; böylece
 * `const [{ data: provinces }] = await Promise.all([...])` kalıpları değişmeden çalışır.
 */
export async function provinceOptionsResult(opts?: { includeInactive?: boolean }): Promise<{ data: GeoOption[] }> {
  return { data: await getProvinceOptions(opts) };
}
