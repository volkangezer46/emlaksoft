import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { orIlike, safeLike } from "@/lib/pgrst";
import {
  VITRIN_PAGE_SIZE,
  hasAdvancedOnlyFilters,
  toSearchRpcFilters,
  type GeoLabel,
  type ListingFilters,
} from "./listing-filters";

/**
 * Vitrin ilan listesi veri katmanı (PUB-1 / PUB-2). Süzgeç + sıralama + sayfalama SUNUCUDA, tek RPC turunda
 * (`vitrin_listing_search`, migration 20261019010000): eski "60 satır çek, satılık/kiralığı bellekte süz" yolu kalktı.
 * RPC henüz yoksa (migration uygulanmadı) PostgREST yoluna düşülür: işlem/fiyat/oda/tür/konum süzgeci ve gerçek
 * sayfalama yine sunucudadır; yalnız m²/yaş/kat/eşya/site/kredi süzgeçleri ve m² fiyatı sıralaması devre dışı kalır
 * (`degraded`, ekranda belirtilir).
 */

type Admin = ReturnType<typeof createAdminClient>;

const MISSING_RPC = new Set(["PGRST202", "42883"]);

export type VitrinFacets = {
  rooms: string[];
  types: string[];
  provinces: (GeoLabel & { count: number })[];
  districts: (GeoLabel & { provinceId: string; count: number })[];
  neighborhoods: (GeoLabel & { districtId: string; count: number })[];
};

export type ListingPage = { ids: string[]; total: number; degraded: boolean };

const trSort = (a: string, b: string) => a.localeCompare(b, "tr");

type RawGeo = { id?: unknown; name?: unknown; count?: unknown; provinceId?: unknown; districtId?: unknown };

function geoRows(v: unknown): RawGeo[] {
  return (Array.isArray(v) ? v : []).filter(
    (g): g is RawGeo => Boolean(g && typeof g === "object" && typeof (g as RawGeo).id === "string" && typeof (g as RawGeo).name === "string"),
  );
}

const byName = (a: GeoLabel, b: GeoLabel) => trSort(a.name, b.name);

/** RPC jsonb çıktısını güvenle tipler (bozuk öğe atılır), Türkçe sıralar. */
export function parseFacets(raw: unknown): VitrinFacets {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x !== "").sort(trSort);
  const base = (g: RawGeo) => ({ id: String(g.id), name: String(g.name), count: Number(g.count) || 0 });
  return {
    rooms: strings(o.rooms),
    types: strings(o.types),
    provinces: geoRows(o.provinces).map(base).sort(byName),
    districts: geoRows(o.districts).map((g) => ({ ...base(g), provinceId: String(g.provinceId ?? "") })).sort(byName),
    neighborhoods: geoRows(o.neighborhoods).map((g) => ({ ...base(g), districtId: String(g.districtId ?? "") })).sort(byName),
  };
}

/** Süzgeç seçenekleri: yayındaki ilanların TAM kümesinden (RPC); RPC yoksa ilk 500 satırdan türetilir. */
export async function loadVitrinFacets(admin: Admin, tenantId: string): Promise<VitrinFacets> {
  const { data, error } = await admin.rpc("vitrin_listing_facets", { p_tenant_id: tenantId });
  if (!error) return parseFacets(data);
  if (!MISSING_RPC.has(String(error.code ?? ""))) console.error("vitrin_listing_facets", error.code);

  const { data: rows } = await admin
    .from("properties")
    .select("features, property_type, province:geo_provinces(id, name), district:geo_districts(id, name, province_id)")
    .eq("tenant_id", tenantId)
    .eq("status", "live")
    .is("deleted_at", null)
    .eq("is_sample", false)
    .or(OPEN_LISTING_OR_FILTER)
    .limit(500);
  const rooms = new Set<string>();
  const types = new Set<string>();
  const provinces = new Map<string, GeoLabel & { count: number }>();
  const districts = new Map<string, GeoLabel & { provinceId: string; count: number }>();
  type Rel<T> = T | T[] | null;
  const first = <T,>(v: Rel<T>) => (Array.isArray(v) ? (v[0] ?? null) : v);
  for (const r of rows ?? []) {
    const room = ((r.features ?? {}) as { rooms?: unknown }).rooms;
    if (typeof room === "string" && room) rooms.add(room);
    if (r.property_type) types.add(r.property_type);
    const pv = first(r.province as Rel<{ id: string; name: string }>);
    if (pv) provinces.set(pv.id, { id: pv.id, name: pv.name, count: (provinces.get(pv.id)?.count ?? 0) + 1 });
    const d = first(r.district as Rel<{ id: string; name: string; province_id: string }>);
    if (d) districts.set(d.id, { id: d.id, name: d.name, provinceId: d.province_id, count: (districts.get(d.id)?.count ?? 0) + 1 });
  }
  return {
    rooms: [...rooms].sort(trSort),
    types: [...types].sort(trSort),
    provinces: [...provinces.values()].sort((a, b) => trSort(a.name, b.name)),
    districts: [...districts.values()].sort((a, b) => trSort(a.name, b.name)),
    neighborhoods: [],
  };
}

