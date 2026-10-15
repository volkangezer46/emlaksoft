import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { commissionKey, einvoiceKey, revisedKey } from "@/lib/finance/posting/keys";

/**
 * İŞLEVSEL SQL TESTİ (pglite): WP5 e-Fatura ↔ defter (20261017010600).
 * Gerçek e-Fatura zinciri (000700 → 000600 → 000100 → 001000) + finans v2 zinciri + WP1 kayıt çekirdeği + bu migration.
 *  - serbest fatura resmileşince invoice.issued alacağı (KDV dahil, fatura tarihinde) + cari; tekrar çağrı yeni satır yazmaz;
 *  - iptal = ters kayıt (açık dönemde iptal, kilitli dönemde ilk açık aya ayna); tekrar iptal yeni satır yazmaz;
 *  - hata → taslak → yeniden resmileşme yeni sürüm anahtarı (`einvoice:{id}:r2`);
 *  - komisyon faturası VAR OLAN komisyon alacağına bağlanır (yeni kalem yok); alacak sonradan açılırsa da bağlanır;
 *  - tahsilatı olan kalemde iptal sağlayıcı sonucunu ENGELLEMEZ (denetim izi kalır);
 *  - iç fonksiyonlar istemciye kapalı.
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
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text not null default 'Danışman');
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
create table public.commission_payouts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, commission_id uuid, split_id uuid,
  profile_id uuid not null, amount numeric(14,2) not null, status text not null default 'pending', approved_at timestamptz, created_at timestamptz not null default now());
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, renter_customer_id uuid, due_day integer default 1);
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
  payer_role text not null default 'owner', payer_customer_id uuid, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, amount numeric not null default 0, voided_at timestamptz);
create table public.property_dues(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, title text not null,
  amount numeric(12,2) not null default 0, period date not null default current_date, due_date date, status text not null default 'unpaid');
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz not null default now());
create table public.expense_budgets(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, category text not null,
  monthly_amount numeric(14,2) not null, created_by uuid, is_sample boolean not null default false, unique (tenant_id, category));
create table public.permission_defaults(role text not null, module text not null, action text not null, primary key (role, module, action));
grant usage on schema public to authenticated, service_role;
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

const EINVOICE_CHAIN = [
  "supabase/migrations/20261010000700_einvoice.sql",
  "supabase/migrations/20261011000600_einvoice_state_machine.sql",
  "supabase/migrations/20261012000100_einvoice_recovery.sql",
  "supabase/migrations/20261012001000_einvoice_server_only_writes.sql",
];
const FINANCE_CHAIN = [
  "supabase/migrations/20261010000600_finance_accounts_cash_entries.sql",
  "supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql",
  "supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql",
  "supabase/migrations/20261012002900_finance_owner_payout_source.sql",
];
const LEDGER_CHAIN = [
  "supabase/migrations/20261014001000_finance_ledger_v2.sql",
  "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql",
  "supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql",
  "supabase/migrations/20261014011000_finance_party_advisor_scope.sql",
  "supabase/migrations/20261016060100_finance_pnl_vat_fix.sql",
  "supabase/migrations/20261017010000_finance_posting_core.sql",
];
const WP5 = "supabase/migrations/20261017010600_einvoice_ledger_link.sql";

const OWNER_PERMS = "expenses:view expenses:create expenses:edit expenses:delete commissions:view commissions:create commissions:edit earnings_all:view";

type Row = Record<string, unknown>;

describe.skipIf(!mod)("e-Fatura ↔ defter: invoice.issued / ters kayıt (pglite, 20261017010600)", () => {
  let db: Db;
  let T: string, OWNER: string, BANKA: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Row[];
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const sudo = async () => db.exec(`reset role; select set_config('request.jwt.claim.sub','${OWNER}',false), set_config('test.tenant','${T}',false), set_config('test.perms','${OWNER_PERMS}',false), set_config('test.role','owner',false)`);
  const asOwner = async () => {
    await sudo();
    await db.exec(`set role authenticated`);
  };

  const newInvoice = async (o: { source?: "free" | "commission" | "deal" | "rent_management_fee"; sourceId?: string | null; gross?: number; vat?: number; date?: string; tax?: string; buyer?: string } = {}) => {
    await sudo();
    const gross = o.gross ?? 1200;
    const vat = o.vat ?? 200;
    const id = (await q(
      `insert into public.einvoices (tenant_id, provider, source_type, source_id, doc_type, buyer_name, buyer_tax_id, lines, net_total, vat_total, gross_total,
         issue_date, idempotency_key, created_by)
       values ($1, 'nilvera', $2, $3, 'e-arsiv', $4, $5, '[{"description":"Hizmet","quantity":1,"unitPrice":1000,"vatRate":20}]'::jsonb, $6, $7, $8, $9::date, $10, $11)
       returning id`,
      [T, o.source ?? "free", o.sourceId ?? null, o.buyer ?? "Örnek Yapı A.Ş.", o.tax ?? "1234567890", gross - vat, vat, gross, o.date ?? "2026-09-10", `k:${randomUUID()}`, OWNER],
    ))[0]!.id as string;
    return id;
  };
  const setStatus = async (id: string, status: string) => {
    await sudo();
    await q(`update public.einvoices set status = $2 where id = $1`, [id, status]);
  };
  const inv = async (id: string) => (await q(`select status, party_id, open_item_id from public.einvoices where id = $1`, [id]))[0]!;
  const item = async (id: unknown) =>
    (await q(`select direction, status, amount::float8 as amount, vat_amount::float8 as vat, issue_date::text as d, posting_key, event_type, invoice_id, party_id, category
               from public.finance_open_items where id = $1`, [id]))[0]!;
  const itemCount = async (invoiceId: string) =>
    Number((await q(`select count(*) from public.finance_open_items where posting_key like $1`, [`einvoice:${invoiceId}%`]))[0]!.count);
  const sync = async (id: string) => one<Row>(`public.finance_einvoice_ledger_sync($1::uuid, $2::uuid, true)`, [id, OWNER]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ofis Sahibi') returning id`, [T]))[0]!.id as string;
    for (const f of EINVOICE_CHAIN) await db.exec(read(f));
    for (const f of FINANCE_CHAIN) await db.exec(read(f));
    await db.exec(FINANCE_STUBS);
    for (const f of LEDGER_CHAIN) await db.exec(read(f));
    await db.exec(read(WP5));
    await db.exec(`grant all on all tables in schema public to service_role`);
    await asOwner();
    BANKA = (await one<Row>(`public.finance_account_create('office','bank','Banka',null,'TRY',10000::numeric,'2026-07-01'::date)`)).account_id as string;
    await sudo();
  }, 180_000);

  it("serbest fatura resmileşince KDV dahil alacak açılır (fatura tarihinde), cari VKN ile bağlanır; tekrar çağrı yeni satır yazmaz", async () => {
    const id = await newInvoice({ gross: 1200, vat: 200, date: "2026-09-10" });
    expect(await itemCount(id)).toBe(0); // taslak deftere yazmaz
    await setStatus(id, "issued");
    const e = await inv(id);
    expect(e.open_item_id).toBeTruthy();
    expect(e.party_id).toBeTruthy();
    expect(await item(e.open_item_id)).toMatchObject({
      direction: "receivable", status: "open", amount: 1200, vat: 200, d: "2026-09-10", posting_key: einvoiceKey(id),
      event_type: "invoice.issued", invoice_id: id, party_id: e.party_id, category: "hizmet_bedeli",
    });
    expect((await q(`select kind, name, tax_id from public.finance_parties where id = $1`, [e.party_id]))[0]).toEqual({ kind: "musteri", name: "Örnek Yapı A.Ş.", tax_id: "1234567890" });

    expect(await sync(id)).toMatchObject({ outcome: "unchanged", open_item_id: e.open_item_id });
    expect(await one<number>(`public.finance_einvoice_ledger_backfill()`)).toBe(0);
    expect(await itemCount(id)).toBe(1);

    // Aynı VKN'li ikinci fatura aynı cariye düşer (yeni cari açılmaz).
    const id2 = await newInvoice({ buyer: "ÖRNEK YAPI ANONİM ŞİRKETİ" });
    await setStatus(id2, "issued");
    expect((await inv(id2)).party_id).toBe(e.party_id);
  });

  it("iptal: açık dönemde kalem iptal edilir; tekrar eşitleme yeni satır yazmaz", async () => {
    const id = await newInvoice();
    await setStatus(id, "issued");
    const itemId = (await inv(id)).open_item_id;
    await setStatus(id, "cancelled");
    expect(await item(itemId)).toMatchObject({ status: "cancelled" });
    expect((await inv(id)).open_item_id).toBe(itemId); // iptal edilmiş fatura değiştirilemez: iz kalır
    const again = await sync(id);
    expect(again.outcome).toBe("already_reversed");
    expect(Number((await q(`select count(*) from public.finance_open_items where reversal_of = $1`, [itemId]))[0]!.count)).toBe(0);
    expect(await itemCount(id)).toBe(1);
  });

  it("kilitli döneme düşen faturanın iptali ilk açık aya ayna kalem yazar", async () => {
    const id = await newInvoice({ date: "2026-08-15" });
    await setStatus(id, "issued");
    const itemId = (await inv(id)).open_item_id;
    await asOwner();
    await one(`public.finance_period_lock('2026-08-01'::date, 'Ağustos kapandı')`);
    await setStatus(id, "cancelled");
    const mirror = (await q(`select direction, status, issue_date::text as d, posting_key, amount::float8 as a from public.finance_open_items where reversal_of = $1`, [itemId]))[0]!;
    expect(mirror).toEqual({ direction: "payable", status: "paid", d: "2026-09-01", posting_key: `${einvoiceKey(id)}:rev`, a: 1200 });
    expect(await item(itemId)).toMatchObject({ status: "paid", d: "2026-08-15" });
    expect((await sync(id)).outcome).toBe("already_reversed");
    expect(Number((await q(`select count(*) from public.finance_open_items where reversal_of = $1`, [itemId]))[0]!.count)).toBe(1);
  });

  it("hata → taslak → yeniden resmileşme yeni sürüm anahtarıyla tek canlı alacak bırakır", async () => {
    const id = await newInvoice({ date: "2026-10-01" });
    await setStatus(id, "issued");
    const first = (await inv(id)).open_item_id;
    await setStatus(id, "error");
    expect(await item(first)).toMatchObject({ status: "cancelled" });
    expect((await inv(id)).open_item_id).toBeNull();
    await setStatus(id, "draft");
    await setStatus(id, "issued");
    const second = (await inv(id)).open_item_id;
    expect(second).not.toBe(first);
    expect(await item(second)).toMatchObject({ status: "open", posting_key: revisedKey(einvoiceKey(id), 2) });
    expect(Number((await q(`select count(*) from public.finance_open_items where invoice_id = $1 and status <> 'cancelled'`, [id]))[0]!.count)).toBe(1);
  });

  it("komisyon faturası var olan komisyon alacağına bağlanır (yeni kalem yok); iptalde alacak yerinde kalır", async () => {
    await sudo();
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 10000, 2000) returning id`, [T]))[0]!.id as string;
    const acc = await one<Row>(`public.finance_post_internal($1::uuid, $2::uuid, $3::jsonb)`, [T, OWNER, JSON.stringify({
      event_type: "commission.accrued", posting_key: commissionKey(c), date: "2026-10-02", source_id: c, item: { amount: 12000, vat_amount: 2000 },
    })]);
    const commissionItem = acc.open_item_id as string;
    const id = await newInvoice({ source: "commission", sourceId: c, gross: 12000, vat: 2000, date: "2026-10-03", tax: "9876543210", buyer: "Ayşe Yılmaz" });
    const before = Number((await q(`select count(*) from public.finance_open_items`))[0]!.count);
    await setStatus(id, "issued");
    expect(Number((await q(`select count(*) from public.finance_open_items`))[0]!.count)).toBe(before);
    const e = await inv(id);
    expect(e.open_item_id).toBe(commissionItem);
    expect(await item(commissionItem)).toMatchObject({ invoice_id: id, party_id: e.party_id, status: "open", event_type: "commission.accrued" });
    await setStatus(id, "cancelled");
    expect(await item(commissionItem)).toMatchObject({ invoice_id: null, status: "open" });
  });

  it("komisyon alacağı faturadan SONRA açılırsa iki yönlü bağ kurulur; kira yönetim ücreti faturası alacak açmaz", async () => {
    await sudo();
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 5000, 1000) returning id`, [T]))[0]!.id as string;
    const id = await newInvoice({ source: "commission", sourceId: c, gross: 6000, vat: 1000, date: "2026-10-04", tax: "1111111111", buyer: "Cem Kaya" });
    await setStatus(id, "issued");
    const e = await inv(id);
    expect(e.open_item_id).toBeNull();
    expect(e.party_id).toBeTruthy();
    const acc = await one<Row>(`public.finance_post_internal($1::uuid, $2::uuid, $3::jsonb)`, [T, OWNER, JSON.stringify({
      event_type: "commission.accrued", posting_key: commissionKey(c), date: "2026-10-04", source_id: c, item: { amount: 6000, vat_amount: 1000 },
    })]);
    expect((await inv(id)).open_item_id).toBe(acc.open_item_id);
    expect(await item(acc.open_item_id)).toMatchObject({ invoice_id: id, party_id: e.party_id });

    const fee = await newInvoice({ source: "rent_management_fee", sourceId: randomUUID(), gross: 600, vat: 100, date: "2026-10-05" });
    await setStatus(fee, "issued");
    expect(await inv(fee)).toMatchObject({ open_item_id: null });
    expect(await itemCount(fee)).toBe(0);
  });

  it("tahsilatı olan faturanın iptali sağlayıcı sonucunu engellemez; kalem açık kalır, denetim izi düşer", async () => {
    const id = await newInvoice({ gross: 2400, vat: 400, date: "2026-10-06" });
    await setStatus(id, "issued");
    const itemId = (await inv(id)).open_item_id as string;
    await sudo();
    // Kısmi tahsilat: kaleme bağlı banka girişi (ödeme ilerlemesi tetikle hesaplanır).
    await q(`insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title, source_type, open_item_id, created_by)
             values ($1, $2, 'in', 1000, 'TRY', '2026-10-07', 'income', 'hizmet_bedeli', 'Fatura tahsilatı', 'manual', $3, $4)`, [T, BANKA, itemId, OWNER]);
    expect(await item(itemId)).toMatchObject({ status: "partial" });
    await setStatus(id, "cancelled");
    expect((await inv(id)).status).toBe("cancelled");
    expect(await item(itemId)).toMatchObject({ status: "partial" });
    const log = await q(`select action, new_value from public.audit_logs where entity_id = $1 and action like 'einvoice.ledger%'`, [id]);
    expect(log.map((l) => l.action)).toEqual(["einvoice.ledger_reverse_skipped"]);
  });

  it("iç fonksiyonlar istemciye kapalı", async () => {
    const id = await newInvoice();
    await asOwner();
    await expect(db.query(`select public.finance_einvoice_ledger_sync($1::uuid, null, true)`, [id])).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.finance_einvoice_ledger_backfill()`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.finance_einvoice_party($1::uuid, 'x', null, null)`, [T])).rejects.toThrow(/permission denied/);
    await sudo();
  });
});
