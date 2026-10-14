import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261015020000 — advisor_counts (KQ5).
 * - Danışman başına atanmış silinmemiş müşteri + yayındaki portföy tek sorguda; kaydı olmayan kimlik 0 döner.
 * - Örnek veri kuralı (p_include_sample=false → is_sample=false) ve kiracı süzgeci (p_tenant_id) istemci yoluyla aynı.
 * - SECURITY INVOKER: RLS çağıranın yetkisiyle uygulanır (başka kiracının satırı sayılmaz).
 */
const mod = await loadPglite();
const MIGRATION = readFileSync(resolve(process.cwd(), "supabase/migrations/20261015020000_advisor_counts_rpc.sql"), "utf8");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

const SCHEMA = `
create role authenticated; create role anon; create role service_role;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create table public.customers(id serial primary key, tenant_id uuid not null, assigned_to uuid, is_sample boolean not null default false, deleted_at timestamptz);
create table public.properties(id serial primary key, tenant_id uuid not null, assigned_to uuid, status text, is_sample boolean not null default false, deleted_at timestamptz);
alter table public.customers enable row level security;
alter table public.properties enable row level security;
create policy c_sel on public.customers for select to authenticated using (tenant_id = public.current_tenant_id());
create policy p_sel on public.properties for select to authenticated using (tenant_id = public.current_tenant_id());
grant usage on schema public to authenticated;
grant select on public.customers, public.properties to authenticated;
`;

describe.skipIf(!mod)("advisor_counts (pglite)", () => {
  let db: Db;
  const counts = async (args: { ids: string[]; tenant?: string | null; sample?: boolean }, as: "authenticated" | "postgres" = "authenticated") => {
    await db.exec(`reset role; select set_config('test.tenant', '${T}', false)`);
    if (as === "authenticated") await db.exec("set role authenticated");
    const rows = (
      await db.query("select profile_id, customers, live_properties from public.advisor_counts($1::uuid[], $2::uuid, $3::boolean) order by profile_id", [
        args.ids,
        args.tenant ?? null,
        args.sample ?? false,
      ])
    ).rows;
    await db.exec("reset role");
    return rows;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(SCHEMA);
    await db.exec(MIGRATION.replace(/^set local lock_timeout.*$/m, "").replace(/^notify pgrst.*$/m, ""));
    await db.exec(`
      insert into public.customers (tenant_id, assigned_to, is_sample, deleted_at) values
        ('${T}', '${U1}', false, null), ('${T}', '${U1}', false, null), ('${T}', '${U1}', true, null),
        ('${T}', '${U1}', false, now()), ('${T}', '${U2}', false, null), ('${T2}', '${U1}', false, null), ('${T}', null, false, null);
      insert into public.properties (tenant_id, assigned_to, status, is_sample, deleted_at) values
        ('${T}', '${U1}', 'live', false, null), ('${T}', '${U1}', 'Yayında', false, null), ('${T}', '${U1}', 'draft', false, null),
        ('${T}', '${U1}', 'live', true, null), ('${T}', '${U2}', 'live', false, now()), ('${T2}', '${U2}', 'live', false, null);
    `);
  });

  it("danışman başına sayım tek sorguda; kaydı olmayan kimlik 0", async () => {
    expect(await counts({ ids: [U1, U2, U3, U1] })).toEqual([
      { profile_id: U1, customers: 2, live_properties: 2 },
      { profile_id: U2, customers: 1, live_properties: 0 },
      { profile_id: U3, customers: 0, live_properties: 0 },
    ]);
  });

  it("örnek veri dahilse is_sample süzülmez", async () => {
    const rows = await counts({ ids: [U1], sample: true });
    expect(rows).toEqual([{ profile_id: U1, customers: 3, live_properties: 3 }]);
  });

  it("RLS (SECURITY INVOKER): başka kiracının satırı sayılmaz; RLS'siz çağıranda p_tenant_id sınırı uygular", async () => {
    // postgres (RLS atlanır) + kiracı süzgeci: aynı sonuç.
    expect(await counts({ ids: [U1, U2], tenant: T }, "postgres")).toEqual(await counts({ ids: [U1, U2] }));
    // Süzgeçsiz RLS'siz çağıran öbür kiracıyı da görür (fark yalnız RLS'den gelir).
    const unscoped = await counts({ ids: [U1] }, "postgres");
    expect(unscoped[0]!.customers).toBe(3);
  });

  it("boş/null liste satır döndürmez", async () => {
    expect(await counts({ ids: [] })).toEqual([]);
  });
});
