import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261020020001_rental_applications + 20261020020002_rental_inspections (SP5/SP6).
 * Gerçek zincir: finans v2 + WP4 depozito emaneti (20261017010500) + bu iki migration.
 *  - Kalemli kesinti depozitoyu aşamaz; iade edilmiş depozitoda kesinti değişmez.
 *  - rental_deposit_post iade hareketini NET (depozito − kesinti) yazar; tam kesintide çıkış yazılmaz.
 *  - Kesinleşmiş tutanağın içeriği değişmez; taslağa alınca düzenlenir.
 *  - Ofis kullanıcısı aday verisini değiştiremez (sütun yetkisi), onaylı başvuruyu yeniden açamaz.
 *  - Saklama süresi dolan başvuru dosya yollarıyla birlikte silinir.
 *  - Rollback dosyaları temiz çalışır, migration yeniden uygulanabilir.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const APPS = "supabase/migrations/20261020020001_rental_applications.sql";
const INSP = "supabase/migrations/20261020020002_rental_inspections.sql";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text not null default 'Müşteri');
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, owner_customer_id uuid);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, property_id uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text, is_sample boolean not null default false,
  created_at timestamptz not null default now());
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid,
  gross_amount numeric not null default 0, vat_amount numeric not null default 0, status text default 'calculated',
  is_sample boolean not null default false, created_at timestamptz not null default now());
create table public.commission_splits(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, commission_id uuid not null, kind text not null, amount numeric not null);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, renter_customer_id uuid, due_day integer default 1,
  deposit numeric(14,2), status text not null default 'active', deposit_returned boolean not null default false, deposit_returned_at timestamptz);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null, period date not null,
  amount numeric not null, status text not null default 'pending', paid_amount numeric not null default 0);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, amount numeric not null default 0,
  management_fee numeric not null default 0, paid_on date, voided_at timestamptz);
create table public.owner_payouts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, amount numeric not null default 0, voided_at timestamptz);
create table public.owner_charge_links(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, kind text, ref_id uuid, amount numeric not null default 0);
create table public.rental_management_agreements(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null,
  managed boolean not null default true, payout_day smallint not null default 5);
create table public.building_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, payer_role text not null default 'owner', payer_customer_id uuid);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, charge_id uuid, amount numeric not null default 0, voided_at timestamptz);
create table public.contracts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, status text not null default 'draft');
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

