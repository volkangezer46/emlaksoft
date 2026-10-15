import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016060100_finance_pnl_vat_fix (SK6/B103 + B104).
 * Gerçek finans zinciri (000600 → 001100 → 011000) + bu migration; komisyon/kira tabloları sade taslaktır.
 *  - B103: finance_pnl komisyon satırı = gross_amount (KDV hariç matrah) − ofis dışı paylar; KDV ikinci kez düşülmez.
 *  - B104: 12.000 ₺ KDV dahil (%20) vadeli alacak düzenleme ayının hesaplanan KDV'sini +2.000 artırır;
 *    kısmi tahsilat ikinci kez saymaz; tahsilat hareketine orantılı KDV yazılır, son tahsilat kalanı alır; kâr/zarar KDV hariç.
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
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text not null default 'Müşteri');
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, property_id uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text, is_sample boolean not null default false,
  created_at timestamptz not null default now());
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid,
  gross_amount numeric not null default 0, vat_amount numeric not null default 0, status text default 'calculated',
  is_sample boolean not null default false, created_at timestamptz not null default now());
create table public.commission_splits(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, commission_id uuid not null, kind text not null, amount numeric not null);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, renter_customer_id uuid, due_day integer default 1);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null, period date not null,
  amount numeric not null, status text not null default 'pending', paid_amount numeric not null default 0);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, amount numeric not null default 0,
  management_fee numeric not null default 0, paid_on date, voided_at timestamptz);
create table public.owner_payouts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, amount numeric not null default 0, voided_at timestamptz);
create table public.owner_charge_links(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, kind text, ref_id uuid, amount numeric not null default 0);
create table public.rental_management_agreements(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null,
  managed boolean not null default true, payout_day smallint not null default 5);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, amount numeric not null default 0, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
create table public.expense_budgets(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, category text not null,
  monthly_amount numeric(14,2) not null, created_by uuid, is_sample boolean not null default false, unique (tenant_id, category));
create table public.permission_defaults(role text not null, module text not null, action text not null, primary key (role, module, action));
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

