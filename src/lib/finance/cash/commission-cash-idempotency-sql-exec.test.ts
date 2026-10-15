import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { commissionCashAmount, summarizeCommissionEntries, type SourceEntryRow } from "./collection-link";
import { toEventPayload, type PostingEvent } from "../posting/client";
import { commissionCollectionKey, commissionKey, payoutPersonalKey, splitKey } from "../posting/keys";
import { payoutPaidEvent } from "../commission-payouts";

/**
 * İŞLEVSEL SQL TESTİ (pglite; SK6/B180 + B109): "tahsil edildi" işaretleme ↔ kasa hareketi idempotentliği.
 * markCommissionsPaidBulk'ın sorgusu birebir (id ∈ seçim, tenant_id = ofis, status ∉ (paid, collected) → paid, RETURNING) ve
 * ardından finance_record_entry (20261012001400 tavan + mükerrer) KDV dahil tutarla koşar:
 *  - paid/collected bir komisyon ikinci kez işaretlenemez (RETURNING boş) → kasaya ikinci hareket yazılmaz;
 *  - zorla tekrar yazım denense bile RPC hesaptan bağımsız `duplicate` döner; kasada tek hareket kalır;
 *  - kasaya yazılan tutar gross + KDV'dir ve RPC tavanı (gross + vat) onu kabul eder.
 *
 * WP3 (ikinci blok; WP1 kayıt çekirdeği 20261017010000 + açık kalem v3 uygulanmış zincir): collection-link'in kayıt servisi
 * yolu — kısmi tahsilat `commission:{id}:col:{n}` (tekrar = duplicate, sıra kasadan), kilitli aya ters kayıt sonrası net
 * tahsilat ve sıra, stopajlı hakediş ödemesi (`payout.paid`: net çıkış + pay kalemini kapatma + vergi dairesine stopaj borcu;
 * yalnız owner/gm) ve "Kasama işle" (`payout.personal`, kişisel hesap).
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
grant update on public.commissions to authenticated;
`;

describe.skipIf(!mod)("komisyon tahsilatı ↔ kasa idempotentliği (pglite)", () => {
  let db: Db;
  let T: string, T2: string, ME: string, ACC: string, ACC2: string, C1: string, C2: string, X1: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','expenses:view expenses:create expenses:edit commissions:edit',false), set_config('test.role','owner',false)`);
    await db.exec(`set role authenticated`);
  };
  /** markCommissionsPaidBulk: aynı süzgeçlerle güncelle, dönen her satır için KDV dahil kasa hareketi. */
  const markPaid = async (ids: string[], accountId: string) => {
    const rows = await q(
      `update public.commissions set status = 'paid'
        where id = any($1::uuid[]) and tenant_id = $2 and not (status in ('paid', 'collected'))
        returning id, gross_amount, vat_amount`,
      [ids, T],
    );
    const outcomes: string[] = [];
    for (const r of rows) {
      const res = (
        await q(`select public.finance_record_entry($1::uuid, 'in', $2::numeric, '2026-10-05'::date, 'komisyon', 'Komisyon tahsilatı', null, null, null, 'commission', $3::uuid) as r`, [
          accountId,
          commissionCashAmount({ gross_amount: r.gross_amount, vat_amount: r.vat_amount }),
          r.id,
        ])
      )[0]!.r as { outcome: string };
      outcomes.push(res.outcome);
    }
    return { updated: rows.length, outcomes };
  };
  const entries = async (id: string) => {
    await db.exec(`reset role`);
    const rows = await q(`select amount from public.cash_entries where source_type = 'commission' and source_id = $1 and voided_at is null`, [id]);
    await as(ME);
    return rows.map((r) => Number(r.amount));
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ME = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
    await db.exec(read("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
    await as(ME);
    const acc = async (name: string) =>
      ((await q(`select public.finance_account_create('office','bank',$1,null,'TRY',0::numeric,'2026-10-01'::date) as r`, [name]))[0]!.r as { account_id: string })
        .account_id;
    ACC = await acc("Banka");
    ACC2 = await acc("Kasa");
    await db.exec(`reset role`);
    C1 = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 192000, 38400) returning id`, [T]))[0]!.id as string;
    C2 = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status) values ($1, 5000, 1000, 'collected') returning id`, [T]))[0]!
      .id as string;
    X1 = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 7000, 0) returning id`, [T2]))[0]!.id as string;
    await as(ME);
  });

  it("ilk işaretleme: yalnız bekleyen ve bu ofisin kaydı paid olur; kasaya KDV dahil (230.400) yazılır", async () => {
    const res = await markPaid([C1, C2, X1], ACC);
    expect(res).toEqual({ updated: 1, outcomes: ["recorded"] });
    expect(await entries(C1)).toEqual([230400]);
    expect(await entries(C2)).toEqual([]);
    expect(await entries(X1)).toEqual([]);
    await db.exec(`reset role`);
    expect((await q(`select status from public.commissions where id = $1`, [X1]))[0]!.status).toBe("calculated");
    await as(ME);
  });

  it("ikinci işaretleme hiçbir satır döndürmez; kasada tek hareket kalır", async () => {
    expect(await markPaid([C1], ACC)).toEqual({ updated: 0, outcomes: [] });
    expect(await markPaid([C1], ACC2)).toEqual({ updated: 0, outcomes: [] });
    expect(await entries(C1)).toEqual([230400]);
  });

  it("zorla yeniden yazım (Kasaya işle / yeniden dene) başka hesaba da duplicate döner", async () => {
    const r = (
      await q(`select public.finance_record_entry($1::uuid, 'in', 230400::numeric, '2026-10-05'::date, 'komisyon', 'Komisyon tahsilatı', null, null, null, 'commission', $2::uuid) as r`, [
        ACC2,
        C1,
      ])
    )[0]!.r as { outcome: string };
    expect(r.outcome).toBe("duplicate");
    expect(await entries(C1)).toEqual([230400]);
  });

  it("KDV dahil tutar tavanı aşmaz; bir kuruş fazlası reddedilir", async () => {
    await db.exec(`reset role`);
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 1000, 200) returning id`, [T]))[0]!.id as string;
    await as(ME);
    const over = (
      await q(`select public.finance_record_entry($1::uuid, 'in', 1200.01::numeric, '2026-10-05'::date, 'komisyon', 'x', null, null, null, 'commission', $2::uuid) as r`, [ACC, c])
    )[0]!.r as { reason?: string };
    expect(over.reason).toBe("amount_exceeds_source");
    expect(await markPaid([c], ACC)).toEqual({ updated: 1, outcomes: ["recorded"] });
    expect(await entries(c)).toEqual([1200]);
  });
});

