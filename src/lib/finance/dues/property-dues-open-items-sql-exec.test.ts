import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261017010500_property_dues_open_items (WP4).
 * Gerçek zincir: property_dues (20260724000039) + finans (000600 → 001100 → 011000 → 060100) + bu migration.
 *  - Geri doldurma: her aidat (tutar > 0) tek açık kalem (source_type 'due', source_id = due.id); ödenmiş = 'paid' + 'kasa dışı';
 *    kilitli aya düşen tahakkuk ilk açık aya taşınır; iki kez çalışınca değişiklik yok.
 *  - property_dues authenticated için salt okunur; silme yok → iptal (status cancelled + neden + denetim).
 *  - Ödendi: hesapla (settle → kasa hareketi) ya da kasa dışı; geri alma yalnız kasa dışında.
 *  - Depozito: kategori 'depozito', kiracı carisi, tekrar çağrı aynı hareket; iptal hareketi void eder.
 *  - Cari: kira tahsilat hareketi kiracı carisine, mülk sahibi ödemesi malik carisine bağlanır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIGRATION = "supabase/migrations/20261017010500_property_dues_open_items.sql";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
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

describe.skipIf(!mod)("aidat → açık kalem, iptal, depozito, cari (pglite, 20261017010500)", () => {
  let db: Db;
  let T: string, OWNER: string, BANKA: string, PROP: string, MALIK: string, KIRACI: string, RENTAL: string;
  let D_OPEN: string, D_PAID: string, D_LOCKED: string, D_ZERO: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const asUser = async (perms: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${OWNER}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','owner',false)`);
    await db.exec(`set role authenticated`);
  };
  const asOwner = () => asUser("expenses:view expenses:create expenses:edit expenses:delete rentals:view rentals:edit earnings_all:view");
  const dueItems = async () =>
    q(`select source_id::text as s, status, paid_amount::float8 as p, amount::float8 as a, issue_date::text as i, note, category, direction
         from public.finance_open_items where source_type = 'due' order by issue_date, amount`);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    MALIK = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Ayşe Malik') returning id`, [T]))[0]!.id as string;
    KIRACI = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Mehmet Kiracı') returning id`, [T]))[0]!.id as string;
    PROP = (await q(`insert into public.properties(tenant_id, title, owner_customer_id) values ($1, 'Daire 5', $2) returning id`, [T, MALIK]))[0]!.id as string;
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
    ]) await db.exec(read(f));
    await asOwner();
    BANKA = (await one<Record<string, string>>(`public.finance_account_create('office','bank','Banka',null,'TRY',0::numeric,'2026-01-01'::date)`)).account_id!;
    await db.exec(`reset role`);
    // Eski aidatlar: açık, ödenmiş, kilitli aya düşen (Mart 2026 kilitli), sıfır tutarlı (taşınmaz).
    D_OPEN = (await q(`insert into public.property_dues(tenant_id, property_id, title, amount, period, due_date) values ($1, $2, 'Eylül aidatı', 1500, '2026-09-01', '2026-09-10') returning id`, [T, PROP]))[0]!.id as string;
    D_PAID = (await q(`insert into public.property_dues(tenant_id, property_id, title, amount, period, status, paid_at) values ($1, $2, 'Ağustos aidatı', 1400, '2026-08-01', 'paid', '2026-08-12T10:00:00+03') returning id`, [T, PROP]))[0]!.id as string;
    D_LOCKED = (await q(`insert into public.property_dues(tenant_id, title, amount, period, due_date, notes) values ($1, 'Mart aidatı', 1200, '2026-03-01', '2026-03-05', 'eski not') returning id`, [T]))[0]!.id as string;
    D_ZERO = (await q(`insert into public.property_dues(tenant_id, title, amount, period) values ($1, 'Boş', 0, '2026-09-01') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.finance_period_locks(tenant_id, period_month) values ($1, '2026-03-01')`, [T]);
    // Kaynak bağlı tahsilat hareketi (migration öncesi; carisiz).
    const rp = (await q(`insert into public.rent_payments(tenant_id, rental_id, amount, paid_on) values ($1, $2, 20000, '2026-09-03') returning id`, [T, RENTAL]))[0]!.id as string;
    await q(`insert into public.cash_entries(tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title, source_type, source_id)
             values ($1, $2, 'in', 20000, 'TRY', '2026-09-03', 'income', 'kira_tahsilat', 'Kira tahsilatı', 'rent', $3)`, [T, BANKA, rp]);
    await db.exec(read(MIGRATION));
  }, 180_000);

  it("geri doldurma: her aidat tek açık kalem; ödenmiş 'kasa dışı', kilitli ay ilk açık aya taşınır, sıfır tutar atlanır", async () => {
    const rows = await dueItems();
    expect(rows.map((r) => r.s).sort()).toEqual([D_OPEN, D_PAID, D_LOCKED].sort());
    expect(rows.some((r) => r.s === D_ZERO)).toBe(false);
    const paid = rows.find((r) => r.s === D_PAID)!;
    expect(paid).toMatchObject({ status: "paid", p: 1400, category: "aidat", direction: "payable" });
    expect(paid.note).toContain("kasa dışı");
    const locked = rows.find((r) => r.s === D_LOCKED)!;
    expect(locked.i).toBe("2026-04-01");
    expect(locked.note).toContain("eski not");
    expect(locked.note).toContain("kilitli dönemden taşındı");
    const settled = (await q(`select settled_on::text as s from public.finance_open_items where source_id = $1`, [D_PAID]))[0]!.s;
    expect(settled).toBe("2026-08-12");
    const link = (await q(`select open_item_id from public.property_dues where id = $1`, [D_OPEN]))[0]!.open_item_id;
    expect(link).toBeTruthy();
  });

  it("geri doldurma idempotent: ikinci çalıştırma ve migration'ın yeniden uygulanması yeni kalem açmaz", async () => {
    await db.exec(`reset role`);
    const before = await dueItems();
    expect(await one<number>(`public.finance_due_backfill()`)).toBe(0);
    await db.exec(read(MIGRATION));
    expect(await dueItems()).toEqual(before);
  });

  it("property_dues authenticated için salt okunur; silme yetkisi yok", async () => {
    await asOwner();
    expect((await q(`select count(*)::int as n from public.property_dues`))[0]!.n).toBe(4);
    await expect(q(`insert into public.property_dues(tenant_id, title, amount) values ($1, 'x', 10)`, [T])).rejects.toThrow();
    await expect(q(`update public.property_dues set amount = 5 where id = $1`, [D_OPEN])).rejects.toThrow();
    await expect(q(`delete from public.property_dues where id = $1`, [D_OPEN])).rejects.toThrow();
  });

  it("yeni aidat açık kalem olarak açılır (due:id kaynak), KPI açık kalemlerden okunur", async () => {
    await asOwner();
    const id = await one<string>(`public.finance_due_create($1::jsonb)`, [JSON.stringify({
      title: "Ekim aidatı", amount: 1600, issue_date: "2026-10-01", due_date: "2026-10-10", property_id: PROP })]);
    await db.exec(`reset role`);
    const row = (await q(`select source_type, source_id::text as s, category, direction, party_id from public.finance_open_items where id = $1`, [id]))[0]!;
    expect(row).toMatchObject({ source_type: "due", s: id, category: "aidat", direction: "payable", party_id: null });
    // Ofisin tahsil ettiği aidat: malik carisine bağlanır (müşteri bağlı).
    await asOwner();
    const rec = await one<string>(`public.finance_due_create($1::jsonb)`, [JSON.stringify({
      title: "Malikten aidat", amount: 900, issue_date: "2026-10-01", direction: "receivable", property_id: PROP })]);
    await db.exec(`reset role`);
    const party = (await q(`select p.kind, p.customer_id::text as c from public.finance_open_items o join public.finance_parties p on p.id = o.party_id where o.id = $1`, [rec]))[0]!;
    expect(party).toEqual({ kind: "malik", c: MALIK });
    await asOwner();
    const kpi = (await q(`select total::float8 as t, unpaid::float8 as u from public.aidat_kpi()`))[0]!;
    expect(kpi).toEqual({ t: 1500 + 1400 + 1200 + 1600 + 900, u: 1500 + 1200 + 1600 + 900 });
    // Yetkisiz kullanıcı yeni aidat açamaz.
    await asUser("expenses:view");
    await expect(q(`select public.finance_due_create($1::jsonb)`, [JSON.stringify({ title: "x", amount: 1 })])).rejects.toThrow(/FN:forbidden/);
  });

  it("silme yerine iptal: status cancelled + neden + denetim; malike yansıtılmış kalem iptal edilemez", async () => {
    await db.exec(`reset role`);
    const item = (await q(`select id from public.finance_open_items where source_id = $1`, [D_OPEN]))[0]!.id as string;
    await q(`insert into public.owner_charge_links(tenant_id, rental_id, kind, ref_id, amount) values ($1, $2, 'due', $3, 1500)`, [T, RENTAL, D_OPEN]);
    await asOwner();
    await expect(q(`select public.finance_due_cancel($1::uuid, 'yanlış kayıt')`, [item])).rejects.toThrow(/FN:linked_to_owner/);
    await db.exec(`reset role; delete from public.owner_charge_links where ref_id = '${D_OPEN}'`);
    await asUser("expenses:view expenses:edit");
    await expect(q(`select public.finance_due_cancel($1::uuid, 'yanlış kayıt')`, [item])).rejects.toThrow(/FN:forbidden/);
    await asOwner();
    await expect(q(`select public.finance_due_cancel($1::uuid, 'x')`, [item])).rejects.toThrow(/FN:invalid_input/);
    await one(`public.finance_due_cancel($1::uuid, 'yanlış kayıt')`, [item]);
    await db.exec(`reset role`);
    const row = (await q(`select status, cancel_reason from public.finance_open_items where id = $1`, [item]))[0]!;
    expect(row).toEqual({ status: "cancelled", cancel_reason: "yanlış kayıt" });
    expect((await q(`select count(*)::int as n from public.finance_open_items where id = $1`, [item]))[0]!.n).toBe(1);
    expect((await q(`select count(*)::int as n from public.audit_logs where action = 'finance_open_item.cancel' and entity_id = $1`, [item]))[0]!.n).toBe(1);
  });

  it("ödendi: hesapla kasa hareketi (kategori aidat), hesapsız kasa dışı; geri alma yalnız kasa dışında", async () => {
    await asOwner();
    const a = await one<string>(`public.finance_due_create($1::jsonb)`, [JSON.stringify({ title: "Kasım aidatı", amount: 1700, issue_date: "2026-10-02" })]);
    const b = await one<string>(`public.finance_due_create($1::jsonb)`, [JSON.stringify({ title: "Aralık aidatı", amount: 1800, issue_date: "2026-10-03" })]);
    expect(await one<number>(`public.finance_due_mark_paid(array[$1::uuid], $2::uuid, '2026-10-05'::date)`, [a, BANKA])).toBe(1);
    expect(await one<number>(`public.finance_due_mark_paid(array[$1::uuid, $2::uuid], null, '2026-10-06'::date)`, [a, b])).toBe(1);
    await db.exec(`reset role`);
    const cash = (await q(`select direction, amount::float8 as a, category from public.cash_entries where open_item_id = $1 and voided_at is null`, [a]))[0]!;
    expect(cash).toEqual({ direction: "out", a: 1700, category: "aidat" });
    const st = await q(`select id::text, status, settled_on::text as s from public.finance_open_items where id in ($1, $2) order by amount`, [a, b]);
    expect(st.map((r) => [r.status, r.s])).toEqual([["paid", "2026-10-05"], ["paid", "2026-10-06"]]);
    await asOwner();
    await expect(q(`select public.finance_due_reopen($1::uuid)`, [a])).rejects.toThrow(/FN:has_cash/);
    await one(`public.finance_due_reopen($1::uuid)`, [b]);
    await db.exec(`reset role`);
    expect((await q(`select status, paid_amount::float8 as p, settled_on from public.finance_open_items where id = $1`, [b]))[0]).toEqual({ status: "open", p: 0, settled_on: null });
  });

  it("depozito: emanet giriş/çıkış 'depozito', kiracı carisi; tekrar çağrı aynı hareket; geri alma void eder", async () => {
    await asOwner();
    const e1 = await one<string>(`public.rental_deposit_post($1::uuid, 'received', $2::uuid, '2026-09-01'::date)`, [RENTAL, BANKA]);
    expect(await one<string>(`public.rental_deposit_post($1::uuid, 'received', $2::uuid, '2026-09-01'::date)`, [RENTAL, BANKA])).toBe(e1);
    await expect(q(`select public.rental_deposit_post($1::uuid, 'returned', $2::uuid, null)`, [RENTAL, BANKA])).rejects.toThrow(/FN:deposit_not_returned/);
    await db.exec(`reset role`);
    const row = (await q(`select e.direction, e.amount::float8 as a, e.category, p.kind, p.customer_id::text as c
                            from public.cash_entries e join public.finance_parties p on p.id = e.party_id where e.id = $1`, [e1]))[0]!;
    expect(row).toEqual({ direction: "in", a: 30000, category: "depozito", kind: "kiraci", c: KIRACI });
    await q(`update public.rentals set status = 'ended', deposit_returned = true where id = $1`, [RENTAL]);
    await asOwner();
    const e2 = await one<string>(`public.rental_deposit_post($1::uuid, 'returned', $2::uuid, null)`, [RENTAL, BANKA]);
    expect(await one<boolean>(`public.rental_deposit_unpost($1::uuid, 'returned', 'iade geri alındı')`, [RENTAL])).toBe(true);
    await db.exec(`reset role`);
    expect((await q(`select voided_at is not null as v, direction from public.cash_entries where id = $1`, [e2]))[0]).toEqual({ v: true, direction: "out" });
    expect((await q(`select deposit_returned_entry_id, deposit_received_entry_id::text as r from public.rentals where id = $1`, [RENTAL]))[0]).toEqual({ deposit_returned_entry_id: null, r: e1 });
    // Kiralama yetkisi olmayan depozito yazamaz.
    await asUser("expenses:view expenses:create");
    await expect(q(`select public.rental_deposit_post($1::uuid, 'received', $2::uuid, null)`, [RENTAL, BANKA])).rejects.toThrow(/FN:forbidden/);
  });

  it("cari: eski kira tahsilatı kiracıya bağlandı; yeni mülk sahibi ödemesi hareketi malike bağlanır", async () => {
    await db.exec(`reset role`);
    const rent = (await q(`select p.kind, p.customer_id::text as c from public.cash_entries e join public.finance_parties p on p.id = e.party_id where e.source_type = 'rent'`))[0]!;
    expect(rent).toEqual({ kind: "kiraci", c: KIRACI });
    const op = (await q(`insert into public.owner_payouts(tenant_id, rental_id, amount) values ($1, $2, 15000) returning id`, [T, RENTAL]))[0]!.id as string;
    await asOwner();
    const res = await one<{ outcome: string; entry_id: string }>(`public.finance_record_entry($1::uuid, 'out', 15000::numeric, '2026-09-20'::date, 'mulk_sahibi_odeme', 'Mülk sahibi ödemesi', null, null, null, 'owner_payout', $2::uuid)`, [BANKA, op]);
    expect(res.outcome).toBe("recorded");
    await db.exec(`reset role`);
    const party = (await q(`select p.kind, p.customer_id::text as c from public.cash_entries e join public.finance_parties p on p.id = e.party_id where e.id = $1`, [res.entry_id]))[0]!;
    expect(party).toEqual({ kind: "malik", c: MALIK });
    // Aynı müşteri + tür için tek cari.
    expect((await q(`select count(*)::int as n from public.finance_parties where customer_id = $1 and kind = 'malik'`, [MALIK]))[0]!.n).toBe(1);
  });

  it("rollback dosyası temiz çalışır, migration yeniden uygulanabilir (kalemler korunur)", async () => {
    await db.exec(`reset role`);
    const before = (await q(`select count(*)::int as n from public.finance_open_items where source_type = 'due'`))[0]!.n;
    await db.exec(read("supabase/rollbacks/20261017010500_property_dues_open_items.rollback.sql"));
    expect((await q(`select count(*)::int as n from public.finance_open_items where source_type = 'due'`))[0]!.n).toBe(before);
    await db.exec(read(MIGRATION));
    expect((await q(`select count(*)::int as n from public.finance_open_items where source_type = 'due'`))[0]!.n).toBe(before);
  });
});