describe.skipIf(!mod)("kiracı başvurusu + tutanak + kalemli depozito (pglite, 20261020020001/02)", () => {
  let db: Db;
  let T: string, OWNER: string, BANKA: string, PROP: string, KIRACI: string, RENTAL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const asOwner = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${OWNER}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','expenses:view expenses:create expenses:edit rentals:view rentals:edit',false), set_config('test.role','owner',false),
      set_config('request.jwt.claim.role','authenticated',false)`);
    await db.exec(`set role authenticated`);
  };
  const asService = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false)`);
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    KIRACI = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Mehmet Kiracı') returning id`, [T]))[0]!.id as string;
    PROP = (await q(`insert into public.properties(tenant_id, title) values ($1, 'Daire 5') returning id`, [T]))[0]!.id as string;
    RENTAL = (await q(`insert into public.rentals(tenant_id, property_id, renter_customer_id, deposit) values ($1, $2, $3, 30000) returning id`, [T, PROP, KIRACI]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20260724000039_property_dues.sql"));
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
      "supabase/migrations/20261017010500_property_dues_open_items.sql",
    ]) await db.exec(read(f));
    await db.exec(read(APPS));
    await db.exec(read(INSP));
    await db.exec(`grant select on all tables in schema public to authenticated`);
    await asOwner();
    BANKA = (await one<Record<string, string>>(`public.finance_account_create('office','bank','Banka',null,'TRY',0::numeric,'2026-01-01'::date)`)).account_id!;
    await asService();
  }, 180_000);

  it("kalemli kesinti: depozitoyu aşamaz, iade edilmiş depozitoda değişmez", async () => {
    await asOwner();
    await q(`insert into public.rental_deposit_deductions(tenant_id, rental_id, label, amount) values ($1, $2, 'Salon boyası', 3500)`, [T, RENTAL]);
    await q(`insert into public.rental_deposit_deductions(tenant_id, rental_id, label, amount) values ($1, $2, 'Mutfak dolabı', 1500)`, [T, RENTAL]);
    await expect(q(`insert into public.rental_deposit_deductions(tenant_id, rental_id, label, amount) values ($1, $2, 'Fazla', 26000)`, [T, RENTAL])).rejects.toThrow(/RD:exceeds_deposit/);
    await asService();
    expect(await one<number>(`(select sum(amount)::float8 from public.rental_deposit_deductions where rental_id = $1)`, [RENTAL])).toBe(5000);
  });

  it("depozito iadesi NET tutarla yazılır (30.000 − 5.000), kesinti notu taşır; iade sonrası kesinti kilitli", async () => {
    await asOwner();
    await one(`public.rental_deposit_post($1::uuid, 'received', $2::uuid, '2026-09-01'::date)`, [RENTAL, BANKA]);
    await asService();
    await q(`update public.rentals set status = 'ended', deposit_returned = true where id = $1`, [RENTAL]);
    await asOwner();
    const out = await one<string>(`public.rental_deposit_post($1::uuid, 'returned', $2::uuid, null)`, [RENTAL, BANKA]);
    await asService();
    const row = (await q(`select direction, amount::float8 as a, category, note from public.cash_entries where id = $1`, [out]))[0]!;
    expect(row).toMatchObject({ direction: "out", a: 25000, category: "depozito" });
    expect(String(row.note)).toContain("kesinti");
    await asOwner();
    await expect(q(`insert into public.rental_deposit_deductions(tenant_id, rental_id, label, amount) values ($1, $2, 'Geç kalem', 100)`, [T, RENTAL])).rejects.toThrow(/RD:deposit_returned/);
    await expect(q(`delete from public.rental_deposit_deductions where rental_id = $1`, [RENTAL])).rejects.toThrow(/RD:deposit_returned/);
  });

  it("tam kesintide iade çıkışı yazılmaz (FN:no_deposit)", async () => {
    await asService();
    const r2 = (await q(`insert into public.rentals(tenant_id, property_id, renter_customer_id, deposit) values ($1, $2, $3, 1000) returning id`, [T, PROP, KIRACI]))[0]!.id as string;
    await q(`insert into public.rental_deposit_deductions(tenant_id, rental_id, label, amount) values ($1, $2, 'Hepsi', 1000)`, [T, r2]);
    await q(`update public.rentals set status = 'ended', deposit_returned = true where id = $1`, [r2]);
    await asOwner();
    await expect(q(`select public.rental_deposit_post($1::uuid, 'returned', $2::uuid, null)`, [r2, BANKA])).rejects.toThrow(/FN:no_deposit/);
  });

  it("kesinleşmiş tutanak değişmez; taslağa alınınca düzenlenir; tür başına tek tutanak", async () => {
    await asOwner();
    const id = (await q(`insert into public.rental_inspections(tenant_id, rental_id, kind, rooms) values ($1, $2, 'move_in', '[{"key":"salon","name":"Salon","items":[]}]') returning id`, [T, RENTAL]))[0]!.id as string;
    await expect(q(`insert into public.rental_inspections(tenant_id, rental_id, kind) values ($1, $2, 'move_in')`, [T, RENTAL])).rejects.toThrow();
    await q(`update public.rental_inspections set status = 'final', finalized_at = now() where id = $1`, [id]);
    await expect(q(`update public.rental_inspections set notes = 'x' where id = $1`, [id])).rejects.toThrow(/RI:final/);
    await q(`update public.rental_inspections set status = 'draft', finalized_at = null where id = $1`, [id]);
    await q(`update public.rental_inspections set notes = 'düzeltildi' where id = $1`, [id]);
    await expect(q(`update public.rental_inspections set kind = 'move_out' where id = $1`, [id])).rejects.toThrow();
    await expect(q(`delete from public.rental_inspections where id = $1 and status = 'final'`, [id])).resolves.toBeDefined();
  });

  it("ofis kullanıcısı aday verisini değiştiremez, onaylı başvuruyu yeniden açamaz; malik kararı service_role", async () => {
    await asService();
    const link = (await q(`insert into public.rental_application_links(tenant_id, property_id, token) values ($1, $2, $3) returning id`, [T, PROP, "a".repeat(43)]))[0]!.id as string;
    const app = (await q(`insert into public.rental_applications(tenant_id, link_id, property_id, full_name, phone, kvkk_consent_at) values ($1, $2, $3, 'Ayşe Aday', '05321234567', now()) returning id`, [T, link, PROP]))[0]!.id as string;
    await expect(q(`insert into public.rental_applications(tenant_id, link_id, property_id, full_name, phone, kvkk_consent_at) values ($1, $2, $3, 'Ayşe Tekrar', '05321234567', now())`, [T, link, PROP])).rejects.toThrow();
    await asOwner();
    await expect(q(`update public.rental_applications set full_name = 'Değişti' where id = $1`, [app])).rejects.toThrow();
    await q(`update public.rental_applications set status = 'approved' where id = $1`, [app]);
    const kept = (await q(`select retain_until > now() + interval '1 year' as long from public.rental_applications where id = $1`, [app]))[0]!;
    expect(kept.long).toBe(true);
    await expect(q(`update public.rental_applications set status = 'new' where id = $1`, [app])).rejects.toThrow(/RA:closed/);
    await expect(q(`insert into public.rental_applications(tenant_id, property_id, full_name, phone, kvkk_consent_at) values ($1, $2, 'X Y', '05321234567', now())`, [T, PROP])).rejects.toThrow();
  });

  it("saklama süresi dolan başvuru silinir, dosya yolları kuyruk için döner", async () => {
    await asService();
    const app = (await q(`insert into public.rental_applications(tenant_id, property_id, full_name, phone, kvkk_consent_at, retain_until) values ($1, $2, 'Eski Aday', '05321234569', now(), now() - interval '1 day') returning id`, [T, PROP]))[0]!.id as string;
    await q(`insert into public.rental_application_files(tenant_id, application_id, doc_type, storage_path, file_name, file_size, mime_type, status) values ($1, $2, 'kimlik', $3, 'k.jpg', 100, 'image/jpeg', 'verified')`, [T, app, `${T}/${app}/f.jpg`]);
    const rows = await q(`select * from public.rental_applications_purge_expired(50)`);
    expect(rows.map((r) => r.storage_path)).toEqual([`${T}/${app}/f.jpg`]);
    expect((await q(`select count(*)::int as n from public.rental_applications where id = $1`, [app]))[0]!.n).toBe(0);
    await asOwner();
    await expect(q(`select * from public.rental_applications_purge_expired(50)`)).rejects.toThrow();
  });

  it("rollback dosyaları temiz çalışır, migration'lar yeniden uygulanabilir", async () => {
    await asService();
    await db.exec(read("supabase/rollbacks/20261020020002_rental_inspections.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261020020001_rental_applications.rollback.sql"));
    expect((await q(`select to_regclass('public.rental_applications') is null as gone`))[0]!.gone).toBe(true);
    await db.exec(read(APPS));
    await db.exec(read(INSP));
    expect((await q(`select to_regclass('public.rental_deposit_deductions') is not null as back`))[0]!.back).toBe(true);
  });
});
