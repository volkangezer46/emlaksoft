import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { entryAmounts } from "./vat";

/**
 * İŞLEVSEL SQL TESTİ (pglite): SN1 — 20261014021000_finance_entries_advisor_scope_recurring_terms.
 * Gerçek zincir: kasa/banka (000600) + düzenli ödeme (000900, 20261012000300) + ekstre (001200, 001400) + finans v2 (FN1) + FN6 koşul
 * RPC'si + GP1 danışman carisi kapsamı. Kabul: (1) earnings_all olmayan danışman başka danışmanın carisine bağlı hareketi
 * (cash_entries, finance_ledger_v) göremez, kendi carisini ve diğer carileri görür; sahip hepsini görür; hesap bakiyesi tam kalır.
 * (2) Düzenli ödeme (cron) hareketi kuraldaki cari + KDV + stopajla oluşur (vat.ts ile aynı hesap; nakit = brüt − stopaj);
 * koşulsuz kural eskisi gibi. (3) Ekstre yolu nakit tutarı korur (stopaj nakitten geri çözülür). (4) Rollback + yeniden uygulama.
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
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, role text default 'advisor', is_active boolean default true);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text not null default 'Müşteri');
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, property_id uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text, recurrence text, portal_key text,
  is_sample boolean not null default false, created_at timestamptz not null default now());
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
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid, title text not null, body text,
  href text, kind text not null default 'info', dedupe_key text, created_at timestamptz default now());
create unique index notifications_tenant_dedupe_key_uidx on public.notifications (tenant_id, dedupe_key) where dedupe_key is not null;
create table public.expense_budgets(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, category text not null,
  monthly_amount numeric(14,2) not null, created_by uuid, unique (tenant_id, category));
create table public.permission_defaults(role text not null, module text not null, action text not null, primary key (role, module, action));
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

const CHAIN = [
  "supabase/migrations/20261010000600_finance_accounts_cash_entries.sql",
  "supabase/migrations/20261010000900_recurring_rules.sql",
  "supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql",
  "supabase/migrations/20261011001200_bank_statement_import.sql",
  "supabase/migrations/20261011001400_statement_apply_recurring_commission.sql",
  "supabase/migrations/20261012000300_recurring_run_errors.sql",
  "supabase/migrations/20261012000400_finance_is_sample.sql",
  "supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql",
  "supabase/migrations/20261012002900_finance_owner_payout_source.sql",
  "supabase/migrations/20261013008600_finance_recurring_rule_terms.sql",
  "supabase/migrations/20261014001000_finance_ledger_v2.sql",
  "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql",
  "supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql",
  "supabase/migrations/20261014011000_finance_party_advisor_scope.sql",
];
const SN1 = "supabase/migrations/20261014021000_finance_entries_advisor_scope_recurring_terms.sql";
const SN1_ROLLBACK = "supabase/rollbacks/20261014021000_finance_entries_advisor_scope_recurring_terms.rollback.sql";

describe.skipIf(!mod)("SN1 finans: hareket satırında danışman carisi kapsamı + düzenli ödemede KDV/stopaj (pglite)", () => {
  let db: Db;
  let T: string, OWNER: string, ADV1: string, ADV2: string;
  let BANK: string;
  let ownParty: string, foreignParty: string, supplier: string, landlord: string;
  let ownEntry: string, foreignEntry: string, supplierEntry: string;

  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const FULL = "expenses:view expenses:create expenses:edit expenses:delete commissions:edit rentals:edit earnings_all:view";
  const ADVISOR_VIEW = "expenses:view";
  const asOwner = () => as(OWNER, FULL, "owner");
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const v2 = (p: Record<string, unknown>) => one<string>(`public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify(p)]);
  const today = async (offset = 0) => String((await q(`select ((now() at time zone 'Europe/Istanbul')::date + $1::int)::text as d`, [offset]))[0]!.d);
  const visibleIds = async (table: "cash_entries" | "finance_ledger_v") => new Set((await q(`select id::text as id from public.${table}`)).map((r) => String(r.id)));

  /** Ofis kuralı + koşullar; vade geçmişe çekilir (RPC geçmiş başlangıç kabul etmez). */
  const makeRule = async (title: string, amount: number, mode: "auto" | "approve", terms: { party?: string | null; vat?: number | null; wh?: number | null } | null) => {
    await asOwner();
    const r = await one<Record<string, unknown>>(
      `public.recurring_rule_create('office', 'out', 'kira', $1, $2::numeric, $3::uuid, 'monthly', 15, null, null, $4, null, 'kira', true)`,
      [title, amount, BANK, mode],
    );
    const id = r.rule_id as string;
    if (terms) {
      const t = await one<Record<string, unknown>>(`public.recurring_rule_set_terms($1::uuid, $2::uuid, $3::numeric, $4::numeric)`, [id, terms.party ?? null, terms.vat ?? null, terms.wh ?? null]);
      expect(t.outcome).toBe("updated");
    }
    const due = await today(-5);
    await db.exec(`reset role`);
    await q(`update public.recurring_rules set next_due = $2::date, next_period = date_trunc('month', $2::date)::date,
      anchor = date_trunc('month', $2::date)::date, pay_day = extract(day from $2::date)::int where id = $1`, [id, due]);
    return { id, due };
  };
  const runDue = async () => {
    await db.exec(`reset role; set role service_role`);
    const r = await one<Record<string, unknown>>(`public.recurring_run_due(((now() at time zone 'Europe/Istanbul')::date), '{}'::uuid[])`);
    await db.exec(`reset role`);
    return r;
  };
  const entryOf = async (title: string) =>
    (await q(`select amount::float8 as amount, vat_rate::float8 as vat_rate, vat_amount::float8 as vat_amount, withholding_rate::float8 as wh_rate,
        withholding_amount::float8 as wh, party_id::text as party_id, expense_id::text as expense_id
        from public.cash_entries where title = $1 and voided_at is null`, [title]));

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (role: string) => (await q(`insert into public.profiles(tenant_id, role) values ($1, $2) returning id`, [T, role]))[0]!.id as string;
    OWNER = await prof("owner");
    ADV1 = await prof("advisor");
    ADV2 = await prof("advisor");
    for (const f of CHAIN) await db.exec(read(f));
    await db.exec(read(SN1));
    await db.exec(`grant select on all tables in schema public to authenticated; grant all on all tables in schema public to service_role; grant usage on schema public to service_role`);

    await asOwner();
    BANK = (await one<Record<string, string>>(`public.finance_account_create('office','bank','Ofis bankası',null,'TRY',100000::numeric,((now() at time zone 'Europe/Istanbul')::date - 60))`)).account_id!;
    ownParty = await one<string>(`public.finance_party_upsert($1::jsonb)`, [JSON.stringify({ kind: "danisman", name: "Danışman Ayşe", user_id: ADV1 })]);
    foreignParty = await one<string>(`public.finance_party_upsert($1::jsonb)`, [JSON.stringify({ kind: "danisman", name: "Danışman Bora", user_id: ADV2 })]);
    supplier = await one<string>(`public.finance_party_upsert($1::jsonb)`, [JSON.stringify({ kind: "tedarikci", name: "Kırtasiye Ltd" })]);
    landlord = await one<string>(`public.finance_party_upsert($1::jsonb)`, [JSON.stringify({ kind: "malik", name: "Ofis Maliki Kemal" })]);
    const d = await today(-1);
    ownEntry = await v2({ account_id: BANK, direction: "out", amount: 3000, entry_date: d, category: "komisyon_odeme", title: "Ayşe hakediş", party_id: ownParty });
    foreignEntry = await v2({ account_id: BANK, direction: "out", amount: 5000, entry_date: d, category: "komisyon_odeme", title: "Bora hakediş", party_id: foreignParty });
    supplierEntry = await v2({ account_id: BANK, direction: "out", amount: 600, entry_date: d, category: "ofis", title: "Kırtasiye", party_id: supplier });
    await db.exec(`reset role`);
  }, 180_000);

  it("danışman başka danışmanın carisine bağlı hareketi göremez (cash_entries + finance_ledger_v); kendi carisini ve diğer carileri görür", async () => {
    await as(ADV1, ADVISOR_VIEW, "advisor");
    for (const table of ["cash_entries", "finance_ledger_v"] as const) {
      const ids = await visibleIds(table);
      expect(ids.has(foreignEntry)).toBe(false);
      expect(ids.has(ownEntry)).toBe(true);
      expect(ids.has(supplierEntry)).toBe(true);
    }
    // Gelir/gider özeti (invoker) gizli satırı toplamaz; hesap bakiyesi (definer) gerçek bakiyedir ve tam kalır.
    const summaryOut = Number((await q(`select coalesce(sum(total), 0)::float8 as s from public.finance_cash_summary(null, null) where direction = 'out'`))[0]!.s);
    expect(summaryOut).toBe(3600);
    const bal = Number((await q(`select balance::float8 as b from public.finance_account_balances() where account_id = $1`, [BANK]))[0]!.b);
    expect(bal).toBe(100000 - 3000 - 5000 - 600);
    // Diğer danışman da yalnız kendi tarafını görür.
    await as(ADV2, ADVISOR_VIEW, "advisor");
    const other = await visibleIds("cash_entries");
    expect(other.has(foreignEntry)).toBe(true);
    expect(other.has(ownEntry)).toBe(false);
  });

  it("sahip ve earnings_all sahibi (müdür) tüm hareketleri görür", async () => {
    await asOwner();
    const all = await visibleIds("cash_entries");
    for (const id of [ownEntry, foreignEntry, supplierEntry]) expect(all.has(id)).toBe(true);
    await as(ADV1, "expenses:view earnings_all:view", "gm");
    const gm = await visibleIds("finance_ledger_v");
    for (const id of [ownEntry, foreignEntry, supplierEntry]) expect(gm.has(id)).toBe(true);
  });

  it("düzenli kira (cron): hareket cari + stopajla oluşur; hesaptan net çıkar, gider kaydı brüt kirayı taşır", async () => {
    await makeRule("Ofis kirası (stopajlı)", 10000, "auto", { party: landlord, wh: 20 });
    expect(await runDue()).toMatchObject({ outcome: "ok", failed: 0 });
    const [e] = await entryOf("Ofis kirası (stopajlı)");
    const want = entryAmounts(10000, null, true, 20);
    expect(e).toMatchObject({ amount: want.cash, wh_rate: 20, wh: want.withheld, party_id: landlord, vat_rate: null, vat_amount: null });
    expect(e!.amount).toBe(8000);
    expect(e!.wh).toBe(2000);
    const exp = (await q(`select amount::float8 as a from public.expenses where id = $1`, [e!.expense_id]))[0]!;
    expect(exp.a).toBe(10000);
  });

  it("KDV'li düzenli ödeme: KDV tutarı yazılır, gider kaydı KDV hariç net tutardır (v2 kuralı)", async () => {
    await makeRule("Muhasebe hizmeti (KDV)", 1200, "auto", { party: supplier, vat: 20 });
    await runDue();
    const [e] = await entryOf("Muhasebe hizmeti (KDV)");
    const want = entryAmounts(1200, 20, true, null);
    expect(e).toMatchObject({ amount: want.cash, vat_rate: 20, vat_amount: want.vat, wh_rate: null, wh: null, party_id: supplier });
    expect(e!.vat_amount).toBe(200);
    expect((await q(`select amount::float8 as a from public.expenses where id = $1`, [e!.expense_id]))[0]!.a).toBe(1000);
  });

  it("koşulsuz düzenli ödeme eskisi gibi: nakit = tutar, KDV/stopaj/cari boş", async () => {
    await makeRule("İnternet (koşulsuz)", 750, "auto", null);
    await runDue();
    const [e] = await entryOf("İnternet (koşulsuz)");
    expect(e).toMatchObject({ amount: 750, vat_rate: null, vat_amount: null, wh_rate: null, wh: null, party_id: null });
    expect((await q(`select amount::float8 as a from public.expenses where id = $1`, [e!.expense_id]))[0]!.a).toBe(750);
  });

  it("ekstre yolu nakit tutarı korur: stopajlı kuralda belge tutarı nakitten geri çözülür, mutabakat bozulmaz", async () => {
    const { id } = await makeRule("Depo kirası (ekstre)", 10000, "approve", { party: landlord, wh: 20 });
    expect(await runDue()).toMatchObject({ outcome: "ok", drafts: 1 });
    await asOwner();
    const staged = await one<Record<string, unknown>>(`public.finance_statement_stage($1::uuid, $2, 'csv', $3::jsonb)`, [
      BANK, "e".repeat(64), JSON.stringify([{ d: await today(-4), dir: "out", amt: 8000, desc: "DEPO KIRASI", h: "hsn1depo01", bal: null }]),
    ]);
    expect(staged.outcome).toBe("staged");
    const lid = (await q(`select id from public.finance_statement_lines where line_hash = 'hsn1depo01'`))[0]!.id as string;
    const res = await one<Record<string, unknown>>(`public.finance_statement_apply($1::uuid, $2::jsonb)`, [BANK, JSON.stringify([{ line_id: lid, action: "recurring", rule_id: id }])]);
    expect(res).toMatchObject({ outcome: "applied", created: 1, failed: 0 });
    const [e] = await entryOf("Depo kirası (ekstre)");
    expect(e).toMatchObject({ amount: 8000, wh_rate: 20, wh: 2000, party_id: landlord });
  });

  it("rollback: politika ve düzenli ödeme eski haline döner (4 argümanlı sürüm düşer); migration yeniden uygulanabilir", async () => {
    await db.exec(`reset role`);
    await db.exec(read(SN1_ROLLBACK));
    expect((await q(`select to_regprocedure('public.recurring_post_occurrence(uuid,numeric,uuid,boolean)')::text as p`))[0]!.p).toBeNull();
    const stmt = String((await q(`select pg_get_functiondef('public.finance_statement_apply(uuid,jsonb)'::regprocedure) as d`))[0]!.d);
    expect(stmt).toContain("public.recurring_post_occurrence(v_occ.id, v_line.amount, v_uid)");
    await as(ADV1, ADVISOR_VIEW, "advisor");
    expect((await visibleIds("cash_entries")).has(foreignEntry)).toBe(true);

    await db.exec(`reset role`);
    await db.exec(read(SN1));
    await db.exec(read(SN1)); // idempotent
    const again = String((await q(`select pg_get_functiondef('public.finance_statement_apply(uuid,jsonb)'::regprocedure) as d`))[0]!.d);
    expect(again.split("recurring_post_occurrence(v_occ.id, v_line.amount, v_uid, true)").length).toBe(2);
    await as(ADV1, ADVISOR_VIEW, "advisor");
    expect((await visibleIds("cash_entries")).has(foreignEntry)).toBe(false);
  });
});
