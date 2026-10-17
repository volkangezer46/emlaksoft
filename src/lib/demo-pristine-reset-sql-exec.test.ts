import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * DM1 genel demo ofisi PRISTINE gece sıfırlaması — İŞLEVSEL SQL TESTİ (pglite; 20261015041000 → 20261016150301 →
 * 20261024020200 sırasıyla gerçek PL/pgSQL). Kanıtlanan:
 *  - "[SAHA]" test kalıntıları (ve onlara bağlı test anlaşması) silinir; kuru çalıştırma yalnız sayar.
 *  - Taban görüntüsü [SAHA] satırlarını içermez; ziyaretçinin tohumda yaptığı değişiklik ve silme gece geri alınır.
 *  - Görüntüde olmayan yeni sütuna dokunulmaz; gerçek kiracıda her fonksiyon reddeder.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, notes text,
  deleted_at timestamptz, created_at timestamptz default now());
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, list_price numeric,
  status text, deleted_at timestamptz, created_at timestamptz default now());
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id),
  customer_id uuid references public.customers(id), stage text, created_at timestamptz default now());
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, created_at timestamptz default now());
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, created_at timestamptz default now());
`;

const BASE = "2026-10-20T00:00:00Z";
const NIGHT = "2026-10-21T03:37:00Z";

describe.skipIf(!mod)("demo pristine sıfırlama — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  let DEMO: string;
  let REAL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261015041000_demo_tenant_nightly_reset.sql"));
    await db.exec(read("supabase/migrations/20261016150301_demo_reset_notification_reads.sql"));
    await db.exec(read("supabase/migrations/20261024020200_demo_tenant_pristine_reset.sql"));
    DEMO = String((await one(`insert into public.tenants(slug, name) values ('demo-ofis', 'Demo Emlak Ofisi') returning id`)).id);
    REAL = String((await one(`insert into public.tenants(slug, name) values ('gercek', 'Gerçek') returning id`)).id);
  });

  it("[SAHA] temizliği: kuru çalıştırma sayar, gerçek çalıştırma test kaydını ve ona bağlı anlaşmayı siler", async () => {
    const seedC = String((await one(`insert into public.customers(tenant_id, full_name, created_at) values ($1, 'Selin Aksoy', '2026-09-01') returning id`, [DEMO])).id);
    const sahaC = String((await one(`insert into public.customers(tenant_id, full_name, created_at) values ($1, '[SAHA] Hızlı Müşteri 1', '2026-09-02') returning id`, [DEMO])).id);
    const seedP = String((await one(`insert into public.properties(tenant_id, title, list_price, status, created_at) values ($1, 'Kadıköy 3+1', 12000000, 'live', '2026-09-01') returning id`, [DEMO])).id);
    await q(`insert into public.deals(tenant_id, property_id, customer_id, stage, created_at) values ($1, $2, $3, 'new', '2026-09-03')`, [DEMO, seedP, sahaC]);
    await q(`insert into public.deals(tenant_id, property_id, customer_id, stage, created_at) values ($1, $2, $3, 'negotiation', '2026-09-03')`, [DEMO, seedP, seedC]);
    await q(`insert into public.tasks(tenant_id, title, created_at) values ($1, '[SAHA] B053 iniş', '2026-09-04'), ($1, 'Selin Aksoy''u ara', '2026-09-04')`, [DEMO]);
    await q(`insert into public.customers(tenant_id, full_name) values ($1, '[SAHA] gerçek ofiste kalmalı')`, [REAL]);

    const dry = (await one(`select public.demo_tenant_saha_cleanup($1, $2::timestamptz, true) r`, [DEMO, BASE])).r as { total: number; tables: Record<string, number> };
    expect(dry).toMatchObject({ total: 2, tables: { customers: 1, tasks: 1 } });
    expect(Number((await one(`select count(*)::int n from public.customers where tenant_id = $1`, [DEMO])).n)).toBe(2);

    const real = (await one(`select public.demo_tenant_saha_cleanup($1, $2::timestamptz, false) r`, [DEMO, BASE])).r as { total: number; tables: Record<string, number> };
    expect(real.tables).toMatchObject({ customers: 1, tasks: 1, deals: 1 });
    expect((await q(`select full_name from public.customers where tenant_id = $1`, [DEMO])).map((r) => r.full_name)).toEqual(["Selin Aksoy"]);
    expect(Number((await one(`select count(*)::int n from public.deals where tenant_id = $1`, [DEMO])).n)).toBe(1);
    await expect(q(`select public.demo_tenant_saha_cleanup($1, now(), false)`, [REAL])).rejects.toThrow(/demo_reset_not_demo_tenant/);
    expect(Number((await one(`select count(*)::int n from public.customers where tenant_id = $1`, [REAL])).n)).toBe(1);
  });

  it("taban görüntüsü + gece: ziyaretçi düzenlemesi ve silmesi geri alınır, eklemeler silinir, yeni sütuna dokunulmaz", async () => {
    // [SAHA] satırı görüntüye girmemeli
    await q(`insert into public.tasks(tenant_id, title, created_at) values ($1, '[SAHA] sonradan', '2026-09-05')`, [DEMO]);
    const cap = (await one(`select public.demo_tenant_capture_baseline($1, $2::timestamptz) r`, [DEMO, BASE])).r as { captured: Record<string, number> };
    expect(cap.captured).toMatchObject({ customers: 1, properties: 1, deals: 1, tasks: 1 });
    await expect(q(`select public.demo_tenant_capture_baseline($1, now())`, [REAL])).rejects.toThrow(/demo_reset_not_demo_tenant/);

    // Ziyaretçi: tohum müşteri adını ve anlaşma aşamasını değiştirir, portföy fiyatını düşürür, görevi siler, yeni kayıt ekler.
    await q(`update public.customers set full_name = 'Ziyaretçi yazdı' where tenant_id = $1`, [DEMO]);
    await q(`update public.deals set stage = 'won' where tenant_id = $1`, [DEMO]);
    await q(`update public.properties set list_price = 1 where tenant_id = $1`, [DEMO]);
    await q(`delete from public.tasks where tenant_id = $1 and title not like '[SAHA]%'`, [DEMO]);
    await q(`insert into public.customers(tenant_id, full_name, created_at) values ($1, 'Ziyaretçi müşterisi', '2026-10-20T12:00:00Z')`, [DEMO]);
    // Görüntüden sonra eklenen sütun: geri yükleme dokunmamalı
    await db.exec(`alter table public.customers add column vip boolean default false`);
    await q(`update public.customers set vip = true where tenant_id = $1 and full_name = 'Ziyaretçi yazdı'`, [DEMO]);

    const r = (await one(`select public.demo_tenant_nightly_reset($1, $2::timestamptz) r`, [DEMO, NIGHT])).r as { deleted: Record<string, unknown> };
    expect(r.deleted).toMatchObject({ customers: 1, saha: { tasks: 1 } });
    expect((await q(`select full_name, vip from public.customers where tenant_id = $1`, [DEMO]))).toEqual([{ full_name: "Selin Aksoy", vip: true }]);
    expect((await one(`select stage from public.deals where tenant_id = $1`, [DEMO])).stage).toBe("negotiation");
    expect(Number((await one(`select list_price from public.properties where tenant_id = $1`, [DEMO])).list_price)).toBe(12000000);
    expect((await q(`select title from public.tasks where tenant_id = $1`, [DEMO])).map((x) => x.title)).toEqual(["Selin Aksoy'u ara"]);

    // İkinci gece değişiklik yoksa geri yükleme hiçbir satıra yazmaz
    const r2 = (await one(`select public.demo_tenant_nightly_reset($1, $2::timestamptz) r`, [DEMO, "2026-10-22T03:37:00Z"])).r as { deleted: Record<string, unknown> };
    expect(r2.deleted.restored).toBeUndefined();
  });
});
