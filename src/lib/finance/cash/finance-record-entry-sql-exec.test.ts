import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012001400_finance_entry_source_amount_guard — kaynaklı tahsilat hareketinde tutar tavanı,
 * hesaptan bağımsız mükerrer kontrolü (idempotent entry_id), normal tahsilat akışı, TL dışı hesapta tavan yok, rollback.
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
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  gross_amount numeric not null default 0, vat_amount numeric not null default 0, status text default 'calculated');
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, amount numeric not null default 0, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, amount numeric not null default 0, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("finance_record_entry kaynak tutar tavanı (pglite)", () => {
  let db: Db;
  let T: string, ACCOUNTANT: string, ACC1: string, ACC2: string, USD: string;
  let COMM: string, RENT: string, BLD: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const PERMS = "expenses:view expenses:create expenses:edit commissions:edit rentals:edit";
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const collect = (acc: string, amount: number, src: string, srcId: string) =>
    rpc(`public.finance_record_entry($1::uuid, 'in', $2::numeric, '2026-10-05'::date, 'komisyon', 'Tahsilat', null, null, null, $3, $4::uuid)`, [acc, amount, src, srcId]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ACCOUNTANT = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
    await db.exec(read("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
    await as(ACCOUNTANT, T, PERMS, "accountant");
    ACC1 = (await rpc(`public.finance_account_create('office','cash','Kasa 1',null,'TRY',0::numeric,'2026-10-01'::date)`, [])).account_id as string;
    ACC2 = (await rpc(`public.finance_account_create('office','bank','Banka 2',null,'TRY',0::numeric,'2026-10-01'::date)`, [])).account_id as string;
    USD = (await rpc(`public.finance_account_create('office','bank','Dolar',null,'USD',0::numeric,'2026-10-01'::date)`, [])).account_id as string;
    await db.exec(`reset role`);
    COMM = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 10000, 2000) returning id`, [T]))[0]!.id as string;
    RENT = (await q(`insert into public.rent_payments(tenant_id, amount) values ($1, 15000) returning id`, [T]))[0]!.id as string;
    BLD = (await q(`insert into public.building_payments(tenant_id, amount) values ($1, 800) returning id`, [T]))[0]!.id as string;
    await as(ACCOUNTANT, T, PERMS, "accountant");
  });

  it("muhasebe rolünde kaynak tutarını aşan giriş invalid_input / amount_exceeds_source döner", async () => {
    expect(await collect(ACC1, 12000.01, "commission", COMM)).toMatchObject({ outcome: "invalid_input", reason: "amount_exceeds_source" });
    expect(await collect(ACC1, 15000.01, "rent", RENT)).toMatchObject({ outcome: "invalid_input", reason: "amount_exceeds_source" });
    expect(await collect(ACC1, 800.01, "building", BLD)).toMatchObject({ outcome: "invalid_input", reason: "amount_exceeds_source" });
    await db.exec(`reset role`);
    expect(await q(`select 1 from public.cash_entries where source_id = any($1::uuid[])`, [[COMM, RENT, BLD]])).toHaveLength(0);
    await as(ACCOUNTANT, T, PERMS, "accountant");
  });

  it("normal tahsilat akışı ok: tavana eşit ve altındaki tutar kaydedilir (komisyon paid olmadan da)", async () => {
    expect((await collect(ACC1, 12000, "commission", COMM)).outcome).toBe("recorded");
    expect((await collect(ACC1, 500, "rent", RENT)).outcome).toBe("recorded");
    expect((await collect(ACC1, 800, "building", BLD)).outcome).toBe("recorded");
  });

  it("aynı komisyonu ikinci hesaba yazma duplicate döner ve mevcut entry_id'yi korur", async () => {
    await db.exec(`reset role`);
    const first = (await q(`select id from public.cash_entries where source_id = $1 and voided_at is null`, [COMM]))[0]!.id;
    await as(ACCOUNTANT, T, PERMS, "accountant");
    expect(await collect(ACC1, 12000, "commission", COMM)).toMatchObject({ outcome: "duplicate", entry_id: first });
    expect(await collect(ACC2, 100, "commission", COMM)).toMatchObject({ outcome: "duplicate", entry_id: first });
    await db.exec(`reset role`);
    expect(await q(`select 1 from public.cash_entries where source_id = $1 and voided_at is null`, [COMM])).toHaveLength(1);
    await as(ACCOUNTANT, T, PERMS, "accountant");
  });

  it("TL olmayan hesapta tavan uygulanmaz", async () => {
    await db.exec(`reset role`);
    const c2 = (await q(`insert into public.commissions(tenant_id, gross_amount) values ($1, 100) returning id`, [T]))[0]!.id as string;
    await as(ACCOUNTANT, T, PERMS, "accountant");
    expect((await collect(USD, 5000, "commission", c2)).outcome).toBe("recorded");
  });

  it("rollback 000600 gövdesini geri koyar: tavan kalkar", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261012001400_finance_entry_source_amount_guard.rollback.sql"));
    const c3 = (await q(`insert into public.commissions(tenant_id, gross_amount) values ($1, 100) returning id`, [T]))[0]!.id as string;
    await as(ACCOUNTANT, T, PERMS, "accountant");
    expect((await collect(ACC1, 9999, "commission", c3)).outcome).toBe("recorded");
  });
});