const FINANCE_STUBS = `
alter table public.cash_entries add column if not exists is_sample boolean not null default false;
alter table public.cash_entries add column if not exists reconciled_at timestamptz;
alter table public.finance_accounts add column if not exists is_sample boolean not null default false;
create table public.recurring_rules(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, scope text not null default 'office',
  direction text not null, category text not null, title text not null, amount numeric(14,2) not null, account_id uuid not null,
  frequency text not null default 'monthly', pay_day smallint not null default 1, end_date date, next_period date, next_due date,
  active boolean not null default true, is_sample boolean not null default false);
create table public.recurring_occurrences(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rule_id uuid not null, status text not null);
create table public.finance_statement_lines(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, account_id uuid not null, status text not null default 'pending');
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("kâr/zarar KDV + vadeli kalem KDV'si (pglite, 20261016060100)", () => {
  let db: Db;
  let T: string, OWNER: string, BANKA: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const asOwner = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${OWNER}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','expenses:view expenses:create expenses:edit expenses:delete commissions:view earnings_all:view',false),
      set_config('test.role','owner',false)`);
    await db.exec(`set role authenticated`);
  };
  const vatOf = async (from: string, to: string) =>
    (await q(`select output_vat::float8 as o, input_vat::float8 as i, payable::float8 as p from public.finance_vat_summary($1::date, $2::date)`, [from, to]))[0] as { o: number; i: number; p: number };
  const vatSep = () => vatOf("2026-09-01", "2026-09-30");
  const vatOct = () => vatOf("2026-10-01", "2026-10-31");

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
    await db.exec(read("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
    await db.exec(read("supabase/migrations/20261012002900_finance_owner_payout_source.sql"));
    await db.exec(FINANCE_STUBS);
    for (const f of [
      "supabase/migrations/20261014001000_finance_ledger_v2.sql",
      "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql",
      "supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql",
      "supabase/migrations/20261014011000_finance_party_advisor_scope.sql",
      "supabase/migrations/20261016060100_finance_pnl_vat_fix.sql",
    ]) await db.exec(read(f));
    await asOwner();
    BANKA = (await one<Record<string, string>>(`public.finance_account_create('office','bank','Banka',null,'TRY',0::numeric,'2026-08-01'::date)`)).account_id!;
    await db.exec(`reset role`);
    // Ağustos: matrah 315.000 + KDV 63.000; ofis dışı pay 0 → gelir 315.000 (eskiden 252.000).
    // Eylül: matrah 20.000 + KDV 4.000; danışman payı 6.000, ofis payı 14.000 → komisyon satırı 14.000 (eskiden 10.000).
    await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status, created_at) values ($1, 315000, 63000, 'paid', '2026-08-12T09:00:00+03')`, [T]);
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status, created_at) values ($1, 20000, 4000, 'paid', '2026-09-10T10:00:00+03') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.commission_splits(tenant_id, commission_id, kind, amount) values ($1, $2, 'advisor', 6000), ($1, $2, 'office', 14000)`, [T, c]);
  }, 180_000);

  it("B103: komisyon satırı = matrah − ofis dışı paylar (KDV düşülmez)", async () => {
    await asOwner();
    const rows = await q(`select month::text as m, income::float8 as i, income_by_category as ic from public.finance_pnl('2026-08-01'::date, '2026-09-30'::date)`);
    expect(rows.map((r) => r.m)).toEqual(["2026-08-01", "2026-09-01"]);
    expect((rows[0]!.ic as Record<string, number>).komisyon).toBe(315000);
    expect((rows[1]!.ic as Record<string, number>).komisyon).toBe(14000);
  });

  it("B104: 12.000 ₺ KDV dahil vadeli alacak düzenleme ayının hesaplanan KDV'sini 2.000 artırır; kısmi ve son tahsilat ikinci kez saymaz", async () => {
    await asOwner();
    const before = await vatSep();
    const item = await one<string>(`public.finance_open_item_create($1::jsonb)`, [JSON.stringify({
      direction: "receivable", party_name: "Demir Ltd", title: "Danışmanlık faturası", category: "hizmet_bedeli", amount: 12000,
      vat_rate: 20, issue_date: "2026-09-05", due_date: "2026-11-30" })]);
    const afterIssue = await vatSep();
    expect(afterIssue.o - before.o).toBe(2000);
    // Kısmi tahsilat (Eylül içinde): KDV ikinci kez sayılmaz; harekete orantılı KDV (5.000 / 12.000 × 2.000 = 833,33) yazılır.
    const e1 = await one<string>(`public.finance_open_item_settle($1::uuid, $2::uuid, 5000::numeric, '2026-09-20'::date, null)`, [item, BANKA]);
    expect((await vatSep()).o).toBe(afterIssue.o);
    await db.exec(`reset role`);
    expect((await q(`select vat_rate::float8 as r, vat_amount::float8 as v, amount::float8 as a from public.cash_entries where id = $1`, [e1]))[0]).toEqual({ r: 20, v: 833.33, a: 5000 });
    // Son tahsilat (Ekim): kalan KDV'yi alır; Ekim KDV'sine de girmez.
    await asOwner();
    const octBefore = await vatOct();
    const e2 = await one<string>(`public.finance_open_item_settle($1::uuid, $2::uuid, null, '2026-10-02'::date, null)`, [item, BANKA]);
    expect((await vatOct()).o).toBe(octBefore.o);
    await db.exec(`reset role`);
    const e2row = (await q(`select vat_amount::float8 as v, amount::float8 as a from public.cash_entries where id = $1`, [e2]))[0]!;
    expect(e2row).toEqual({ v: 1166.67, a: 7000 });
    expect((await q(`select status from public.finance_open_items where id = $1`, [item]))[0]!.status).toBe("paid");
    // Kâr/zarar: tahsilatlar KDV hariç gelir (5.000 − 833,33 Eylül; 7.000 − 1.166,67 Ekim) = toplam matrah 10.000.
    await asOwner();
    const pnl = await q(`select month::text as m, (income_by_category->>'hizmet_bedeli')::float8 as h from public.finance_pnl('2026-09-01'::date, '2026-10-31'::date)`);
    expect(pnl.map((r) => r.h)).toEqual([4166.67, 5833.33]);
  });

  it("B104: iptal edilen kalemin KDV'si sayılmaz; KDV'siz kalemin tahsilatı KDV yazmaz", async () => {
    await asOwner();
    const before = await vatOct();
    const item = await one<string>(`public.finance_open_item_create($1::jsonb)`, [JSON.stringify({
      direction: "payable", party_name: "Tedarikçi A", title: "Bakım faturası", category: "ofis", amount: 6000,
      vat_rate: 20, issue_date: "2026-10-07", due_date: "2026-10-30" })]);
    expect((await vatOct()).i - before.i).toBe(1000);
    await one(`public.finance_open_item_cancel($1::uuid, 'yanlış kayıt')`, [item]);
    expect((await vatOct()).i).toBe(before.i);
    const plain = await one<string>(`public.finance_open_item_create($1::jsonb)`, [JSON.stringify({
      direction: "receivable", party_name: "Demir Ltd", title: "KDV'siz alacak", category: "diger_gelir", amount: 1000,
      issue_date: "2026-10-08", due_date: "2026-10-30" })]);
    const e = await one<string>(`public.finance_open_item_settle($1::uuid, $2::uuid, null, '2026-10-09'::date, null)`, [plain, BANKA]);
    await db.exec(`reset role`);
    expect((await q(`select vat_amount from public.cash_entries where id = $1`, [e]))[0]!.vat_amount).toBeNull();
  });

  it("B018: bütçe ↔ gerçekleşen tek kaynak — oturum sarmalayıcısı ve service_role kiracı fonksiyonu aynı satırları verir", async () => {
    await asOwner();
    await one(`public.finance_budget_set('2026-10-01'::date, 'out', 'kira', 40000::numeric)`);
    // Kira + aidat ofis bütçesine sayılır (finance_v2_budget_category); 'kira' satırı ayrı oluşmaz.
    await one(`public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: BANKA, direction: "out", amount: 50000, entry_date: "2026-10-03", category: "kira", title: "Ofis kirası" })]);
    await one(`public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: BANKA, direction: "out", amount: 20710, entry_date: "2026-10-04", category: "aidat", title: "Aidat" })]);
    const session = await q(`select direction, category, budget::float8 as b, actual::float8 as a from public.finance_budget_vs_actual('2026-10-15'::date) where direction = 'out'`);
    await db.exec(`reset role`);
    const engine = await q(`select direction, category, budget::float8 as b, actual::float8 as a from public.finance_budget_vs_actual_for($1::uuid, '2026-10-15'::date, true) where direction = 'out'`, [T]);
    expect(engine).toEqual(session);
    const ofis = engine.find((r) => r.category === "ofis")!;
    expect(ofis.b).toBe(40000);
    expect(ofis.a).toBeGreaterThanOrEqual(70710);
    expect(engine.some((r) => r.category === "kira")).toBe(false);
    // Kiracı fonksiyonu oturum rolüne kapalı.
    await asOwner();
    await expect(q(`select * from public.finance_budget_vs_actual_for($1::uuid, '2026-10-15'::date, true)`, [T])).rejects.toThrow();
  });

  it("B018: komisyon tahsilatı (KDV dahil, v1 hareketi) gelir gerçekleşenine KDV hariç girer", async () => {
    await db.exec(`reset role`);
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status, created_at) values ($1, 10000, 2000, 'paid', '2026-10-05T10:00:00+03') returning id`, [T]))[0]!.id as string;
    await asOwner();
    await db.exec(`select set_config('test.perms', current_setting('test.perms') || ' commissions:edit', false)`);
    const before = (await q(`select actual::float8 as a from public.finance_budget_vs_actual('2026-10-01'::date) where direction = 'in' and category = 'komisyon'`))[0]?.a ?? 0;
    const res = await one<{ outcome: string }>(`public.finance_record_entry($1::uuid, 'in', 12000::numeric, '2026-10-06'::date, 'komisyon', 'Komisyon tahsilatı', null, null, null, 'commission', $2::uuid)`, [BANKA, c]);
    expect(res.outcome).toBe("recorded");
    const after = (await q(`select actual::float8 as a from public.finance_budget_vs_actual('2026-10-01'::date) where direction = 'in' and category = 'komisyon'`))[0]!.a;
    expect(Number(after) - Number(before)).toBe(10000);
  });

  it("rollback dosyası temiz çalışır ve eski govdeye döner", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261016060100_finance_pnl_vat_fix.rollback.sql"));
    await asOwner();
    const rows = await q(`select (income_by_category->>'komisyon')::float8 as k from public.finance_pnl('2026-09-01'::date, '2026-09-30'::date)`);
    expect(rows[0]!.k).toBe(10000);
    await db.exec(`reset role`);
    await db.exec(read("supabase/migrations/20261016060100_finance_pnl_vat_fix.sql"));
  });
});
