import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261019050000 proje fiyat listesi (geçmiş tetiği, toplu zam + geri al, fiyat listesi
 * aktarımı) ve 20261019050001 paylaşım sütunları + galeri tablosu; ikisinin rollback'i. Şema sadeleştirilmiş taklit;
 * kiracı ve yetki ayarlanabilir oturum değişkeninden okunur. Gerçek RLS DENENMEZ.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const PRICING = read("supabase/migrations/20261019050000_project_unit_pricing.sql");
const PRICING_RB = read("supabase/rollbacks/20261019050000_project_unit_pricing.rollback.sql");
const PUBLIC_PAGE = read("supabase/migrations/20261019050001_project_public_page.sql");
const PUBLIC_PAGE_RB = read("supabase/rollbacks/20261019050001_project_public_page.rollback.sql");

const T = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as
  $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(text, text) returns boolean language sql stable as
  $$ select coalesce(current_setting('test.perm', true), '') like '%' || $2 || '%' $$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key default gen_random_uuid());
create table public.projects(id uuid primary key, tenant_id uuid not null references public.tenants(id), name text);
create table public.project_units(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, project_id uuid not null references public.projects(id) on delete cascade,
  block text, floor int, unit_no text not null, rooms text, gross_m2 numeric(8,1), list_price numeric(14,2),
  status text not null default 'available', customer_id uuid,
  unique nulls not distinct (project_id, block, unit_no));
create table public.unit_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid, unit_id uuid references public.project_units(id) on delete cascade);
insert into public.tenants values ('${T}'), ('${T2}');
insert into public.projects values ('${P}', '${T}', 'Deniz Evleri'), ('${P2}', '${T2}', 'Baska ofis');
insert into public.project_units(tenant_id, project_id, block, floor, unit_no, rooms, gross_m2, list_price, status) values
  ('${T}', '${P}', 'A', 1, '101', '2+1', 95, 1000000, 'available'),
  ('${T}', '${P}', 'A', 1, '102', '3+1', 120, 2000000, 'reserved'),
  ('${T}', '${P}', 'A', 2, '201', '3+1', 120, 3000000, 'sold'),
  ('${T}', '${P}', 'A', 2, '202', '3+1', 120, 4000000, 'deposit'),
  ('${T}', '${P}', 'A', 3, '301', '2+1', 95, 5000000, 'available'),
  ('${T2}', '${P2}', null, 1, '1', '1+1', 60, 900000, 'available');
