import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261019010000_vitrin_listing_search — satılık/kiralık SORGUDA süzülür (eski 60 satır
 * sonrası bellek süzmesi yok), gerçek sayfalama + toplam, m²/yaş/kat/özellik/konum süzgeçleri, m² fiyatı sıralaması,
 * kapalı/örnek/silinmiş/başka ofis ilanı asla dönmez, seçenekler tam kümeden; 20261019010001 nearby_places şekil kuralı.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.geo_provinces(id uuid primary key default gen_random_uuid(), name text not null);
create table public.geo_districts(id uuid primary key default gen_random_uuid(), province_id uuid not null references public.geo_provinces(id), name text not null);
create table public.geo_neighborhoods(id uuid primary key default gen_random_uuid(), district_id uuid not null references public.geo_districts(id), name text not null);
create table public.properties(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, property_code text,
  transaction_type text, property_type text, list_price numeric, status text not null default 'live',
  deleted_at timestamptz, is_sample boolean not null default false, features jsonb not null default '{}'::jsonb,
  province_id uuid references public.geo_provinces(id), district_id uuid references public.geo_districts(id),
  neighborhood_id uuid references public.geo_neighborhoods(id), published_at timestamptz, created_at timestamptz not null default now());
create table public.property_media(id uuid primary key default gen_random_uuid(), property_id uuid not null, kind text not null);
`;

describe.skipIf(!mod)("vitrin listesi sunucu süzgeci (pglite)", () => {
  let db: Db;
  const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let P: string, D1: string, D2: string, N1: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const search = async (filters: Record<string, unknown>, limit = 24, offset = 0) =>
    q(`select id, total::int as total from public.vitrin_listing_search($1, $2::jsonb, $3, $4)`, [T, JSON.stringify(filters), limit, offset]);
  const titles = async (filters: Record<string, unknown>, limit = 24, offset = 0) => {
    const rows = await search(filters, limit, offset);
    if (!rows.length) return [];
    const byId = new Map((await q(`select id, title from public.properties`)).map((r) => [r.id, r.title]));
    return rows.map((r) => byId.get(r.id));
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    P = (await q(`insert into public.geo_provinces(name) values ('İstanbul') returning id`))[0]!.id as string;
    D1 = (await q(`insert into public.geo_districts(province_id, name) values ($1, 'Kadıköy') returning id`, [P]))[0]!.id as string;
    D2 = (await q(`insert into public.geo_districts(province_id, name) values ($1, 'Üsküdar') returning id`, [P]))[0]!.id as string;
    N1 = (await q(`insert into public.geo_neighborhoods(district_id, name) values ($1, 'Moda') returning id`, [D1]))[0]!.id as string;
    const ins = (title: string, tx: string, price: number | null, features: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      q(
        `insert into public.properties(tenant_id, title, property_code, transaction_type, property_type, list_price, features, province_id, district_id, neighborhood_id, published_at, status, is_sample, deleted_at)
         values ($1, $2, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13) returning id`,
        [
          extra.tenant ?? T, title, tx, extra.type ?? "Daire", price, JSON.stringify(features), P,
          extra.district === undefined ? D1 : extra.district, extra.neighborhood ?? null,
          extra.published ?? "2026-10-01T00:00:00Z", extra.status ?? "live", extra.sample ?? false, extra.deleted ?? null,
        ],
      );
    // 30 eski satılık (en yeni 60'ı doldurmasın diye değil: kiralığın sayfalamada görünmesi için).
    for (let i = 0; i < 30; i++) await ins(`S${i}`, "Satılık", 1_000_000 + i, { rooms: "2+1", sqm: 100 }, { published: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` });
    await ins("Kira-Moda", "Kiralık", 30_000, { rooms: "1+1", gross_sqm: 60, floor: 3, total_floors: 5, building_age: 2, furnished: "Eşyalı", in_site: true, credit_eligible: false }, { neighborhood: N1, published: "2026-08-01T00:00:00Z" });
    await ins("Kira-Eski", "rent", 20_000, { rooms: "2+1", sqm: "80", floor: 5, total_floors: 5, building_age: 30 }, { district: D2, published: "2026-08-02T00:00:00Z" });
    await ins("Ucuz-Buyuk", "Satılık", 2_000_000, { rooms: "4+1", gross_sqm: 400, floor: 0, building_age: 0, credit_eligible: true }, { type: "Villa", district: D2, published: "2026-07-01T00:00:00Z" });
    await ins("Kapali", "Satılık", 1, { closed_listing: true });
    await ins("Ornek", "Satılık", 1, {}, { sample: true });
    await ins("Silinmis", "Satılık", 1, {}, { deleted: "2026-10-01T00:00:00Z" });
    await ins("Taslak", "Satılık", 1, {}, { status: "draft" });
    await ins("Baska-Ofis", "Kiralık", 1, {}, { tenant: OTHER });
    const photoId = (await q(`select id from public.properties where title = 'S0'`))[0]!.id;
    await q(`insert into public.property_media(property_id, kind) values ($1, 'image')`, [photoId]);
    await db.exec(read("supabase/migrations/20261019010000_vitrin_listing_search.sql"));
  });

  it("kiralık SORGUDA süzülür: eski ilanlar 60'lık pencerenin dışında kalsa da görünür", async () => {
    const rows = await search({ tx: "kiralik" });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.total).toBe(2);
    expect((await search({ tx: "satilik" }))[0]!.total).toBe(31);
  });

  it("gerçek sayfalama: toplam sabit, sayfalar çakışmaz; tavan 60", async () => {
    const p1 = await search({}, 24, 0);
    const p2 = await search({}, 24, 24);
    expect(p1[0]!.total).toBe(33);
    expect(p2).toHaveLength(9);
    expect(new Set([...p1, ...p2].map((r) => r.id)).size).toBe(33);
    expect(await search({}, 500, 0)).toHaveLength(33);
    expect((await search({}, 500, 0)).length).toBeLessThanOrEqual(60);
  });

  it("kapalı, örnek, silinmiş, yayında olmayan ve başka ofis ilanı asla dönmez", async () => {
    const all = await titles({}, 60);
    for (const t of ["Kapali", "Ornek", "Silinmis", "Taslak", "Baska-Ofis"]) expect(all).not.toContain(t);
  });

  it("varsayılan sıra: fotoğraflı önce, sonra en yeni", async () => {
    const all = await titles({}, 60);
    expect(all[0]).toBe("S0");
  });

  it("m², yaş, kat ve özellik süzgeçleri (sayısal metin dahil)", async () => {
    expect(await titles({ sqm_min: 300 })).toEqual(["Ucuz-Buyuk"]);
    expect(await titles({ tx: "kiralik", sqm_max: 70 })).toEqual(["Kira-Moda"]);
    expect(await titles({ tx: "kiralik", sqm_min: 75 })).toEqual(["Kira-Eski"]);
    expect(await titles({ age_max: 0 })).toEqual(["Ucuz-Buyuk"]);
    expect(await titles({ floor: "giris" })).toEqual(["Ucuz-Buyuk"]);
    expect(await titles({ floor: "en-ust" })).toEqual(["Kira-Eski"]);
    expect(await titles({ floor: "ara" })).toEqual(["Kira-Moda"]);
    expect(await titles({ furnished: true })).toEqual(["Kira-Moda"]);
    expect(await titles({ in_site: true })).toEqual(["Kira-Moda"]);
    expect(await titles({ credit: true })).toEqual(["Ucuz-Buyuk"]);
  });

  it("konum süzgeci ve metin araması ilçe/mahalle adını da kapsar; LIKE jokerleri kaçışlı", async () => {
    expect(await titles({ neighborhood: N1 })).toEqual(["Kira-Moda"]);
    expect((await search({ district: D2 }))[0]!.total).toBe(2);
    expect(await titles({ q: "moda" })).toEqual(["Kira-Moda"]);
    expect((await search({ q: "üsküdar" })).length).toBe(2);
    expect(await search({ q: "%" })).toEqual([]);
    expect((await search({ district: "bozuk-uuid" }))[0]!.total).toBe(33);
  });

  it("m² fiyatı sıralaması (artan) ve fiyat sıralamasında fiyatsız sona", async () => {
    const byM2 = await titles({ sort: "m2-fiyat" }, 3);
    expect(byM2[0]).toBe("Kira-Eski"); // 20.000 / 80
    expect(byM2[1]).toBe("Kira-Moda"); // 30.000 / 60
    expect((await titles({ sort: "fiyat-azalan" }, 1))[0]).toBe("Ucuz-Buyuk");
  });

  it("seçenekler yayındaki tüm ilanlardan (kapalı/örnek hariç) ve sayılı", async () => {
    const facets = (await q(`select public.vitrin_listing_facets($1) as f`, [T]))[0]!.f as {
      rooms: string[];
      types: string[];
      districts: { name: string; count: number }[];
      neighborhoods: { name: string; districtId: string }[];
    };
    expect(facets.rooms).toEqual(["1+1", "2+1", "4+1"]);
    expect(facets.types).toEqual(["Daire", "Villa"]);
    expect(facets.districts.map((d) => [d.name, d.count])).toEqual([["Kadıköy", 31], ["Üsküdar", 2]]);
    expect(facets.neighborhoods).toEqual([expect.objectContaining({ name: "Moda", districtId: D1, id: N1 })]);
  });

  it("EXECUTE yalnız service_role", async () => {
    const r = await q(
      `select has_function_privilege('anon', 'public.vitrin_listing_search(uuid, jsonb, integer, integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.vitrin_listing_facets(uuid)', 'execute') as auth,
              has_function_privilege('service_role', 'public.vitrin_listing_search(uuid, jsonb, integer, integer)', 'execute') as svc`,
    );
    expect(r[0]).toEqual({ anon: false, auth: false, svc: true });
  });

  it("geri alma fonksiyonları düşürür", async () => {
    await db.exec(read("supabase/rollbacks/20261019010000_vitrin_listing_search.rollback.sql"));
    const r = await q(`select count(*)::int as n from pg_proc where proname like 'vitrin_listing_%' or proname = 'vitrin_json_number'`);
    expect(r[0]!.n).toBe(0);
  });

  it("nearby_places: varsayılan boş dizi, dizi olmayan ya da 24'ten uzun değer reddedilir; geri alınır", async () => {
    await db.exec(read("supabase/migrations/20261019010001_property_nearby_places.sql"));
    const id = (await q(`select id from public.properties limit 1`))[0]!.id;
    expect((await q(`select nearby_places from public.properties where id = $1`, [id]))[0]!.nearby_places).toEqual([]);
    await expect(q(`update public.properties set nearby_places = '{"c":"okul"}'::jsonb where id = $1`, [id])).rejects.toThrow();
    const many = JSON.stringify(Array.from({ length: 25 }, () => ({ c: "okul", n: "x", m: 100 })));
    await expect(q(`update public.properties set nearby_places = $2::jsonb where id = $1`, [id, many])).rejects.toThrow();
    await db.exec(read("supabase/rollbacks/20261019010001_property_nearby_places.rollback.sql"));
    const cols = await q(`select count(*)::int as n from information_schema.columns where table_name = 'properties' and column_name = 'nearby_places'`);
    expect(cols[0]!.n).toBe(0);
  });
});
