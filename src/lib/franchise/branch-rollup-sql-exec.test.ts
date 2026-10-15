import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { foldBranchRollup, parseBranchRollup, type BranchRollup } from "./branch-rollup";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016100300 — branch_rollup (P5).
 * - RPC çıktısı, eski sayfanın sayfalı tarama + JS katlamasıyla (foldBranchRollup) AYNI: aynı satırlar RLS altında
 *   okunup katlanır ve RPC sonucuyla karşılaştırılır (dönemli ve dönemsiz).
 * - İşlem şubesi atanan danışmanın AKTİF profilinden; pasif/atanmamış → null (Şubesiz). Silinmiş portföy/müşteri sayılmaz.
 * - SECURITY INVOKER: RLS çağıranın yetkisiyle (başka kiracının satırı sayılmaz); anon EXECUTE yok.
 */
const mod = await loadPglite();
const MIGRATION = readFileSync(resolve(process.cwd(), "supabase/migrations/20261016100300_branch_rollup_rpc.sql"), "utf8");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B1 = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const B2 = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const BX = "b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9"; // öbür kiracının şubesi
const U1 = "11111111-1111-4111-8111-111111111111"; // B1, aktif
const U2 = "22222222-2222-4222-8222-222222222222"; // B2, aktif
const U3 = "33333333-3333-4333-8333-333333333333"; // B1, PASİF → işlemleri Şubesiz
const U4 = "44444444-4444-4444-8444-444444444444"; // şubesiz, aktif
const U9 = "99999999-9999-4999-8999-999999999999"; // öbür kiracı

const SCHEMA = `
create role authenticated; create role anon; create role service_role;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create table public.profiles(id uuid primary key, tenant_id uuid not null, branch_id uuid, is_active boolean not null default true);
create table public.properties(id serial primary key, tenant_id uuid not null, branch_id uuid, deleted_at timestamptz);
create table public.customers(id serial primary key, tenant_id uuid not null, branch_id uuid, deleted_at timestamptz);
create table public.deals(id serial primary key, tenant_id uuid not null, assigned_to uuid, stage text not null default 'new',
  deal_value numeric, created_at timestamptz not null default now());
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.customers enable row level security;
alter table public.deals enable row level security;
create policy pf_sel on public.profiles for select to authenticated using (tenant_id = public.current_tenant_id());
create policy p_sel on public.properties for select to authenticated using (tenant_id = public.current_tenant_id());
create policy c_sel on public.customers for select to authenticated using (tenant_id = public.current_tenant_id());
create policy d_sel on public.deals for select to authenticated using (tenant_id = public.current_tenant_id());
grant usage on schema public to authenticated, anon;
grant select on public.profiles, public.properties, public.customers, public.deals to authenticated;
`;

const asObj = (m: BranchRollup) =>
  Object.fromEntries([...m].map(([k, v]) => [k ?? "null", { ...v, wonValue: Math.round(v.wonValue * 100) / 100 }]));