insert into public.unit_payments(tenant_id, unit_id) select '${T}', id from public.project_units where unit_no = '301';
`;

describe.skipIf(!mod)("20261019050000/050001 proje fiyat listesi + paylaşım (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = (tenant: string, perm: string) =>
    db.exec(`select set_config('test.tenant', '${tenant}', false), set_config('test.perm', '${perm}', false)`);
  const price = async (unitNo: string) =>
    Number((await q(`select list_price from public.project_units where unit_no = $1 and project_id = $2`, [unitNo, P]))[0]!.list_price);
  const ids = async (...nos: string[]) =>
    (await q(`select id from public.project_units where project_id = $1 and unit_no = any($2::text[])`, [P, nos])).map((r) => r.id as string);

  beforeAll(async () => {
    if (!mod) return;
    db = new mod.PGlite();
    await db.exec(STUB);
    await db.exec(PRICING);
    await db.exec(PUBLIC_PAGE);
  });

  it("toplu zam: yalnız müsait/rezerve ve ödeme planı olmayan daireler değişir, geçmiş aynı partiyle yazılır", async () => {
    await as(T, "view,edit");
    const all = await ids("101", "102", "201", "202", "301");
    const [r] = await q(`select * from public.bulk_reprice_project_units($1, $2::uuid[], 'pct', 10, 1000, 'Ekim zammı')`, [P, all]);
    expect(r!.updated_count).toBe(2);
    expect(Number(r!.old_total)).toBe(3_000_000);
    expect(Number(r!.new_total)).toBe(3_300_000);
    expect(await price("101")).toBe(1_100_000);
    expect(await price("102")).toBe(2_200_000);
    expect(await price("201")).toBe(3_000_000); // satıldı
    expect(await price("202")).toBe(4_000_000); // kapora
    expect(await price("301")).toBe(5_000_000); // ödeme planı var
    const hist = await q(`select reason, batch_id from public.project_unit_price_history order by created_at`);
    expect(hist).toHaveLength(2);
    expect(hist.every((h) => h.reason === "Ekim zammı" && h.batch_id === r!.batch_id)).toBe(true);

    const [undo] = await q(`select public.undo_project_unit_reprice($1) as n`, [r!.batch_id]);
    expect(undo!.n).toBe(2);
    expect(await price("101")).toBe(1_000_000);
    expect(await price("102")).toBe(2_000_000);
  });

  it("geri al: fiyat arada elle değiştiyse o daireye dokunmaz", async () => {
    await as(T, "view,edit");
    const [r] = await q(`select * from public.bulk_reprice_project_units($1, $2::uuid[], 'fixed', -50000, 0, null)`, [P, await ids("101", "102")]);
    expect(r!.updated_count).toBe(2);
    await q(`update public.project_units set list_price = 777000 where unit_no = '101' and project_id = $1`, [P]);
    const [undo] = await q(`select public.undo_project_unit_reprice($1) as n`, [r!.batch_id]);
    expect(undo!.n).toBe(1);
    expect(await price("101")).toBe(777_000);
    expect(await price("102")).toBe(2_000_000);
    // Elle düzenleme de geçmişe düşer (parti kimliği olmadan).
    const manual = await q(`select batch_id from public.project_unit_price_history where new_price = 777000`);
    expect(manual[0]!.batch_id).toBeNull();
  });

  it("yetki, kiracı ve değer sınırları", async () => {
    await as(T, "view");
    await expect(q(`select * from public.bulk_reprice_project_units($1, $2::uuid[], 'pct', 5, 0, null)`, [P, await ids("101")])).rejects.toThrow(/yetki/);
    await as(T, "view,edit");
    await expect(q(`select * from public.bulk_reprice_project_units($1, $2::uuid[], 'pct', 500, 0, null)`, [P, await ids("101")])).rejects.toThrow(/Gecersiz/);
    await expect(q(`select * from public.bulk_reprice_project_units($1, $2::uuid[], 'pct', 5, 0, null)`, [P2, await ids("101")])).rejects.toThrow(/Proje bulunamadi/);
    // Başka ofisin dairesi kimlikle verilse bile değişmez.
    const foreign = (await q(`select id from public.project_units where project_id = $1`, [P2])).map((r) => r.id as string);
    const [r] = await q(`select * from public.bulk_reprice_project_units($1, $2::uuid[], 'pct', 5, 0, null)`, [P, foreign]);
    expect(r!.updated_count).toBe(0);
  });

  it("fiyat listesi aktarımı: eşleşen güncellenir, yeni eklenir, satılmış atlanır, ödeme planlı fiyat korunur", async () => {
    await as(T, "view,create,edit");
    const rows = [
      { block: "A", floor: 1, unit_no: "101", rooms: "2+1", gross_m2: 96, list_price: 1_250_000 },
      { block: "A", floor: 2, unit_no: "201", list_price: 9 },
      { block: "A", floor: 3, unit_no: "301", list_price: 9 },
      { block: "B", floor: 1, unit_no: "101", rooms: "1+1", gross_m2: 70, list_price: 800_000 },
      { block: "B", floor: 999, unit_no: "999" },
    ];
    const [r] = await q(`select * from public.import_project_units($1, $2::jsonb)`, [P, JSON.stringify(rows)]);
    expect(r).toEqual({ created_count: 1, updated_count: 2, skipped_count: 2 });
    expect(await price("101")).toBe(1_250_000);
    expect(await price("201")).toBe(3_000_000);
    expect(await price("301")).toBe(5_000_000);
    const reasons = await q(`select reason from public.project_unit_price_history where new_price = 1250000`);
    expect(reasons[0]!.reason).toBe("Fiyat listesi aktarimi");
  });

  it("paylaşım sütunları: varsayılan kapalı, token biçimi zorunlu", async () => {
    const [p] = await q(`select share_enabled, share_show_prices, share_token from public.projects where id = $1`, [P]);
    expect(p).toEqual({ share_enabled: false, share_show_prices: true, share_token: null });
    await expect(q(`update public.projects set share_token = 'kisa' where id = $1`, [P])).rejects.toThrow();
    await q(`update public.projects set share_token = $2 where id = $1`, [P, "a".repeat(43)]);
  });

  it("migration'lar yeniden uygulanabilir ve rollback temiz", async () => {
    await db.exec(PRICING);
    await db.exec(PUBLIC_PAGE);
    await db.exec(PUBLIC_PAGE_RB);
    await db.exec(PRICING_RB);
    const left = await q(
      `select count(*)::int as n from information_schema.tables where table_name in ('project_unit_price_history', 'project_media')`,
    );
    expect(left[0]!.n).toBe(0);
    const cols = await q(`select count(*)::int as n from information_schema.columns where table_name = 'projects' and column_name like 'share%'`);
    expect(cols[0]!.n).toBe(0);
  });
});
