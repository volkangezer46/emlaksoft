import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { SAMPLE_KPI_THRESHOLD } from "@/lib/sample-scope";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000810 tenant_expense_aggregates — örnek veri eşik kuralı (Raporlar/Komisyon ile
 * aynı, 20261006000710). Gerçek 20260802000440 gövdesi önce, sonra PB53 sürümü koşar: eşik altı ofiste örnek giderler
 * dahil + `sample_included=true`; eşik üstünde dışlanır; eşik parametresi; başka ofis; izin kapısı; 3 argümanlı eski çağrı;
 * rollback.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_sample boolean not null default false, deleted_at timestamptz);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_sample boolean not null default false, deleted_at timestamptz);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_sample boolean not null default false,
  category text not null default 'ofis', amount numeric not null, expense_date date not null);
`;

type Agg = {
  total: number;
  record_count: number;
  by_category: { category: string; total: number }[];
  monthly: { month_start: string; total: number }[];
  sample_included?: boolean;
};

describe.skipIf(!mod)("tenant_expense_aggregates örnek veri kapsamı (pglite)", () => {
  let db: Db;
  let T: string, T2: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (tenant: string, perms = "expenses:view") =>
    db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false),
      set_config('test.tenant','${tenant}',false), set_config('test.perms','${perms}',false)`);
  const call = async (args = "date '2026-10-01', date '2026-10-31', timestamptz '2026-10-15 12:00+03'") =>
    (await q(`select public.tenant_expense_aggregates(${args}) as r`))[0]!.r as Agg;
  const real = async (tenant: string, customers: number, properties: number) => {
    for (let i = 0; i < customers; i++) await q(`insert into public.customers(tenant_id) values ($1)`, [tenant]);
    for (let i = 0; i < properties; i++) await q(`insert into public.properties(tenant_id) values ($1)`, [tenant]);
  };
  const expense = (tenant: string, amount: number, sample: boolean, date = "2026-10-10", category = "ofis") =>
    q(`insert into public.expenses(tenant_id, amount, is_sample, expense_date, category) values ($1,$2,$3,$4,$5)`, [tenant, amount, sample, date, category]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260802000440_tenant_expense_aggregates.sql"));
    await db.exec(read("supabase/migrations/20261007000810_expense_aggregates_sample_scope.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    await expense(T, 1000, false, "2026-10-10", "kira");
    await expense(T, 500, true, "2026-10-12", "demo");
    await expense(T, 300, true, "2026-08-05", "demo");
    await expense(T2, 9999, false); // başka ofis asla karışmaz
  });

  it("eşik altı ofiste (gerçek müşteri/portföy < eşik) örnek giderler dahil ve sample_included=true", async () => {
    await real(T, 2, 1);
    await as(T);
    const r = await call();
    expect(r.sample_included).toBe(true);
    expect(Number(r.total)).toBe(1500);
    expect(Number(r.record_count)).toBe(2);
    expect(r.by_category.map((c) => c.category).sort()).toEqual(["demo", "kira"]);
  });

  it("eşik: müşteri VEYA portföy sayısı eşiğe ulaşınca örnek giderler dışlanır (includeSample ile aynı)", async () => {
    await as(T);
    await real(T, SAMPLE_KPI_THRESHOLD - 2, 0); // müşteri toplam = eşik (önceki 2 + 3), portföy = 1
    const byCustomers = await call();
    expect(byCustomers.sample_included).toBe(false);
    expect(Number(byCustomers.total)).toBe(1000);
    expect(Number(byCustomers.record_count)).toBe(1);
    expect(byCustomers.by_category).toEqual([{ category: "kira", total: 1000 }]);
    // yalnız portföy eşiği
    await q(`delete from public.customers where tenant_id = $1`, [T]);
    await real(T, 1, SAMPLE_KPI_THRESHOLD - 1); // portföy toplam = eşik, müşteri = 1
    expect((await call()).sample_included).toBe(false);
    // ikisi de eşik altına inince yeniden dahil (eşik - 1 sınırı)
    await q(`delete from public.properties where tenant_id = $1`, [T]);
    await real(T, 0, SAMPLE_KPI_THRESHOLD - 1);
    await q(`delete from public.customers where tenant_id = $1`, [T]);
    await real(T, SAMPLE_KPI_THRESHOLD - 1, 0);
    expect((await call()).sample_included).toBe(true);
    // son durum sonraki testler için: ikisi de eşik üstü
    await real(T, 1, SAMPLE_KPI_THRESHOLD);
  });

  it("son 6 ay trendi de örnek süzgecine uyar (filtreden bağımsız kalır)", async () => {
    await as(T);
    const r = await call("null, null, timestamptz '2026-10-15 12:00+03'");
    const sum = r.monthly.reduce((s, m) => s + Number(m.total), 0);
    expect(sum).toBe(1000); // 2026-08'deki 300 TL örnek gider düştü
    expect(r.monthly).toHaveLength(6);
    expect(Number(r.total)).toBe(1000);
  });

  it("silinmiş (deleted_at) müşteri/portföy eşik sayımına girmez", async () => {
    await q(`insert into public.customers(tenant_id, deleted_at) select $1, now() from generate_series(1, 20)`, [T]);
    await as(T);
    expect((await call()).sample_included).toBe(false); // zaten dışlanmıştı; silinmişler sayıyı bozmaz
    await q(`delete from public.customers where deleted_at is not null`);
  });

  it("p_sample_threshold: 100 -> dahil, 0/negatif -> her zaman dışlanır, null -> varsayılan 5", async () => {
    await as(T);
    const args = (t: string) => `date '2026-10-01', date '2026-10-31', timestamptz '2026-10-15 12:00+03', ${t}`;
    expect((await call(args("100"))).sample_included).toBe(true);
    expect(Number((await call(args("100"))).total)).toBe(1500);
    expect((await call(args("0"))).sample_included).toBe(false);
    expect((await call(args("-3"))).sample_included).toBe(false);
    expect((await call(args("null::integer"))).sample_included).toBe(false); // gerçek sayı >= 5
  });

  it("başka ofis verisi toplamlara girmez, yeni ofis kendi örneğini görür", async () => {
    await as(T2);
    const r = await call();
    expect(Number(r.total)).toBe(9999);
    expect(r.sample_included).toBe(true); // T2'de gerçek müşteri/portföy yok
  });

  it("eski 3 argümanlı çağrı biçimi (kod migration öncesi/sonrası) çalışır; izin ve ofis kapısı korunur", async () => {
    await as(T);
    const r = (await q(`select public.tenant_expense_aggregates(null, null) as r`))[0]!.r as Agg;
    expect(r).toHaveProperty("sample_included");
    await as(T, "");
    await expect(call()).rejects.toThrow(/forbidden/);
    await db.exec(`select set_config('test.tenant','',false), set_config('test.perms','expenses:view',false)`);
    await expect(call()).rejects.toThrow(/forbidden/);
    const sigs = await q(`select pg_get_function_identity_arguments(p.oid) as a from pg_proc p where p.proname = 'tenant_expense_aggregates'`);
    expect(sigs).toHaveLength(1); // eski imza düştü, belirsiz overload yok
  });

  it("rollback: 3 argümanlı eski gövde döner (örnek giderler yeniden dahil, sample_included yok)", async () => {
    await db.exec(read("supabase/rollbacks/20261007000810_expense_aggregates_sample_scope.rollback.sql"));
    await as(T);
    const r = (await q(`select public.tenant_expense_aggregates(null, null) as r`))[0]!.r as Agg;
    expect(r).not.toHaveProperty("sample_included");
    expect(Number(r.total)).toBe(1800);
    const sigs = await q(`select pg_get_function_identity_arguments(p.oid) as a from pg_proc p where p.proname = 'tenant_expense_aggregates'`);
    expect(sigs).toHaveLength(1);
  });
});

describe("Giderler sayfası sözleşmesi", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/app/giderler/page.tsx"), "utf8");
  it("sample_included kararını etikete bağlar ve RPC'ye eşik göndermez (migration öncesi/sonrası uyumlu)", () => {
    expect(page).toContain("aggregateSampleLabel(sample.seeded, aggregate.sample_included)");
    expect(page).toContain("<SampleDataBadge label={sampleLabel} />");
    expect(page).not.toContain("p_sample_threshold");
  });
});