const STUB_V3 = `
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

const FINANCE_STUBS_V3 = `
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

const CHAIN_V3 = [
  "supabase/migrations/20261014001000_finance_ledger_v2.sql",
  "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql",
  "supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql",
  "supabase/migrations/20261014011000_finance_party_advisor_scope.sql",
  "supabase/migrations/20261016060100_finance_pnl_vat_fix.sql",
];
const CORE_V3 = "supabase/migrations/20261017010000_finance_posting_core.sql";
const OPEN_ITEMS_V3 = "supabase/migrations/20261017010100_finance_open_items_v3.sql";

const OWNER_PERMS_V3 =
  "expenses:view expenses:create expenses:edit expenses:delete commissions:view commissions:edit earnings_all:view rentals:view rentals:edit rentals:delete";

type Json = Record<string, unknown>;

describe.skipIf(!mod)("WP3: komisyon tahsilatı ve hakediş ödemesi kayıt servisiyle (pglite, 20261017010000/010100)", () => {
  let db: Db;
  let T: string, OWNER: string, ADVISOR: string, BANKA: string, CUSTOMER: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const as = async (uid: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const asOwner = () => as(OWNER, OWNER_PERMS_V3, "owner");
  const sudo = async () => db.exec(`reset role`);
  const post = async (e: PostingEvent) => one<Json>(`public.finance_post($1::jsonb)`, [JSON.stringify(toEventPayload(e))]);
  /** collection-link'in okuduğu satırlar (kaynak hareketleri) → net tahsilat + sıradaki sıra. */
  const state = async (commissionId: string) => {
    await sudo();
    const rows = (await q(
      `select id::text, direction, amount::float8 as amount, posting_key, voided_at::text, reversal_of::text
         from public.cash_entries where source_type = 'commission' and source_id = $1`,
      [commissionId],
    )) as SourceEntryRow[];
    return summarizeCommissionEntries(rows);
  };
  const item = async (id: string) => {
    await sudo();
    return (await q(`select status, paid_amount::float8 as paid, amount::float8 as amount from public.finance_open_items where id = $1`, [id]))[0];
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB_V3);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ofis Sahibi') returning id`, [T]))[0]!.id as string;
    ADVISOR = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Deniz Danışman') returning id`, [T]))[0]!.id as string;
    CUSTOMER = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Ayşe Yılmaz') returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
    await db.exec(read("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
    await db.exec(read("supabase/migrations/20261012002900_finance_owner_payout_source.sql"));
    await db.exec(FINANCE_STUBS_V3);
    for (const f of CHAIN_V3) await db.exec(read(f));
    await db.exec(read(CORE_V3));
    await db.exec(read(OPEN_ITEMS_V3));
    await asOwner();
    BANKA = (await one<Json>(`public.finance_account_create('office','bank','Banka',null,'TRY',10000::numeric,'2026-07-01'::date)`)).account_id as string;
    await sudo();
  }, 180_000);

  it("kısmi tahsilat: sıra kasadan, tekrar duplicate, alacak kalemi kısmi → kapalı; kalanı aşan tahsilat reddedilir", async () => {
    await sudo();
    const deal = (await q(`insert into public.deals(tenant_id, customer_id) values ($1, $2) returning id`, [T, CUSTOMER]))[0]!.id as string;
    const c = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, vat_amount, created_at) values ($1, $2, 10000, 2000, '2026-09-05T10:00:00+03') returning id`, [T, deal]))[0]!.id as string;
    const total = commissionCashAmount({ gross_amount: 10000, vat_amount: 2000 });
    expect(total).toBe(12000);
    await asOwner();
    // WP2 tahakkuku yerine: alacak kalemi `commission:{id}` (brüt + KDV).
    const acc = await post({ eventType: "commission.accrued", postingKey: commissionKey(c), date: "2026-09-05", sourceId: c, partyName: "Ayşe Yılmaz", item: { amount: total, vatAmount: 2000 } });
    const itemId = acc.open_item_id as string;

    expect(await state(c)).toEqual({ collected: 0, nextSeq: 1 });
    await asOwner();
    const col1: PostingEvent = { eventType: "commission.collected", postingKey: commissionCollectionKey(c, 1), date: "2026-09-10", sourceId: c,
      entries: [{ accountId: BANKA, amount: 5000, settles: itemId }] };
    expect((await post(col1)).outcome).toBe("posted");
    // Çift tıklama / yeniden dene: aynı sıra → duplicate, tek hareket.
    expect((await post(col1)).outcome).toBe("duplicate");
    expect(await state(c)).toEqual({ collected: 5000, nextSeq: 2 });
    expect(await item(itemId)).toMatchObject({ status: "partial", paid: 5000 });

    await asOwner();
    // Kalanı aşan tutar (7.000,01) reddedilir; tam kalan (7.000) kalemi kapatır.
    expect((await post({ ...col1, postingKey: commissionCollectionKey(c, 2), entries: [{ accountId: BANKA, amount: 7000.01, settles: itemId }] })).outcome)
      .toBe("amount_exceeds_open");
    expect((await post({ ...col1, postingKey: commissionCollectionKey(c, 2), date: "2026-10-02", entries: [{ accountId: BANKA, amount: 7000, settles: itemId }] })).outcome)
      .toBe("posted");
    expect(await state(c)).toEqual({ collected: 12000, nextSeq: 3 });
    expect(await item(itemId)).toMatchObject({ status: "paid", paid: 12000 });

    // Tahsilatı geri al (finance_reverse): Eylül kilitliyken ilk tahsilat Ekim'de aynayla, ikincisi açık ayda iptalle geri alınır.
    await asOwner();
    await one(`public.finance_period_lock('2026-09-01'::date, 'Eylül kapandı')`);
    await sudo();
    const live = await q(`select id::text from public.cash_entries where source_type = 'commission' and source_id = $1 and voided_at is null order by posting_key`, [c]);
    await asOwner();
    const outcomes: string[] = [];
    for (const e of live) outcomes.push((await one<Json>(`public.finance_reverse($1::uuid, 'Tahsilat geri alındı', null)`, [e.id])).outcome as string);
    expect(outcomes).toEqual(["mirrored", "voided"]);
    // Net tahsilat sıfır; anahtarlar bir kez kullanılır → sıradaki tahsilat 3; alacak kalemi yeniden açık.
    expect(await state(c)).toEqual({ collected: 0, nextSeq: 3 });
    expect(await item(itemId)).toMatchObject({ status: "open", paid: 0 });
    await sudo();
    expect(Number((await q(`select count(*) from public.cash_entries where source_id = $1 and kind = 'adjust' and entry_date = '2026-10-01'`, [c]))[0]!.count)).toBe(1);
  });

  it("hakediş ödemesi: net çıkış + pay kalemini kapatır + stopaj vergi dairesine borç; tekrar duplicate; yalnız owner/gm", async () => {
    await sudo();
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status) values ($1, 2000, 0, 'paid') returning id`, [T]))[0]!.id as string;
    const s = (await q(`insert into public.commission_splits(tenant_id, commission_id, kind, amount) values ($1, $2, 'advisor', 1000) returning id`, [T, c]))[0]!.id as string;
    const pay = (await q(`insert into public.commission_payouts(tenant_id, commission_id, split_id, profile_id, amount, status, approved_at) values ($1, $2, $3, $4, 1000, 'approved', now()) returning id`, [T, c, s, ADVISOR]))[0]!.id as string;
    await asOwner();
    // WP2 tahakkuku yerine: danışman pay kalemi `split:{id}`.
    const splitItem = (await post({ eventType: "commission.split_accrued", postingKey: splitKey(s), date: "2026-10-01", sourceId: s, item: { amount: 1000 } })).open_item_id as string;
    const today = (await one<string>(`((now() at time zone 'Europe/Istanbul')::date)::text`));
    const { event, net, withheld } = payoutPaidEvent({
      payoutId: pay, accountId: BANKA, amount: 1000, withholdingRate: 20, date: today, advisorName: "Deniz Danışman", splitItemId: splitItem,
    });
    expect([net, withheld]).toEqual([800, 200]);

    // Muhasebe (commissions:edit olsa da) ödeyemez: owner_gm_only.
    await as(OWNER, OWNER_PERMS_V3, "accounting");
    expect((await post(event)).outcome).toBe("forbidden");
    await asOwner();
    const r = await post(event);
    expect(r.outcome).toBe("posted");
    expect((await post(event)).outcome).toBe("duplicate");

    await sudo();
    const entry = (await q(`select direction, kind, amount::float8 as a, withholding_amount::float8 as w, category, open_item_id::text as oi, posting_key
                              from public.cash_entries where id = $1`, [(r.entry_ids as string[])[0]]))[0];
    expect(entry).toEqual({ direction: "out", kind: "expense", a: 800, w: 200, category: "danisman_hakedis", oi: splitItem, posting_key: `payout:${pay}` });
    // Pay kalemi: net + stopaj = brüt ile kapandı.
    expect(await item(splitItem)).toMatchObject({ status: "paid", paid: 1000 });
    // Stopaj: vergi dairesine borç açık kalemi (muhtasar günü vadeli).
    await sudo();
    const st = (await q(`select direction, category, amount::float8 as a, status, due_date::text as due, source_type, source_id::text as src
                           from public.finance_open_items where id = $1`, [r.open_item_id]))[0]!;
    expect(st).toMatchObject({ direction: "payable", category: "stopaj", a: 200, status: "open", source_type: "commission_payout", src: pay });
    expect(st.due).toBe(event.item!.dueDate);
    // Banka bakiyesi net kadar düşer.
    expect(Number((await q(`select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) as s from public.cash_entries
                             where account_id = $1 and voided_at is null and posting_key = $2`, [BANKA, `payout:${pay}`]))[0]!.s)).toBe(-800);
  });

  it("Kasama işle: danışmanın kişisel hesabına payout.personal; ofis hesabına yazılamaz; tekrar duplicate", async () => {
    await sudo();
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status) values ($1, 1000, 0, 'paid') returning id`, [T]))[0]!.id as string;
    const pay = (await q(`insert into public.commission_payouts(tenant_id, commission_id, profile_id, amount, status, approved_at) values ($1, $2, $3, 600, 'paid', now()) returning id`, [T, c, ADVISOR]))[0]!.id as string;
    await as(ADVISOR, "commissions:view", "agent");
    const kasam = (await one<Json>(`public.finance_account_create('user','cash','Cüzdanım',null,'TRY',0::numeric,'2026-07-01'::date)`)).account_id as string;
    const ev: PostingEvent = { eventType: "payout.personal", postingKey: payoutPersonalKey(pay), date: "2026-10-05", sourceId: pay,
      entries: [{ accountId: kasam, amount: 480, title: "Hakediş (ofisten)" }] };
    expect((await post({ ...ev, entries: [{ accountId: BANKA, amount: 480 }] })).outcome).toBe("invalid_input");
    const r = await post(ev);
    expect(r.outcome).toBe("posted");
    expect((await post(ev)).outcome).toBe("duplicate");
    await sudo();
    expect((await q(`select direction, category, amount::float8 as a, account_id::text as acc from public.cash_entries where id = $1`, [(r.entry_ids as string[])[0]]))[0])
      .toEqual({ direction: "in", category: "danisman_hakedis", a: 480, acc: kasam });
  });
});
