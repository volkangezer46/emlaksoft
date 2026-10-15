/**
 * pglite kurulumu: finans v2 zinciri + WP1 kayıt çekirdeği + açık kalem v3 (+ isteğe bağlı WP2 tahakkuk / geri doldurma / K/Z v3).
 * Kaynak tablolar sade taslaktır (WP2'nin okuduğu kolonlar gerçek şemayla aynı adlarda). Yalnız testler kullanır.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Db } from "./pglite";

export const readRepo = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

export const FINANCE_SOURCE_STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text not null default 'Danışman',
  is_sample boolean not null default false);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text not null default 'Müşteri');
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, owner_customer_id uuid);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid, property_id uuid);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, property_id uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text, is_sample boolean not null default false,
  created_at timestamptz not null default now());
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid,
  gross_amount numeric not null default 0, vat_amount numeric not null default 0, status text default 'calculated',
  is_sample boolean not null default false, created_at timestamptz not null default now());
create table public.commission_splits(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  commission_id uuid not null references public.commissions(id) on delete cascade, profile_id uuid, kind text not null default 'advisor',
  label text not null default 'Pay', amount numeric(14,2) not null default 0);
create table public.commission_payouts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, commission_id uuid, split_id uuid,
  profile_id uuid not null, amount numeric(14,2) not null, status text not null default 'pending', approved_at timestamptz, paid_at timestamptz,
  created_at timestamptz not null default now());
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, renter_customer_id uuid, due_day integer default 1,
  is_sample boolean not null default false);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null, period date not null,
  amount numeric not null, status text not null default 'pending', paid_amount numeric not null default 0);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, amount numeric not null default 0,
  management_fee numeric not null default 0, paid_on date, voided_at timestamptz);
create table public.owner_payouts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, amount numeric not null default 0, voided_at timestamptz);
create table public.owner_charge_links(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid, kind text, ref_id uuid, amount numeric not null default 0);
create table public.rental_management_agreements(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null,
  managed boolean not null default true, payout_day smallint not null default 5);
create table public.buildings(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null default 'Lale Sitesi');
create table public.building_units(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, building_id uuid not null, unit_no text not null default '1');
create table public.building_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, building_id uuid not null, unit_id uuid not null,
  amount numeric(14,2) not null, paid_amount numeric(14,2) not null default 0, status text not null default 'pending', due_date date not null,
  payer_role text not null default 'owner', payer_customer_id uuid, created_at timestamptz not null default now(), voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, charge_id uuid, amount numeric not null default 0, voided_at timestamptz);
create table public.property_dues(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, title text not null,
  amount numeric(12,2) not null default 0, period date not null default current_date, due_date date, status text not null default 'unpaid');
create table public.einvoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, source_type text not null default 'free',
  source_id uuid, status text not null default 'issued', issue_date date not null default current_date);
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz not null default now());
create table public.expense_budgets(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, category text not null,
  monthly_amount numeric(14,2) not null, created_by uuid, is_sample boolean not null default false, unique (tenant_id, category));
create table public.permission_defaults(role text not null, module text not null, action text not null, primary key (role, module, action));
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

const FINANCE_EXTRA_STUB = `
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

export const FINANCE_CHAIN = [
  "supabase/migrations/20261014001000_finance_ledger_v2.sql",
  "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql",
  "supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql",
  "supabase/migrations/20261014011000_finance_party_advisor_scope.sql",
  "supabase/migrations/20261016060100_finance_pnl_vat_fix.sql",
  "supabase/migrations/20261017010000_finance_posting_core.sql",
  "supabase/migrations/20261017010100_finance_open_items_v3.sql",
];

export const WP2_MIGRATIONS = {
  triggers: "supabase/migrations/20261017010200_finance_accrual_triggers.sql",
  backfill: "supabase/migrations/20261017010300_finance_parties_backfill.sql",
  pnl: "supabase/migrations/20261017010400_finance_pnl_v3.sql",
} as const;

export const WP2_ROLLBACKS = {
  triggers: "supabase/rollbacks/20261017010200_finance_accrual_triggers.rollback.sql",
  backfill: "supabase/rollbacks/20261017010300_finance_parties_backfill.rollback.sql",
  pnl: "supabase/rollbacks/20261017010400_finance_pnl_v3.rollback.sql",
} as const;

/** Taslak + finans zinciri (WP1 çekirdeği + açık kalem v3 dahil, WP2 hariç). */
export async function applyFinanceBase(db: Db): Promise<void> {
  await db.exec(FINANCE_SOURCE_STUB);
  await db.exec(readRepo("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
  await db.exec(readRepo("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
  await db.exec(readRepo("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
  await db.exec(readRepo("supabase/migrations/20261012002900_finance_owner_payout_source.sql"));
  await db.exec(FINANCE_EXTRA_STUB);
  for (const f of FINANCE_CHAIN) await db.exec(readRepo(f));
}

/** WP2 migration'ları sırayla (tetikleyiciler → geri doldurma → K/Z v3). */
export async function applyWp2(db: Db, parts: readonly (keyof typeof WP2_MIGRATIONS)[] = ["triggers", "backfill", "pnl"]): Promise<void> {
  for (const p of parts) await db.exec(readRepo(WP2_MIGRATIONS[p]));
}

export const OWNER_FINANCE_PERMS =
  "expenses:view expenses:create expenses:edit expenses:delete commissions:view commissions:edit earnings_all:view rentals:view rentals:edit rentals:delete";
