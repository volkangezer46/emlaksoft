import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012002900_finance_owner_payout_source — mülk sahibi ödemesi kasada ÇIKIŞ olarak yazılır,
 * tutar aşımı ve mükerrer reddedilir, kiracı izolasyonu, iptalde hareket iptali, rollback.
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
create table public.owner_payouts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, amount numeric not null default 0, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("finance_record_entry owner_payout kaynağı (pglite)", () => {
  let db: Db;
  let T: string, T2: string, USER: string, USER2: string, ACC: string, ACC_B: string, ACC_T2: string, PAYOUT: string, PAYOUT_T2: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const PERMS = "expenses:view expenses:create expenses:edit rentals:edit rentals:delete";
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const payout = (acc: string, amount: number, id: string, direction = "out") =>
    rpc(`public.finance_record_entry($1::uuid, $2, $3::numeric, '2026-10-05'::date, 'mulk_sahibi_odeme', 'Hakediş', null, null, null, 'owner_payout', $4::uuid)`, [acc, direction, amount, id]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    USER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    USER2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    for (const f of [
      "20261010000600_finance_accounts_cash_entries", "20261011001100_finance_salary_privacy_void_audit",
      "20261012001400_finance_entry_source_amount_guard", "20261012002900_finance_owner_payout_source",
    ]) await db.exec(read(`supabase/migrations/${f}.sql`));
    await as(USER, T, PERMS, "accountant");
    ACC = (await rpc(`public.finance_account_create('office','cash','Kasa',null,'TRY',0::numeric,'2026-10-01'::date)`, [])).account_id as string;
    ACC_B = (await rpc(`public.finance_account_create('office','bank','Banka',null,'TRY',0::numeric,'2026-10-01'::date)`, [])).account_id as string;
    await as(USER2, T2, PERMS, "accountant");
    ACC_T2 = (await rpc(`public.finance_account_create('office','cash','Kasa T2',null,'TRY',0::numeric,'2026-10-01'::date)`, [])).account_id as string;
    await db.exec(`reset role`);
    PAYOUT = (await q(`insert into public.owner_payouts(tenant_id, amount) values ($1, 9000) returning id`, [T]))[0]!.id as string;
    PAYOUT_T2 = (await q(`insert into public.owner_payouts(tenant_id, amount) values ($1, 9000) returning id`, [T2]))[0]!.id as string;
    await as(USER, T, PERMS, "accountant");
  });

  it("tutar aşımı reddedilir, yön 'in' reddedilir", async () => {
    expect(await payout(ACC, 9000.01, PAYOUT)).toMatchObject({ outcome: "invalid_input", reason: "amount_exceeds_source" });
    expect(await payout(ACC, 100, PAYOUT, "in")).toMatchObject({ outcome: "invalid_input" });
  });

  it("owner_payout kaynağıyla kasa ÇIKIŞI yazılır; mükerrer (başka hesap dahil) reddedilir", async () => {
    const r = await payout(ACC, 9000, PAYOUT);
    expect(r.outcome).toBe("recorded");
    await db.exec(`reset role`);
    const rows = await q(`select direction, kind, source_type, amount::numeric::float8 as amount, category from public.cash_entries where source_id = $1`, [PAYOUT]);
    expect(rows).toEqual([{ direction: "out", kind: "expense", source_type: "owner_payout", amount: 9000, category: "mulk_sahibi_odeme" }]);
    await as(USER, T, PERMS, "accountant");
    expect(await payout(ACC, 9000, PAYOUT)).toMatchObject({ outcome: "duplicate", entry_id: r.entry_id });
    expect(await payout(ACC_B, 100, PAYOUT)).toMatchObject({ outcome: "duplicate", entry_id: r.entry_id });
  });

  it("kiracı izolasyonu: başka ofisin ödemesi / hesabı kullanılamaz", async () => {
    expect((await payout(ACC, 100, PAYOUT_T2)).outcome).toBe("source_not_found");
    expect((await payout(ACC_T2, 100, PAYOUT)).outcome).toBe("not_found");
  });

  it("yetki: rentals:edit olmayan rol forbidden", async () => {
    await as(USER, T, "expenses:view expenses:create", "accountant");
    expect((await payout(ACC_B, 100, PAYOUT)).outcome).toBe("forbidden");
    await as(USER, T, PERMS, "accountant");
  });

  it("ödeme iptalinde finance_void_source_entries hareketi iptal eder", async () => {
    expect(await rpc(`public.finance_void_source_entries('owner_payout', $1::uuid, 'Ödeme iptal')`, [PAYOUT])).toMatchObject({ outcome: "voided", count: 1 });
    await db.exec(`reset role`);
    expect(await q(`select 1 from public.cash_entries where source_id = $1 and voided_at is null`, [PAYOUT])).toHaveLength(0);
    await as(USER, T, PERMS, "accountant");
  });

  it("rollback: owner_payout kaynağı yeniden reddedilir", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261012002900_finance_owner_payout_source.rollback.sql"));
    await as(USER, T, PERMS, "accountant");
    expect((await payout(ACC, 100, PAYOUT)).outcome).toBe("invalid_input");
  });
});
