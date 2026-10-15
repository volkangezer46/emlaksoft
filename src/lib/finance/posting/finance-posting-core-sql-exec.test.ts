import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { POSTING_RULES } from "./rules";
import { commissionCollectionKey, commissionKey, expenseKey, invoiceReceivedKey, payoutKey, transferKey } from "./keys";
import { toEventPayload, type PostingEvent } from "./client";

/**
 * İŞLEVSEL SQL TESTİ (pglite): WP1 kayıt çekirdeği (20261017010000) + açık kalem görünümü v3 (20261017010100).
 * Gerçek finans zinciri (000600 → 001100 → 011000 → 060100) + bu iki migration; kaynak tablolar sade taslaktır.
 *  - kural tablosu = rules.ts; tekrar post tek satır (`duplicate`);
 *  - kilitli döneme ters kayıt: ilk açık ayda `reversal_of` bağlı ayna (hareket ve kalem), açık dönemde iptal;
 *  - rastgele post/ters kayıt dizisi sonrası bakiye = açılış + Σgiriş − Σçıkış;
 *  - komisyon alacağı = brüt + KDV − tahsilat (eski: brüt − KDV dahil tahsilat).
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
create table public.einvoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz not null default now());
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

const CHAIN = [
  "supabase/migrations/20261014001000_finance_ledger_v2.sql",
  "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql",
  "supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql",
  "supabase/migrations/20261014011000_finance_party_advisor_scope.sql",
  "supabase/migrations/20261016060100_finance_pnl_vat_fix.sql",
];
const CORE = "supabase/migrations/20261017010000_finance_posting_core.sql";
const V3 = "supabase/migrations/20261017010100_finance_open_items_v3.sql";

const OWNER_PERMS =
  "expenses:view expenses:create expenses:edit expenses:delete commissions:view commissions:edit earnings_all:view rentals:view rentals:edit rentals:delete";

type Json = Record<string, unknown>;

/** Deterministik sözde rastgele (mulberry32): test her koşuda aynı diziyi üretir. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!mod)("kayıt çekirdeği: finance_post / finance_reverse + açık kalem v3 (pglite, 20261017010000/010100)", () => {
  let db: Db;
  let T: string, OWNER: string, ADVISOR: string, BANKA: string, KASA: string, CUSTOMER: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const as = async (uid: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const asOwner = () => as(OWNER, OWNER_PERMS, "owner");
  const post = async (e: PostingEvent) => one<Json>(`public.finance_post($1::jsonb)`, [JSON.stringify(toEventPayload(e))]);
  const reverse = async (id: string, reason: string, date: string | null = null) =>
    one<Json>(`public.finance_reverse($1::uuid, $2, $3::date)`, [id, reason, date]);
  const sudo = async () => db.exec(`reset role`);
  const balances = async () => {
    await asOwner();
    const rows = await q(`select account_id::text as id, balance::float8 as b from public.finance_account_balances()`);
    return Object.fromEntries(rows.map((r) => [r.id as string, r.b as number])) as Record<string, number>;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ofis Sahibi') returning id`, [T]))[0]!.id as string;
    ADVISOR = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Deniz Danışman') returning id`, [T]))[0]!.id as string;
    CUSTOMER = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Ayşe Yılmaz') returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
    await db.exec(read("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
    await db.exec(read("supabase/migrations/20261012002900_finance_owner_payout_source.sql"));
    await db.exec(FINANCE_STUBS);
    for (const f of CHAIN) await db.exec(read(f));
    await db.exec(read(CORE));
    await db.exec(read(V3));
    await asOwner();
    BANKA = (await one<Json>(`public.finance_account_create('office','bank','Banka',null,'TRY',10000::numeric,'2026-07-01'::date)`)).account_id as string;
    KASA = (await one<Json>(`public.finance_account_create('office','cash','Kasa',null,'TRY',2000::numeric,'2026-07-01'::date)`)).account_id as string;
    await sudo();
  }, 180_000);

  it("kural tablosu rules.ts ile birebir aynı", async () => {
    await sudo();
    const rows = await q(`select * from public.finance_posting_rules order by event_type`);
    const sql = rows.map((r) => ({
      eventType: r.event_type, label: r.label, keyPrefix: r.key_prefix, sourceType: r.source_type, sourceRequired: r.source_required,
      itemMode: r.item_mode, itemDirection: r.item_direction, itemCategory: r.item_category, cashMode: r.cash_mode,
      cashDirection: r.cash_direction, cashCategory: r.cash_category, accountScope: r.account_scope, pnl: r.pnl,
      permModule: r.perm_module, permAction: r.perm_action, ownerGmOnly: r.owner_gm_only, tdhp: r.tdhp,
    }));
    const ts = [...POSTING_RULES].sort((a, b) => (a.eventType < b.eventType ? -1 : 1));
    expect(sql).toEqual(ts);
  });

  it("tekrar post tek satır yazar: ikinci çağrı duplicate ve aynı kimlikleri döner", async () => {
    await sudo();
    const deal = (await q(`insert into public.deals(tenant_id, customer_id) values ($1, $2) returning id`, [T, CUSTOMER]))[0]!.id as string;
    const c = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, vat_amount, created_at) values ($1, $2, 10000, 2000, '2026-09-05T10:00:00+03') returning id`, [T, deal]))[0]!.id as string;
    await asOwner();
    const ev: PostingEvent = {
      eventType: "commission.accrued", postingKey: commissionKey(c), date: "2026-09-05", sourceId: c, partyName: "Ayşe Yılmaz",
      item: { amount: 12000, vatAmount: 2000, dueDate: "2026-10-05" },
    };
    const first = await post(ev);
    expect(first.outcome).toBe("posted");
    const second = await post(ev);
    expect(second).toMatchObject({ outcome: "duplicate", open_item_id: first.open_item_id, reversed: false });
    // Tahsilat (kısmi, aynı olayda tahakkuk kalemini kapatır) da tekrar edilirse tek hareket kalır.
    const col: PostingEvent = {
      eventType: "commission.collected", postingKey: commissionCollectionKey(c, 1), date: "2026-09-20", sourceId: c,
      entries: [{ accountId: BANKA, amount: 5000, settles: first.open_item_id as string }],
    };
    const p1 = await post(col);
    const p2 = await post(col);
    expect(p1.outcome).toBe("posted");
    expect(p2).toMatchObject({ outcome: "duplicate", entry_ids: p1.entry_ids });
    // Aynı kaynağa ikinci kısmi tahsilat (yeni anahtar) aynı hesaba yazılabilir (eski kaynak tekilliği posting satırlarına uygulanmaz).
    expect((await post({ ...col, postingKey: commissionCollectionKey(c, 2), entries: [{ accountId: BANKA, amount: 1000, settles: first.open_item_id as string }] })).outcome).toBe("posted");
    await sudo();
    expect(Number((await q(`select count(*) from public.finance_open_items where posting_key = $1`, [commissionKey(c)]))[0]!.count)).toBe(1);
    expect(Number((await q(`select count(*) from public.cash_entries where posting_key = $1`, [commissionCollectionKey(c, 1)]))[0]!.count)).toBe(1);
    expect((await q(`select status, paid_amount::float8 as p from public.finance_open_items where id = $1`, [first.open_item_id]))[0]).toEqual({ status: "partial", p: 6000 });
    // Görünüm: kayıt servisiyle açılan kalem tek satır (hesaplanmış komisyon kolu tekrar etmez), kalan 6.000, cari çözülmüş.
    await asOwner();
    const v = await q(`select key, source, amount_open::float8 as a, party_label from public.finance_open_items_v where source_id = $1 or key = $2`, [first.open_item_id, `commission:${c}`]);
    expect(v).toEqual([{ key: `manual:${first.open_item_id}`, source: "manual", a: 6000, party_label: "Ayşe Yılmaz" }]);
    // Tahsilatı olan kalem ters kayıtla kapatılamaz.
    expect((await reverse(first.open_item_id as string, "yanlış kayıt")).outcome).toBe("has_settlements");
    // Denetim: kayıt servisi satırları audit_logs'a düşer.
    await sudo();
    expect(Number((await q(`select count(*) from public.audit_logs where action = 'finance.open_item.insert' and entity_id = $1`, [first.open_item_id]))[0]!.count)).toBe(1);
  });

  it("kilitli döneme ters kayıt: ilk açık ayda reversal_of bağlı ayna; açık dönemde iptal; kilitli aya nakit yazılmaz", async () => {
    await asOwner();
    const before = await balances();
    const k1 = expenseKey(randomUUID());
    const exp = await post({ eventType: "expense.paid", postingKey: k1, date: "2026-08-10", entries: [{ accountId: BANKA, amount: 1500, category: "ofis" }] });
    expect(exp.outcome).toBe("posted");
    const entry = (exp.entry_ids as string[])[0]!;
    const inv = await post({ eventType: "invoice.received", postingKey: invoiceReceivedKey(randomUUID()), date: "2026-08-12", partyName: "Tedarikçi A",
      item: { amount: 2400, vatRate: 20, category: "ofis", dueDate: "2026-09-12" } });
    expect(inv.outcome).toBe("posted");
    await one(`public.finance_period_lock('2026-08-01'::date, 'Ağustos kapandı')`);

    // Hareket: ayna 1 Eylül'de, ters yönde, kind adjust; asıl iptal edilmez.
    const r = await reverse(entry, "Yanlış hesaba yazıldı", "2026-08-20");
    expect(r).toMatchObject({ outcome: "mirrored", reversal_date: "2026-09-01" });
    await sudo();
    const mirror = (await q(`select direction, kind, entry_date::text as d, amount::float8 as a, reversal_of, posting_key from public.cash_entries where id = $1`, [(r.reversal_ids as string[])[0]]))[0]!;
    expect(mirror).toEqual({ direction: "in", kind: "adjust", d: "2026-09-01", a: 1500, reversal_of: entry, posting_key: `${k1}:rev` });
    expect((await q(`select voided_at from public.cash_entries where id = $1`, [entry]))[0]!.voided_at).toBeNull();
    expect(await balances()).toEqual(before);
    await asOwner();
    expect((await reverse(entry, "ikinci deneme")).outcome).toBe("already_reversed");
    expect(await post({ eventType: "expense.paid", postingKey: k1, date: "2026-08-10", entries: [{ accountId: BANKA, amount: 1500, category: "ofis" }] }))
      .toMatchObject({ outcome: "duplicate", reversed: true });

    // Açık kalem: ayna kalem Eylül'de ters yönde; ikisi de kapanır, görünümden düşer.
    const ri = await reverse(inv.open_item_id as string, "Fatura iade edildi");
    expect(ri.outcome).toBe("mirrored");
    await sudo();
    const items = await q(`select id, direction, status, issue_date::text as d, reversal_of from public.finance_open_items where id = any($1::uuid[]) order by issue_date`,
      [[inv.open_item_id, (ri.reversal_ids as string[])[0]]]);
    expect(items.map((x) => [x.direction, x.status, x.d])).toEqual([["payable", "paid", "2026-08-12"], ["receivable", "paid", "2026-09-01"]]);
    expect(items[1]!.reversal_of).toBe(inv.open_item_id);
    await asOwner();
    expect(await q(`select key from public.finance_open_items_v where source_id = any($1::uuid[])`, [[inv.open_item_id, (ri.reversal_ids as string[])[0]]])).toEqual([]);

    // Kilitli aya tahakkuk: ilk açık aya tarihlenir, not işaretlenir. Kilitli aya nakit: period_locked, satır yok.
    const late = await post({ eventType: "invoice.received", postingKey: invoiceReceivedKey(randomUUID()), date: "2026-08-15", partyName: "Tedarikçi B",
      item: { amount: 600, category: "ofis" } });
    expect(late).toMatchObject({ outcome: "posted", redated: true, issue_date: "2026-09-01" });
    await sudo();
    expect(String((await q(`select note from public.finance_open_items where id = $1`, [late.open_item_id]))[0]!.note)).toMatch(/^Kilitli dönem: asıl tarih 15\.08\.2026/);
    await asOwner();
    const lockedKey = expenseKey(randomUUID());
    expect((await post({ eventType: "expense.paid", postingKey: lockedKey, date: "2026-08-25", entries: [{ accountId: BANKA, amount: 100, category: "ofis" }] })).outcome).toBe("period_locked");
    await sudo();
    expect(Number((await q(`select count(*) from public.cash_entries where posting_key = $1`, [lockedKey]))[0]!.count)).toBe(0);

    // Açık dönem: iptal (void); bakiye geri döner.
    await asOwner();
    const open = await post({ eventType: "expense.paid", postingKey: expenseKey(randomUUID()), date: "2026-09-03", entries: [{ accountId: KASA, amount: 250, category: "ofis" }] });
    const v = await reverse((open.entry_ids as string[])[0]!, "Mükerrer giriş");
    expect(v.outcome).toBe("voided");
    expect(await balances()).toEqual(before);
    // Ayna kaydın kendisi ters kaydedilemez.
    expect((await reverse((r.reversal_ids as string[])[0]!, "aynayı geri al")).outcome).toBe("invalid_input");
  });

  it("komisyon alacağı KDV esası: brüt + KDV − tahsilat (kısmi tahsilat kalemi erken kapatmaz)", async () => {
    await sudo();
    const deal = (await q(`insert into public.deals(tenant_id, customer_id) values ($1, $2) returning id`, [T, CUSTOMER]))[0]!.id as string;
    const c = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, vat_amount, created_at) values ($1, $2, 10000, 2000, '2026-09-10T10:00:00+03') returning id`, [T, deal]))[0]!.id as string;
    const party = (await q(`insert into public.finance_parties(tenant_id, kind, name, customer_id) values ($1, 'musteri', 'Ayşe Y. (cari)', $2) returning id`, [T, CUSTOMER]))[0]!.id as string;
    await asOwner();
    const row = async () => (await q(`select amount_open::float8 as a, party_id from public.finance_open_items_v where key = $1`, [`commission:${c}`]))[0];
    expect(await row()).toEqual({ a: 12000, party_id: party });
    // Eski yol (KDV dahil tahsilat hareketi): 6.000 tahsilattan sonra 6.000 açık (eski görünüm 4.000 derdi).
    const r1 = await one<Json>(`public.finance_record_entry($1::uuid, 'in', 6000::numeric, '2026-09-15'::date, 'komisyon', 'Komisyon tahsilatı', null, null, null, 'commission', $2::uuid)`, [BANKA, c]);
    expect(r1.outcome).toBe("recorded");
    expect(await row()).toEqual({ a: 6000, party_id: party });
    // Kayıt servisiyle ikinci (kalan) tahsilat: alacak kapanır, satır düşer.
    expect((await post({ eventType: "commission.collected", postingKey: commissionCollectionKey(c, 1), date: "2026-09-25", sourceId: c,
      entries: [{ accountId: KASA, amount: 6000 }] })).outcome).toBe("posted");
    expect(await row()).toBeUndefined();
  });

  it("yeni kollar: bina aidatı alacağı, aidat borcu, danışman hakedişi (P12: yalnız kendi hakedişi)", async () => {
    await sudo();
    const b = (await q(`insert into public.buildings(tenant_id, name) values ($1, 'Lale Sitesi') returning id`, [T]))[0]!.id as string;
    const u = (await q(`insert into public.building_units(tenant_id, building_id, unit_no) values ($1, $2, 'A-3') returning id`, [T, b]))[0]!.id as string;
    const bc = (await q(`insert into public.building_charges(tenant_id, building_id, unit_id, amount, paid_amount, status, due_date, payer_customer_id)
      values ($1, $2, $3, 1500, 500, 'partial', '2026-10-05', $4) returning id`, [T, b, u, CUSTOMER]))[0]!.id as string;
    const pr = (await q(`insert into public.properties(tenant_id, title) values ($1, 'Moda 2+1') returning id`, [T]))[0]!.id as string;
    const du = (await q(`insert into public.property_dues(tenant_id, property_id, title, amount, period) values ($1, $2, 'Ekim aidatı', 900, '2026-10-01') returning id`, [T, pr]))[0]!.id as string;
    const mine = (await q(`insert into public.commission_payouts(tenant_id, profile_id, amount, status) values ($1, $2, 3000, 'approved') returning id`, [T, ADVISOR]))[0]!.id as string;
    const other = (await q(`insert into public.commission_payouts(tenant_id, profile_id, amount, status) values ($1, $2, 4000, 'pending') returning id`, [T, OWNER]))[0]!.id as string;
    await asOwner();
    const rows = await q(`select key, direction, amount_open::float8 as a, party_label, href from public.finance_open_items_v
      where key in ($1, $2, $3, $4) order by amount_open`, [`building:${bc}`, `due:${du}`, `payout:${mine}`, `payout:${other}`]);
    expect(rows).toEqual([
      { key: `due:${du}`, direction: "payable", a: 900, party_label: "Moda 2+1", href: "/app/aidat" },
      { key: `building:${bc}`, direction: "receivable", a: 1000, party_label: "Ayşe Yılmaz", href: `/app/aidat?sekme=binalar&bina=${b}&bolum=tahsilat` },
      { key: `payout:${mine}`, direction: "payable", a: 3000, party_label: "Deniz Danışman", href: "/app/cuzdan?sekme=ofis" },
      { key: `payout:${other}`, direction: "payable", a: 4000, party_label: "Ofis Sahibi", href: "/app/cuzdan?sekme=ofis" },
    ]);
    // earnings_all olmayan danışman yalnız kendi hakedişini görür.
    await as(ADVISOR, "expenses:view commissions:view", "agent");
    expect((await q(`select key from public.finance_open_items_v where source = 'payout' order by key`)).map((r) => r.key)).toEqual([`payout:${mine}`]);
  });

  it("yetki: modül izni, hakediş ödemesi owner/gm, readonly ve iç fonksiyon istemciye kapalı", async () => {
    await sudo();
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 1000, 200) returning id`, [T]))[0]!.id as string;
    const pay = (await q(`insert into public.commission_payouts(tenant_id, profile_id, amount, status) values ($1, $2, 500, 'approved') returning id`, [T, ADVISOR]))[0]!.id as string;
    const accrual: PostingEvent = { eventType: "commission.accrued", postingKey: commissionKey(c), sourceId: c, date: "2026-10-01", item: { amount: 1200 } };
    await as(OWNER, "expenses:view expenses:create", "accounting");
    expect((await post(accrual)).outcome).toBe("forbidden");
    await as(OWNER, OWNER_PERMS, "accounting");
    expect((await post({ eventType: "payout.paid", postingKey: payoutKey(pay), sourceId: pay, date: "2026-10-02", entries: [{ accountId: BANKA, amount: 500 }] })).outcome).toBe("forbidden");
    await as(OWNER, OWNER_PERMS, "readonly");
    expect((await post(accrual)).outcome).toBe("forbidden");
    await asOwner();
    await expect(q(`select public.finance_post_internal($1::uuid, $2::uuid, '{}'::jsonb)`, [T, OWNER])).rejects.toThrow();
    // Başka ofisin kaynağı: source_not_found.
    await sudo();
    const T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const foreign = (await q(`insert into public.commissions(tenant_id, gross_amount) values ($1, 100) returning id`, [T2]))[0]!.id as string;
    await asOwner();
    expect((await post({ ...accrual, postingKey: commissionKey(foreign), sourceId: foreign })).outcome).toBe("source_not_found");
    // Kuralla çelişen şekil ve anahtar.
    expect((await post({ ...accrual, entries: [{ accountId: BANKA, amount: 10 }] })).outcome).toBe("invalid_input");
    expect((await one<Json>(`public.finance_post($1::jsonb)`, [JSON.stringify({ ...toEventPayload(accrual), posting_key: `split:${c}` })])).outcome).toBe("invalid_key");
    // Hakediş ödemesi owner ile: nakit çıkış + stopaj borcu tek olayda.
    const paid = await post({ eventType: "payout.paid", postingKey: payoutKey(pay), sourceId: pay, date: "2026-10-02", partyName: "Vergi Dairesi", partyKind: "diger",
      item: { amount: 75, dueDate: "2026-11-26" }, entries: [{ accountId: BANKA, amount: 500 }] });
    expect(paid.outcome).toBe("posted");
    expect((paid.entry_ids as string[]).length).toBe(1);
    expect(paid.open_item_id).toBeTruthy();
  });

  it("rastgele post / ters kayıt dizisi sonrası bakiye = açılış + Σgiriş − Σçıkış", async () => {
    await sudo();
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 900000, 0) returning id`, [T]))[0]!.id as string;
    const start = await balances();
    const model: Record<string, number> = { ...start };
    const rand = rng(20261017);
    const pick = <X,>(xs: readonly X[]) => xs[Math.floor(rand() * xs.length)]!;
    const amount = () => Math.round((1 + rand() * 900) * 100) / 100;
    const DATES = ["2026-08-20", "2026-09-04", "2026-09-18", "2026-09-29", "2026-10-02", "2026-10-06"];
    const posted: { ids: string[]; legs: { acc: string; signed: number }[]; reversed: boolean }[] = [];
    const replay: PostingEvent[] = [];
    let col = 100;
    let lockedSep = false;
    for (let step = 0; step < 70; step++) {
      await asOwner();
      if (step === 35) {
        await one(`public.finance_period_lock('2026-09-01'::date, null)`);
        lockedSep = true;
      }
      const roll = rand();
      if (roll < 0.2 && posted.some((p) => !p.reversed)) {
        const target = pick(posted.filter((p) => !p.reversed));
        const res = await reverse(pick(target.ids), `adım ${step}`, "2026-10-05");
        expect(["voided", "mirrored"]).toContain(res.outcome);
        if (lockedSep && res.outcome === "mirrored") expect(String(res.reversal_date) >= "2026-10-01").toBe(true);
        target.reversed = true;
        for (const l of target.legs) model[l.acc]! -= l.signed;
        continue;
      }
      if (roll < 0.27 && replay.length > 0) {
        expect((await post(pick(replay))).outcome).toBe("duplicate");
        continue;
      }
      const date = pick(DATES);
      const a = amount();
      let ev: PostingEvent;
      let legs: { acc: string; signed: number }[];
      if (roll < 0.55) {
        const acc = pick([BANKA, KASA]);
        ev = { eventType: "expense.paid", postingKey: expenseKey(randomUUID()), date, entries: [{ accountId: acc, amount: a, category: "ofis" }] };
        legs = [{ acc, signed: -a }];
      } else if (roll < 0.8) {
        const acc = pick([BANKA, KASA]);
        ev = { eventType: "commission.collected", postingKey: commissionCollectionKey(c, col++), date, sourceId: c, entries: [{ accountId: acc, amount: a }] };
        legs = [{ acc, signed: a }];
      } else {
        const [from, to] = rand() < 0.5 ? [BANKA, KASA] : [KASA, BANKA];
        ev = { eventType: "transfer", postingKey: transferKey(randomUUID()), date,
          entries: [{ accountId: from, direction: "out", amount: a }, { accountId: to, direction: "in", amount: a }] };
        legs = [{ acc: from, signed: -a }, { acc: to, signed: a }];
      }
      const res = await post(ev);
      const locked = date < "2026-09-01" || (lockedSep && date < "2026-10-01");
      if (locked) {
        expect(res.outcome).toBe("period_locked");
        continue;
      }
      expect(res.outcome).toBe("posted");
      posted.push({ ids: res.entry_ids as string[], legs, reversed: false });
      replay.push(ev);
      for (const l of legs) model[l.acc]! += l.signed;
    }
    const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
    expect(round(await balances())).toEqual(round(model));
    // Bağımsız toplam: açılış + Σgiriş − Σçıkış (iptal edilmemiş hareketler; ayna kayıtlar dahil).
    await sudo();
    const direct = await q(`select a.id::text as id, (a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0))::float8 as b
      from public.finance_accounts a left join public.cash_entries e on e.account_id = a.id and e.voided_at is null
      where a.tenant_id = $1 group by a.id, a.opening_balance`, [T]);
    expect(round(Object.fromEntries(direct.map((r) => [r.id as string, r.b as number])))).toEqual(round(model));
    // Her ayna: asıl iptal edilmemiş, ters yönde, aynı tutar, asıldan önce tarihli değil (açık ay kontrolü ters kayıt anında).
    const bad = await q(`select m.id from public.cash_entries m join public.cash_entries o on o.id = m.reversal_of
      where m.tenant_id = $1 and (o.voided_at is not null or o.direction = m.direction or o.amount <> m.amount or m.entry_date < o.entry_date)`, [T]);
    expect(bad).toEqual([]);
  });

  it("rollback dosyaları sırayla temiz çalışır ve migration'lar yeniden uygulanır", async () => {
    await sudo();
    // Ayna/yeni kaynak satırları varken çekirdek geri alma durur (veri incelenmeden daraltılmaz).
    await db.exec(read("supabase/rollbacks/20261017010100_finance_open_items_v3.rollback.sql"));
    await expect(db.exec(read("supabase/rollbacks/20261017010000_finance_posting_core.rollback.sql"))).rejects.toThrow();
    await db.exec(`delete from public.audit_logs; update public.cash_entries set open_item_id = null;
      delete from public.finance_attachments; delete from public.cash_entries where reversal_of is not null;
      delete from public.cash_entries where posting_key is not null;
      delete from public.finance_open_items where reversal_of is not null; delete from public.finance_open_items where posting_key is not null;`);
    await db.exec(read("supabase/rollbacks/20261017010000_finance_posting_core.rollback.sql"));
    expect((await q(`select to_regprocedure('public.finance_post(jsonb)') as f`))[0]!.f).toBeNull();
    await db.exec(read(CORE));
    await db.exec(read(V3));
    await asOwner();
    expect((await q(`select count(*)::int as n from public.finance_open_items_v`))[0]!.n).toBeGreaterThan(0);
  });
});