describe.skipIf(!mod)("branch_rollup (pglite)", () => {
  let db: Db;

  const asTenant = async <R>(fn: () => Promise<R>, role: "authenticated" | "anon" = "authenticated"): Promise<R> => {
    await db.exec(`reset role; select set_config('test.tenant', '${T}', false); set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };

  const rpc = (from: string | null, to: string | null) =>
    asTenant(async () => {
      const rows = (await db.query("select * from public.branch_rollup($1::timestamptz, $2::timestamptz)", [from, to])).rows;
      const parsed = parseBranchRollup(rows);
      expect(parsed).not.toBeNull();
      return parsed!;
    });

  /** Eski sayfa yolu: aynı süzgeçlerle satırları oku, JS'de katla. */
  const oldFold = (from: string | null, to: string | null) =>
    asTenant(async () => {
      const properties = (await db.query("select id, branch_id from public.properties where deleted_at is null")).rows;
      const customers = (await db.query("select id, branch_id from public.customers where deleted_at is null")).rows;
      const deals = (
        await db.query(
          `select id, assigned_to, deal_value::float8 as deal_value, stage, created_at from public.deals
           where ($1::timestamptz is null or created_at >= $1::timestamptz) and ($2::timestamptz is null or created_at <= $2::timestamptz)`,
          [from, to],
        )
      ).rows;
      const activeProfiles = (await db.query("select id, branch_id from public.profiles where is_active = true")).rows;
      return foldBranchRollup({
        properties: properties as { branch_id: string | null }[],
        customers: customers as { branch_id: string | null }[],
        deals: deals as { assigned_to: string | null; stage: string; deal_value: number | null }[],
        activeProfiles: activeProfiles as { id: string; branch_id: string | null }[],
      });
    });

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(SCHEMA);
    await db.exec(MIGRATION.replace(/^set local lock_timeout.*$/m, "").replace(/^notify pgrst.*$/m, ""));
    await db.exec(`
      insert into public.profiles (id, tenant_id, branch_id, is_active) values
        ('${U1}', '${T}', '${B1}', true), ('${U2}', '${T}', '${B2}', true), ('${U3}', '${T}', '${B1}', false),
        ('${U4}', '${T}', null, true), ('${U9}', '${T2}', '${BX}', true);
      insert into public.properties (tenant_id, branch_id, deleted_at) values
        ('${T}', '${B1}', null), ('${T}', '${B1}', null), ('${T}', '${B1}', now()), ('${T}', '${B2}', null),
        ('${T}', null, null), ('${T2}', '${BX}', null), ('${T2}', '${B1}', null);
      insert into public.customers (tenant_id, branch_id, deleted_at) values
        ('${T}', '${B1}', null), ('${T}', '${B2}', null), ('${T}', '${B2}', null), ('${T}', '${B2}', now()),
        ('${T}', null, null), ('${T2}', '${B1}', null);
      insert into public.deals (tenant_id, assigned_to, stage, deal_value, created_at) values
        ('${T}', '${U1}', 'won', 1000000.50, '2026-03-10T10:00:00Z'),
        ('${T}', '${U1}', 'won', null, '2026-03-31T23:59:59Z'),
        ('${T}', '${U1}', 'negotiation', 500000, '2026-03-15T00:00:00Z'),
        ('${T}', '${U2}', 'won', 2500000, '2026-01-05T00:00:00Z'),
        ('${T}', '${U2}', 'lost', 900000, '2026-03-20T00:00:00Z'),
        ('${T}', '${U3}', 'won', 300000, '2026-03-12T00:00:00Z'),
        ('${T}', '${U4}', 'won', 100000, '2026-03-02T00:00:00Z'),
        ('${T}', null, 'won', 50000, '2026-03-03T00:00:00Z'),
        ('${T}', null, 'new', null, '2026-04-01T00:00:00Z'),
        ('${T2}', '${U9}', 'won', 7000000, '2026-03-10T00:00:00Z');
    `);
  });

  it("dönemsiz: RPC eski JS katlamasıyla aynı", async () => {
    const viaRpc = await rpc(null, null);
    expect(asObj(viaRpc)).toEqual(asObj(await oldFold(null, null)));
    expect(asObj(viaRpc)).toEqual({
      [B1]: { properties: 2, customers: 1, dealsTotal: 3, won: 2, wonValue: 1000000.5 },
      [B2]: { properties: 1, customers: 2, dealsTotal: 2, won: 1, wonValue: 2500000 },
      // Şubesiz: şubesiz portföy/müşteri + pasif danışman (U3), şubesiz danışman (U4) ve atanmamış işlemler.
      null: { properties: 1, customers: 1, dealsTotal: 4, won: 3, wonValue: 450000 },
    });
  });

  it("dönemli (her iki uç dahil): RPC eski JS katlamasıyla aynı", async () => {
    const from = "2026-03-01T00:00:00";
    const to = "2026-03-31T23:59:59.999";
    const viaRpc = await rpc(from, to);
    expect(asObj(viaRpc)).toEqual(asObj(await oldFold(from, to)));
    // Dönem yalnız işlemleri süzer; envanter dönemden bağımsız.
    expect(viaRpc.get(B1)).toEqual({ properties: 2, customers: 1, dealsTotal: 3, won: 2, wonValue: 1000000.5 });
    expect(viaRpc.get(B2)).toEqual({ properties: 1, customers: 2, dealsTotal: 1, won: 0, wonValue: 0 });
  });

  it("RLS (SECURITY INVOKER): başka kiracının satırı sayılmaz; anon çağıramaz", async () => {
    const viaRpc = await rpc(null, null);
    expect(viaRpc.has(BX)).toBe(false);
    const total = [...viaRpc.values()].reduce((s, r) => s + r.wonValue, 0);
    expect(Math.round(total * 100) / 100).toBe(3950000.5);
    await expect(asTenant(() => db.query("select * from public.branch_rollup(null, null)"), "anon")).rejects.toThrow(/permission denied/);
  });
});

describe("parseBranchRollup", () => {
  it("bozuk yanıt null (sahte sıfır yok)", () => {
    expect(parseBranchRollup(null)).toBeNull();
    expect(parseBranchRollup([{ branch_id: 5, properties: 1, customers: 0, deals_total: 0, deals_won: 0, won_value: 0 }])).toBeNull();
    expect(parseBranchRollup([{ branch_id: null, properties: 1, customers: 0, deals_total: 0, deals_won: 0, won_value: "x" }])).toBeNull();
  });
  it("numeric metin olarak gelen hacmi sayıya çevirir", () => {
    const m = parseBranchRollup([{ branch_id: null, properties: 1, customers: 2, deals_total: 3, deals_won: 1, won_value: "1500.25" }]);
    expect(m?.get(null)).toEqual({ properties: 1, customers: 2, dealsTotal: 3, won: 1, wonValue: 1500.25 });
  });
});
