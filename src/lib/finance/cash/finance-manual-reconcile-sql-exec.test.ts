import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013008200_finance_entries_manual_reconcile — toplu elle mutabakat.
 * Yalnız reconciled_at değişir; iptal edilmiş, düzeltme, başka ofis, yetkisiz hesap ve (yetkisiz rolde) maaş hareketi sayılmaz;
 * mutabakat kaldırılabilir; rollback fonksiyonu düşürür, işaretleri silmez.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("finance_entries_set_reconciled (pglite)", () => {
  let db: Db;
  let T: string, T2: string, OWNER: string, ACC: string, OTHER: string, OFFICE: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const FULL = "expenses:view expenses:create expenses:edit expenses:delete";
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const record = async (dir: string, amount: number, cat: string, title: string) =>
    (await rpc(`public.finance_record_entry($1::uuid, $2, $3::numeric, '2026-10-05'::date, $4, $5, null, null, null, 'manual', null, false, null)`,
      [OFFICE, dir, amount, cat, title])).entry_id as string;
  const mark = async (ids: string[], on: boolean) =>
    Number((await q(`select public.finance_entries_set_reconciled($1::uuid[], $2) as n`, [ids, on]))[0]!.n);
  const reconciled = async (id: string) => {
    await db.exec(`reset role`);
    return (await q(`select reconciled_at from public.cash_entries where id = $1`, [id]))[0]!.reconciled_at !== null;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ACC = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    OTHER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    // 20261011001200'ün eklediği kolon (o dosyanın geri kalanı bu RPC için gerekmez).
    await db.exec(`alter table public.cash_entries add column if not exists reconciled_at timestamptz`);
    await db.exec(read("supabase/migrations/20261013008200_finance_entries_manual_reconcile.sql"));
    await as(OWNER, T, FULL, "owner");
    OFFICE = (await rpc(`public.finance_account_create('office', 'cash', 'Ofis kasası', null, 'TRY', 1000::numeric, '2026-10-01'::date)`, [])).account_id as string;
  });

  it("yalnız reconciled_at değişir; iptal edilmiş hareket sayılmaz; kaldırılabilir", async () => {
    await as(OWNER, T, FULL, "owner");
    const a = await record("in", 100, "diger", "Tahsilat");
    const b = await record("out", 40, "ofis", "Kırtasiye");
    const v = await record("out", 5, "ofis", "İptal edilecek");
    await rpc(`public.finance_void_entry($1::uuid, 'deneme')`, [v]);
    await as(OWNER, T, FULL, "owner");
    expect(await mark([a, b, v], true)).toBe(2);
    expect(await reconciled(a)).toBe(true);
    expect(await reconciled(v)).toBe(false);
    const amount = (await q(`select amount::float8 as x from public.cash_entries where id = $1`, [b]))[0]!.x;
    expect(amount).toBe(40);
    await as(OWNER, T, FULL, "owner");
    expect(await mark([a, b], true)).toBe(0); // zaten mutabık
    expect(await mark([a], false)).toBe(1);
    expect(await reconciled(a)).toBe(false);
  });

  it("görüntüleme yetkisi, başka ofis ve yetkisiz rolde maaş hareketi işaretlenemez", async () => {
    await as(OWNER, T, FULL, "owner");
    const e = await record("in", 10, "diger", "Gelir");
    const sal = await record("out", 300, "maas", "Ekim maaşı");
    await as(ACC, T, "expenses:view", "accounting");
    expect(await mark([e], true)).toBe(0);
    await as(ACC, T, FULL, "accounting");
    expect(await mark([e, sal], true)).toBe(1);
    expect(await reconciled(sal)).toBe(false);
    await as(OTHER, T2, FULL, "owner");
    expect(await mark([sal], true)).toBe(0);
    await as(OWNER, T, FULL, "owner");
    expect(await mark([sal], true)).toBe(1);
  });

  it("boş liste reddedilir; oturumsuz çağrı reddedilir", async () => {
    await as(OWNER, T, FULL, "owner");
    await expect(q(`select public.finance_entries_set_reconciled('{}'::uuid[], true)`)).rejects.toThrow(/invalid_input/);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`);
    await expect(q(`select public.finance_entries_set_reconciled(array[gen_random_uuid()], true)`)).rejects.toThrow(/unauthorized/);
  });

  it("rollback fonksiyonu düşürür, mutabakat işaretleri kalır", async () => {
    await db.exec(`reset role`);
    const before = Number((await q(`select count(*)::int as n from public.cash_entries where reconciled_at is not null`))[0]!.n);
    expect(before).toBeGreaterThan(0);
    await db.exec(read("supabase/rollbacks/20261013008200_finance_entries_manual_reconcile.rollback.sql"));
    expect((await q(`select to_regprocedure('public.finance_entries_set_reconciled(uuid[],boolean)') as t`))[0]!.t).toBeNull();
    expect(Number((await q(`select count(*)::int as n from public.cash_entries where reconciled_at is not null`))[0]!.n)).toBe(before);
  });
});