/** Süzgece uyan ilanların sayfadaki id'leri (sıralı) + toplam. */
export async function searchVitrinListingIds(admin: Admin, tenantId: string, f: ListingFilters): Promise<ListingPage> {
  const offset = (f.sayfa - 1) * VITRIN_PAGE_SIZE;
  const rpc = (limit: number, off: number) =>
    admin.rpc("vitrin_listing_search", { p_tenant_id: tenantId, p_filters: toSearchRpcFilters(f), p_limit: limit, p_offset: off });
  const { data, error } = await rpc(VITRIN_PAGE_SIZE, offset);
  if (!error) {
    const rows = (data ?? []) as { id: string; total: number | string }[];
    if (rows.length) return { ids: rows.map((r) => r.id), total: Number(rows[0].total) || rows.length, degraded: false };
    if (offset === 0) return { ids: [], total: 0, degraded: false };
    // Son sayfanın ötesi: toplamı tek satırla öğren (ekran "ilk sayfaya dön" der).
    const head = await rpc(1, 0);
    const t = ((head.data ?? []) as { total: number | string }[])[0];
    return { ids: [], total: t ? Number(t.total) || 0 : 0, degraded: false };
  }
  if (!MISSING_RPC.has(String(error.code ?? ""))) console.error("vitrin_listing_search", error.code);
  return searchViaPostgrest(admin, tenantId, f, offset);
}

/** RPC yokken yedek yol (gerçek sayfalama + temel süzgeçler sunucuda). */
async function searchViaPostgrest(admin: Admin, tenantId: string, f: ListingFilters, offset: number): Promise<ListingPage> {
  let query = admin
    .from("properties")
    .select("id", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("status", "live")
    .is("deleted_at", null)
    .eq("is_sample", false)
    .or(OPEN_LISTING_OR_FILTER);
  if (f.tx === "kiralik") query = query.or("transaction_type.ilike.%kira%,transaction_type.eq.rent");
  else if (f.tx === "satilik") query = query.not("transaction_type", "ilike", "%kira%").neq("transaction_type", "rent");
  if (f.q && safeLike(f.q) !== "%%") query = query.or(orIlike(["title", "property_code"], f.q));
  if (f.min != null) query = query.gte("list_price", f.min);
  if (f.max != null) query = query.lte("list_price", f.max);
  if (f.oda) query = query.eq("features->>rooms", f.oda);
  if (f.tur) query = query.eq("property_type", f.tur);
  if (f.il) query = query.eq("province_id", f.il);
  if (f.ilce) query = query.eq("district_id", f.ilce);
  if (f.mahalle) query = query.eq("neighborhood_id", f.mahalle);
  if (f.sirala === "fiyat-artan") query = query.order("list_price", { ascending: true, nullsFirst: false });
  else if (f.sirala === "fiyat-azalan") query = query.order("list_price", { ascending: false, nullsFirst: false });
  else query = query.order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  const { data, count } = await query.range(offset, offset + VITRIN_PAGE_SIZE - 1);
  return { ids: (data ?? []).map((r) => r.id as string), total: count ?? 0, degraded: hasAdvancedOnlyFilters(f) };
}
