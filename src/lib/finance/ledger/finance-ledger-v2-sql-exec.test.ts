import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { entryAmounts, splitVat } from "./vat";

/**
 * İŞLEVSEL SQL TESTİ (pglite): Finans v2 (FN1) — 20261014001000 (şema) + 001100 (RPC) + 001200 (veri taşıma).
 * Gerçek finans zinciri (000600, 001100, 001400, 002900) üzerine kurulur; mülk yönetimi / komisyon tabloları sade taslaktır.
 * Kabul: taşıma sonrası hareket sayısı ve bakiyeler birebir aynı, defter görünümü = hareket + bağlanmamış eski gider,
 * karşı taraf → cari, bütçe kopyası, muhasebe izni; v2 kayıt (KDV/stopaj vat.ts ile aynı), ay kilidi (DONEM_KILITLI),
 * kilit açma yalnız owner/gm, açık kalem kısmi/tam kapama, kâr/zarar elle gelir + çift sayım yok, ofis izolasyonu, rollback.
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
alter table public.expenses enable row level security;
create policy expenses_tenant on public.expenses for select to authenticated using (tenant_id = public.current_active_tenant_id());
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

// recurring_rules / occurrences / ekstre satırları: v2'nin okuduğu kolonlarla sade taslak (gerçek tanım 000900 / 001200).
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

const V2 = [
  "supabase/migrations/20261014001000_finance_ledger_v2.sql",
  "supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql",
  "supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql",
];

describe.skipIf(!mod)("finans v2 defter / cari / vade / kilit (pglite)", () => {
  let db: Db;
  let T: string, T2: string, OWNER: string, ACC: string, OTHER: string;
  let KASA: string, BANKA: string, OTHER_ACC: string;
  let balancesBefore: Record<string, number>;
  let entriesBefore: number;
  let legacyIds: string[];

  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const FULL = "expenses:view expenses:create expenses:edit expenses:delete commissions:view commissions:edit rentals:view rentals:edit rentals:delete";
  const ACCOUNTING = "expenses:view expenses:create expenses:edit";
  const asOwner = () => as(OWNER, T, FULL, "owner");
  const asAccountant = () => as(ACC, T, ACCOUNTING, "accounting");
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const fails = async (sql: string, params: unknown[] = []) => {
    try {
      await q(sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    return null;
  };
  const balances = async () => {
    const rows = await q(`select account_id::text as id, balance::float8 as b from public.finance_account_balances()`);
    return Object.fromEntries(rows.map((r) => [String(r.id), Number(r.b)]));
  };
  const recordV1 = (acc: string, dir: string, amount: number, date: string, cat: string, title: string, counterparty: string | null, src = "manual", srcId: string | null = null) =>
    one<Record<string, unknown>>(`public.finance_record_entry($1::uuid, $2, $3::numeric, $4::date, $5, $6, $7, null, null, $8, $9::uuid)`,
      [acc, dir, amount, date, cat, title, counterparty, src, srcId]);
  const v2 = (p: Record<string, unknown>) => one<string>(`public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify(p)]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ACC = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    OTHER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
    await db.exec(read("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
    await db.exec(read("supabase/migrations/20261012002900_finance_owner_payout_source.sql"));
    await db.exec(FINANCE_STUBS);

    // --- Taşıma ÖNCESİ canlıya benzer veri: hesaplar, karşı taraflı hareketler, eski giderler, bütçe ---
    await asOwner();
    KASA = (await one<Record<string, string>>(`public.finance_account_create('office','cash','Kasa',null,'TRY',1000::numeric,'2026-08-01'::date)`)).account_id!;
    BANKA = (await one<Record<string, string>>(`public.finance_account_create('office','bank','Banka',null,'TRY',50000::numeric,'2026-08-01'::date)`)).account_id!;
    await db.exec(`reset role`);
    const comm = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status, created_at) values ($1, 20000, 4000, 'paid', '2026-09-10') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.commission_splits(tenant_id, commission_id, kind, amount) values ($1, $2, 'advisor', 6000), ($1, $2, 'office', 10000)`, [T, comm]);
    const rent = (await q(`insert into public.rent_payments(tenant_id, amount, paid_on) values ($1, 15000, '2026-09-03') returning id`, [T]))[0]!.id as string;
    await asOwner();
    await recordV1(BANKA, "in", 24000, "2026-09-12", "komisyon", "Komisyon tahsilatı", "Ayşe Yılmaz", "commission", comm);
    await recordV1(BANKA, "in", 15000, "2026-09-03", "kira_tahsilat", "Kira", "Mehmet Kiracı", "rent", rent);
    await recordV1(KASA, "out", 4500, "2026-09-05", "portal", "Portal üyeliği", "Sahibinden");
    await recordV1(KASA, "out", 1500, "2026-09-20", "portal", "Portal ek paket", "  sahibinden ");
    await recordV1(KASA, "in", 3000, "2026-09-07", "hizmet_bedeli", "Ekspertiz hizmeti", "Demir Ltd");
    await recordV1(KASA, "in", 750, "2026-09-08", "diger_gelir", "Fotokopi", null);
    // Gider kaydı bağlı hareket (create_expense) → eski gider defterde ikinci kez görünmez.
    await one(`public.finance_record_entry($1::uuid, 'out', 900::numeric, '2026-09-09'::date, 'ofis', 'Kırtasiye', 'Kırtasiyeci', null, null, 'manual', null, true, 'ofis')`, [KASA]);
    await db.exec(`reset role`);
    legacyIds = (await q(`insert into public.expenses(tenant_id, category, title, amount, expense_date) values
      ($1, 'reklam', 'Afiş', 1200, '2026-09-02'), ($1, 'ofis', 'Temizlik', 800, '2026-09-15'), ($1, 'diger', 'Noter', 350, '2026-09-16') returning id`, [T]))
      .map((r) => r.id as string);
    await q(`insert into public.expense_budgets(tenant_id, category, monthly_amount) values ($1, 'reklam', 5000), ($1, 'ofis', 2000)`, [T]);

    // Başka ofis
    await as(OTHER, T2, FULL, "owner");
    OTHER_ACC = (await one<Record<string, string>>(`public.finance_account_create('office','cash','Diğer kasa',null,'TRY',0::numeric,'2026-08-01'::date)`)).account_id!;
    await recordV1(OTHER_ACC, "out", 100, "2026-09-05", "ofis", "Çay", "Sahibinden");

    await asOwner();
    balancesBefore = await balances();
    await db.exec(`reset role`);
    entriesBefore = Number((await q(`select count(*)::int as n from public.cash_entries`))[0]!.n);

    for (const f of V2) await db.exec(read(f));
  }, 180_000);

  it("taşıma: hareket sayısı ve her hesabın bakiyesi birebir aynı; parasal kolon değişmedi", async () => {
    expect(Number((await q(`select count(*)::int as n from public.cash_entries`))[0]!.n)).toBe(entriesBefore);
    await asOwner();
    expect(await balances()).toEqual(balancesBefore);
    await db.exec(`reset role`);
    expect((await q(`select count(*)::int as n from public.cash_entries where vat_rate is not null or vat_amount is not null or vat_included is not null`))[0]!.n).toBe(0);
  });

  it("taşıma: boş olmayan her karşı tarafın party_id'si dolu; ad büyük/küçük harf duyarsız tek cari; tür tahmini", async () => {
    expect((await q(`select count(*)::int as n from public.cash_entries where nullif(btrim(counterparty), '') is not null and party_id is null`))[0]!.n).toBe(0);
    const parties = await q(`select name, kind from public.finance_parties where tenant_id = $1 order by name`, [T]);
    expect(parties).toEqual([
      { name: "Ayşe Yılmaz", kind: "musteri" },
      { name: "Demir Ltd", kind: "diger" },
      { name: "Kırtasiyeci", kind: "tedarikci" },
      { name: "Mehmet Kiracı", kind: "kiraci" },
      { name: "Sahibinden", kind: "tedarikci" },
    ]);
    // Diğer ofisin aynı adlı karşı tarafı kendi ofisinde ayrı cari olur.
    expect((await q(`select count(*)::int as n from public.finance_parties where tenant_id = $1`, [T2]))[0]!.n).toBe(1);
    // İdempotent: ikinci çalıştırma yeni cari açmaz.
    await db.exec(read(V2[2]!));
    expect((await q(`select count(*)::int as n from public.finance_parties`))[0]!.n).toBe(6);
  });

  it("taşıma: defter görünümü = hareketler + bağlanmamış eski giderler (Hesapsız); bütçe ve muhasebe izni", async () => {
    const rows = await q(`select origin, count(*)::int as n from public.finance_ledger_v where tenant_id = $1 group by origin order by origin`, [T]);
    expect(rows).toEqual([{ origin: "entry", n: 7 }, { origin: "legacy_expense", n: 3 }]);
    expect((await q(`select count(*)::int as n from public.finance_ledger_v where origin = 'legacy_expense' and account_id is not null`))[0]!.n).toBe(0);
    expect(await q(`select period_month::text as m, direction, category, amount::float8 as a from public.finance_budgets where tenant_id = $1 order by category`, [T]))
      .toEqual([{ m: "2000-01-01", direction: "out", category: "ofis", a: 2000 }, { m: "2000-01-01", direction: "out", category: "reklam", a: 5000 }]);
    expect(await q(`select action from public.permission_defaults where role = 'accounting' and module = 'expenses' order by action`))
      .toEqual([{ action: "create" }, { action: "edit" }]);
  });

  it("KDV hesabı DB ile vat.ts birebir aynı (%1 / %10 / %20; dahil ve hariç; stopaj)", async () => {
    const amounts = [0.01, 0.03, 0.05, 1, 9.99, 117.35, 333.33, 1234.56, 4321.07, 99999.99];
    for (const rate of [1, 10, 20]) {
      for (const included of [true, false]) {
        for (const amount of amounts) {
          const r = (await q(`select net::float8 as net, vat::float8 as vat, gross::float8 as gross from public.finance_vat_split($1::numeric, $2::numeric, $3)`, [amount, rate, included]))[0]!;
          expect({ net: r.net, vat: r.vat, gross: r.gross }).toEqual(splitVat(amount, rate, included));
          const e = (await q(`select net::float8 as net, vat::float8 as vat, gross::float8 as gross, withheld::float8 as withheld, cash::float8 as cash
                                from public.finance_entry_amounts($1::numeric, $2::numeric, $3, 20::numeric)`, [amount, rate, included]))[0]!;
          expect(e).toEqual(entryAmounts(amount, rate, included, 20));
        }
      }
    }
  });

  it("muhasebe rolü v2 kayıt yapar (KDV/stopaj, cari adı ile yeni cari), silemez (iptal yok)", async () => {
    await asAccountant();
    const id = await v2({ account_id: KASA, direction: "out", amount: 10000, entry_date: "2026-10-02", category: "kira", title: "Ofis kirası",
      party_name: "Ev Sahibi Ali", party_kind: "malik", vat_rate: 20, vat_included: false, withholding_rate: 20 });
    await db.exec(`reset role`);
    const e = (await q(`select amount::float8 as amount, vat_amount::float8 as vat, withholding_amount::float8 as wh, vat_included, party_id from public.cash_entries where id = $1`, [id]))[0]!;
    expect(e).toMatchObject({ amount: 10000, vat: 2000, wh: 2000, vat_included: false });
    expect((await q(`select kind from public.finance_parties where id = $1`, [e.party_id]))[0]!.kind).toBe("malik");
    await asAccountant();
    const voidRes = await one<Record<string, unknown>>(`public.finance_void_entry($1::uuid, 'yanlış kayıt')`, [id]);
    expect(voidRes.outcome).toBe("forbidden");
    expect(await fails(`select public.finance_open_item_cancel(gen_random_uuid(), 'deneme')`)).toBe("FN:forbidden");
    // Güncelleme: tutar değişir, cari bağı korunur.
    await q(`select public.finance_update_entry_v2($1::uuid, $2::jsonb)`, [id, JSON.stringify({ amount: 12000, vat_rate: 20, vat_included: true, withholding_rate: null })]);
    await db.exec(`reset role`);
    expect((await q(`select amount::float8 as a, vat_amount::float8 as v, withholding_amount from public.cash_entries where id = $1`, [id]))[0]).toEqual({ a: 12000, v: 2000, withholding_amount: null });
  });

  it("ay kilidi: kilitli aya ekleme, düzenleme ve iptal DONEM_KILITLI; parasal olmayan alan serbest; kilidi yalnız owner/gm açar", async () => {
    await asAccountant();
    await q(`select public.finance_period_lock('2026-09-15'::date, 'Eylül kapandı')`);
    expect(await fails(`select public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: KASA, direction: "out", amount: 10, entry_date: "2026-09-30", title: "Geç gider" })]))
      .toBe("DONEM_KILITLI");
    await db.exec(`reset role`);
    const sept = (await q(`select id from public.cash_entries where tenant_id = $1 and entry_date = '2026-09-07'`, [T]))[0]!.id as string;
    await asOwner();
    expect(await fails(`select public.finance_update_entry_v2($1::uuid, '{"amount": 3100}'::jsonb)`, [sept])).toBe("DONEM_KILITLI");
    expect(await fails(`select public.finance_void_entry($1::uuid, 'iptal denemesi')`, [sept])).toBe("DONEM_KILITLI");
    // Eylül'e tarih taşıma da kilitli
    await db.exec(`reset role`);
    const oct = (await q(`select id from public.cash_entries where tenant_id = $1 and entry_date = '2026-10-02'`, [T]))[0]!.id as string;
    await asOwner();
    expect(await fails(`select public.finance_update_entry_v2($1::uuid, '{"entry_date": "2026-09-29"}'::jsonb)`, [oct])).toBe("DONEM_KILITLI");
    // Cari bağı / mutabakat işareti kilitli ayda da değişebilir
    await q(`select public.finance_update_entry_v2($1::uuid, '{"party_name": "Demir Ltd"}'::jsonb)`, [sept]);
    await db.exec(`reset role`);
    await q(`update public.cash_entries set reconciled_at = now() where id = $1`, [sept]);
    // Kilit açma: muhasebe rolü açamaz, owner açar
    await asAccountant();
    expect(await fails(`select public.finance_period_unlock('2026-09-01'::date)`)).toBe("FN:forbidden");
    await as(OWNER, T, FULL, "gm");
    await q(`select public.finance_period_unlock('2026-09-01'::date)`);
    expect(await fails(`select public.finance_update_entry_v2($1::uuid, '{"title": "Ekspertiz hizmeti (düzeltildi)"}'::jsonb)`, [sept])).toBeNull();
  });

  it("açık kalem: kısmi tahsilat 'partial', tam tahsilat 'paid'; bağlı hareket yazılır; iptalde kalem geri açılır", async () => {
    await asAccountant();
    const item = await one<string>(`public.finance_open_item_create($1::jsonb)`, [JSON.stringify({
      direction: "receivable", party_name: "Demir Ltd", title: "Ekspertiz faturası", category: "hizmet_bedeli", amount: 6000,
      vat_rate: 20, issue_date: "2026-10-01", due_date: "2026-10-31" })]);
    const e1 = await one<string>(`public.finance_open_item_settle($1::uuid, $2::uuid, 2500::numeric, '2026-10-03'::date, null)`, [item, BANKA]);
    await db.exec(`reset role`);
    expect((await q(`select status, paid_amount::float8 as p, vat_amount::float8 as v from public.finance_open_items where id = $1`, [item]))[0]).toEqual({ status: "partial", p: 2500, v: 1000 });
    expect((await q(`select open_item_id, direction, amount::float8 as a from public.cash_entries where id = $1`, [e1]))[0]).toEqual({ open_item_id: item, direction: "in", a: 2500 });
    await asAccountant();
    expect(await fails(`select public.finance_open_item_settle($1::uuid, $2::uuid, 4000::numeric, '2026-10-04'::date, null)`, [item, BANKA])).toBe("FN:amount_exceeds_open");
    const e2 = await one<string>(`public.finance_open_item_settle($1::uuid, $2::uuid, null, '2026-10-04'::date, 'kalan')`, [item, BANKA]);
    await db.exec(`reset role`);
    expect((await q(`select status, paid_amount::float8 as p from public.finance_open_items where id = $1`, [item]))[0]).toEqual({ status: "paid", p: 6000 });
    expect((await q(`select amount::float8 as a from public.cash_entries where id = $1`, [e2]))[0]!.a).toBe(3500);
    // Cari: bakiye 0, ekstre alacak + iki tahsilat
    await asAccountant();
    const party = (await q(`select party_id from public.finance_open_items where id = $1`, [item]))[0]!.party_id as string;
    const bal = (await q(`select receivable_open::float8 as r, balance::float8 as b from public.finance_party_balances(null, 'demir')`))[0]!;
    expect(bal).toEqual({ r: 0, b: 0 });
    const st = await q(`select doc_type, debit::float8 as d, credit::float8 as c, running_balance::float8 as rb from public.finance_party_statement($1::uuid, '2026-10-01'::date, null)`, [party]);
    expect(st.map((r) => r.doc_type)).toEqual(["devir", "alacak", "tahsilat", "tahsilat"]);
    expect(st.at(-1)!.rb).toBe(0);
    // Hareket iptali (owner) kalemi yeniden 'partial' yapar.
    await asOwner();
    await one(`public.finance_void_entry($1::uuid, 'banka iade etti')`, [e2]);
    await db.exec(`reset role`);
    expect((await q(`select status, paid_amount::float8 as p from public.finance_open_items where id = $1`, [item]))[0]).toEqual({ status: "partial", p: 2500 });
    // Yaşlandırma + görünüm
    await asAccountant();
    const aging = await q(`select bucket, cnt, amount::float8 as a from public.finance_aging('receivable')`);
    expect(aging.map((r) => r.bucket)).toEqual(["vadesi_gelmedi", "0-30", "31-60", "61-90", "90+"]);
    expect(aging.reduce((s, r) => s + Number(r.a), 0)).toBeGreaterThanOrEqual(3500);
  });

  it("stopajlı borç: son ödeme stopajı taşır, kalem 'paid' olur", async () => {
    await asOwner();
    const item = await one<string>(`public.finance_open_item_create($1::jsonb)`, [JSON.stringify({
      direction: "payable", party_name: "Ev Sahibi Ali", title: "Kasım kirası", category: "kira", amount: 10000, withholding_rate: 20,
      issue_date: "2026-10-01", due_date: "2026-10-05" })]);
    const e = await one<string>(`public.finance_open_item_settle($1::uuid, $2::uuid, null, '2026-10-05'::date, null)`, [item, BANKA]);
    await db.exec(`reset role`);
    expect((await q(`select amount::float8 as a, withholding_amount::float8 as w from public.cash_entries where id = $1`, [e]))[0]).toEqual({ a: 8000, w: 2000 });
    expect((await q(`select status from public.finance_open_items where id = $1`, [item]))[0]!.status).toBe("paid");
  });

  it("kâr/zarar: elle girilen hizmet_bedeli ve diger_gelir sayılır; komisyon/kira kaynaklı hareket çift sayılmaz", async () => {
    await asOwner();
    const rows = await q(`select month::text as m, income::float8 as i, expense::float8 as e, income_by_category as ic, expense_by_category as ec
                            from public.finance_pnl('2026-09-01'::date, '2026-09-30'::date)`);
    expect(rows).toHaveLength(1);
    const ic = rows[0]!.ic as Record<string, number>;
    // komisyon: 20000 - 4000 KDV - 6000 danışman payı = 10000 (tahsilat hareketi 24000 ayrıca sayılmaz)
    expect(ic).toEqual({ komisyon: 10000, hizmet_bedeli: 3000, diger_gelir: 750 });
    expect(rows[0]!.i).toBe(13750);
    const ec = rows[0]!.ec as Record<string, number>;
    // Giderler: portal hareketleri (gider kaydı yok) 6000 + kırtasiye gider kaydı 900 (hareketi bir daha sayılmaz) + eski giderler
    expect(ec.portal).toBe(6000);
    expect(ec.ofis).toBe(900 + 800);
    expect(ec.reklam).toBe(1200);
    expect(rows[0]!.e).toBe(6000 + 900 + 1200 + 800 + 350);
  });

  it("create_expense: gider kaydı belge tutarını taşır (stopaj dahil, KDV hariç); kâr/zarar giriş yolundan bağımsız", async () => {
    await asOwner();
    // %20 stopajlı 10.000 TL ofis kirası, gider kaydıyla: nakit 8000, gider 10000
    const rent = await v2({ account_id: KASA, direction: "out", amount: 10000, entry_date: "2026-08-20", category: "kira", title: "Ağustos kirası",
      withholding_rate: 20, create_expense: true, expense_category: "ofis" });
    // KDV dahil 1200 TL reklam, gider kaydıyla: gider 1000 (KDV hariç)
    const ad = await v2({ account_id: KASA, direction: "out", amount: 1200, entry_date: "2026-08-21", category: "reklam", title: "Afiş baskı",
      vat_rate: 20, vat_included: true, create_expense: true, expense_category: "reklam" });
    // Aynı reklam gider kaydı OLMADAN: kâr/zarar yine 1000
    await v2({ account_id: KASA, direction: "out", amount: 1200, entry_date: "2026-08-22", category: "reklam", title: "Afiş baskı 2", vat_rate: 20, vat_included: true });
    await db.exec(`reset role`);
    const exp = async (entry: string) =>
      (await q(`select x.amount::float8 as a, e.amount::float8 as cash from public.cash_entries e join public.expenses x on x.id = e.expense_id where e.id = $1`, [entry]))[0];
    expect(await exp(rent)).toEqual({ a: 10000, cash: 8000 });
    expect(await exp(ad)).toEqual({ a: 1000, cash: 1200 });
    await asOwner();
    const pnl = (await q(`select expense::float8 as e, expense_by_category as ec from public.finance_pnl('2026-08-01'::date, '2026-08-31'::date)`))[0]!;
    expect(pnl.ec).toEqual({ ofis: 10000, reklam: 2000 });
    expect(pnl.e).toBe(12000);
    // Güncelleme: KDV eklenince (belge 10000 KDV dahil, %20 stopaj) gider kaydı yeni neti izler
    await q(`select public.finance_update_entry_v2($1::uuid, $2::jsonb)`, [rent, JSON.stringify({ amount: 10000, vat_rate: 20, vat_included: true, withholding_rate: 20 })]);
    await db.exec(`reset role`);
    const want = entryAmounts(10000, 20, true, 20);
    expect(await exp(rent)).toEqual({ a: want.net, cash: want.cash });
  });

  it("ay kilidi yalnız ofis hesaplarına uygulanır; ofis kalemi ve eki kişisel hesaba bağlanamaz", async () => {
    await asOwner();
    const mine = (await one<Record<string, string>>(`public.finance_account_create('user','cash','Cebim',null,'TRY',0::numeric,'2026-08-01'::date)`)).account_id!;
    await q(`select public.finance_period_lock('2026-08-01'::date, 'Ağustos kapandı')`);
    // Kişisel hesap kilitli ayda kayıt yapar, düzenler, iptal eder
    const rec = await recordV1(mine, "out", 250, "2026-08-25", "ulasim", "Taksi", null);
    expect(rec.outcome).toBe("recorded");
    const upd = await one<Record<string, unknown>>(`public.finance_update_entry($1::uuid, 300::numeric, '2026-08-26'::date, 'ulasim', 'Taksi', null, null, null, null)`, [rec.entry_id]);
    expect(upd.outcome).toBe("updated");
    expect((await one<Record<string, unknown>>(`public.finance_void_entry($1::uuid, 'yanlış kayıt')`, [rec.entry_id])).outcome).toBe("voided");
    // Ofis hesabı aynı ayda kilitli
    expect(await fails(`select public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: KASA, direction: "out", amount: 10, entry_date: "2026-08-25", title: "Geç gider" })]))
      .toBe("DONEM_KILITLI");
    await q(`select public.finance_period_unlock('2026-08-01'::date)`);
    // Ofis alacak kalemi kişisel hesaba tahsil edilemez (v2 ve settle)
    const item = await one<string>(`public.finance_open_item_create($1::jsonb)`, [JSON.stringify({
      direction: "receivable", party_name: "Demir Ltd", title: "Danışmanlık", category: "hizmet_bedeli", amount: 1000, issue_date: "2026-10-01", due_date: "2026-10-30" })]);
    expect(await fails(`select public.finance_open_item_settle($1::uuid, $2::uuid, null, '2026-10-05'::date, null)`, [item, mine])).toBe("FN:invalid_input");
    expect(await fails(`select public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: mine, direction: "in", amount: 1000, entry_date: "2026-10-05", title: "Tahsilat", open_item_id: item })]))
      .toBe("FN:invalid_input");
    await db.exec(`reset role`);
    expect((await q(`select status, paid_amount::float8 as p from public.finance_open_items where id = $1`, [item]))[0]).toEqual({ status: "open", p: 0 });
    // Ek kişisel hesap hareketine bağlanamaz
    await asOwner();
    const own = await recordV1(mine, "out", 40, "2026-10-05", "ulasim", "Otopark", null);
    const att = await one<string>(`public.finance_attachment_register($1, 'fis.jpg', 'image/jpeg', 1000::bigint, null, null)`, [`${T}/ledger/fis.jpg`]);
    expect(await fails(`select public.finance_attachment_link($1::uuid, $2::uuid, null)`, [att, own.entry_id])).toBe("FN:invalid_input");
    expect(await fails(`select public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: mine, direction: "out", amount: 5, entry_date: "2026-10-05", title: "Çay", attachment_ids: [att] })]))
      .toBe("FN:invalid_input");
  });

  it("KDV özeti, genel bakış, tahmin, bütçe ve kural önerisi çalışır", async () => {
    await asOwner();
    const vat = await q(`select month::text as m, output_vat::float8 as o, input_vat::float8 as i, withholding_paid::float8 as wp from public.finance_vat_summary('2026-09-01'::date, '2026-10-31'::date)`);
    expect(vat).toHaveLength(2);
    expect(vat[0]).toMatchObject({ m: "2026-09-01", o: 4000 }); // komisyon KDV'si
    expect(vat[1]).toMatchObject({ m: "2026-10-01", i: 2000, wp: 2000 });
    const ov = await one<Record<string, unknown>>(`public.finance_overview('2026-09-01'::date, '2026-09-30'::date, '{"USD": 41.2}'::jsonb)`);
    expect(ov).toMatchObject({ legacy_unadopted_count: 3, in_total: 42750 });
    const bal = await balances();
    expect(Number(ov.cash_total_try)).toBe(bal[KASA]! + bal[BANKA]!); // yalnız ofis hesapları (kişisel 'Cebim' hariç)
    const fc = await q(`select is_actual, balance::float8 as b from public.finance_cashflow_forecast(30, null)`);
    expect(fc.filter((r) => r.is_actual === false)).toHaveLength(31);
    // Hareket kategorisi 'kira' gider kategorisi 'ofis'e eşlenir (eski gider bütçesiyle aynı satır); taban KDV hariç net + stopaj:
    // ofis kirası (12000 KDV dahil → 10000 net) + stopajlı kira ödemesi (8000 nakit + 2000 stopaj) = 20000.
    await q(`select public.finance_budget_set('2026-10-01'::date, 'out', 'kira', 15000::numeric)`);
    const bva = await q(`select direction, category, budget::float8 as b, actual::float8 as a from public.finance_budget_vs_actual('2026-10-01'::date) where category in ('kira', 'ofis', 'reklam')`);
    expect(bva).toEqual([{ direction: "out", category: "ofis", b: 15000, a: 20000 }, { direction: "out", category: "reklam", b: 5000, a: 0 }]);
    // Eylül: gider kaydı olmayan 'portal' çıkışları 'reklam' bütçesiyle buluşur (6000) + eski reklam gideri 1200.
    const sep = await q(`select category, budget::float8 as b, actual::float8 as a from public.finance_budget_vs_actual('2026-09-01'::date) where direction = 'out' and category in ('portal', 'reklam')`);
    expect(sep).toEqual([{ category: "reklam", b: 5000, a: 7200 }]);
    const rule = await one<string>(`public.finance_rule_upsert('{"match_text": "SAHIBINDEN", "set_category": "portal", "mode": "auto", "direction": "out"}'::jsonb)`);
    const sug = await q(`select rule_id, category, mode from public.finance_rule_suggest('EFT sahibinden.com 4500', 4500, null, 'out')`);
    expect(sug).toEqual([{ rule_id: rule, category: "portal", mode: "auto" }]);
    const cat = await one<string>(`public.finance_category_upsert('{"direction": "in", "label": "Danışmanlık Ücreti"}'::jsonb)`);
    await db.exec(`reset role`);
    expect((await q(`select key from public.finance_categories where id = $1`, [cat]))[0]!.key).toBe("x_danismanlik_ucreti");
  });

  it("açık kalem görünümü: kira tahakkuku, hesaplanmış komisyon, düzenli ödeme ve hakediş tıklanabilir satır üretir", async () => {
    await db.exec(`reset role`);
    const cust = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Kiracı Can') returning id`, [T]))[0]!.id as string;
    const prop = (await q(`insert into public.properties(tenant_id, title) values ($1, 'Moda 2+1') returning id`, [T]))[0]!.id as string;
    const rental = (await q(`insert into public.rentals(tenant_id, property_id, renter_customer_id, due_day) values ($1, $2, $3, 5) returning id`, [T, prop, cust]))[0]!.id as string;
    await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount, status, paid_amount) values ($1, $2, '2026-10-01', 20000, 'partial', 5000)`, [T, rental]);
    const deal = (await q(`insert into public.deals(tenant_id, customer_id) values ($1, $2) returning id`, [T, cust]))[0]!.id as string;
    await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, vat_amount, status, created_at) values ($1, $2, 12000, 2000, 'calculated', '2026-10-06')`, [T, deal]);
    await q(`insert into public.recurring_rules(tenant_id, direction, category, title, amount, account_id, pay_day, next_period, next_due)
             values ($1, 'out', 'portal', 'Sahibinden paketi', 4500, $2, 20, '2026-10-01', '2026-10-20')`, [T, KASA]);
    await q(`insert into public.rental_management_agreements(tenant_id, rental_id, payout_day) values ($1, $2, 10)`, [T, rental]);
    await q(`insert into public.rent_payments(tenant_id, rental_id, amount, management_fee, paid_on) values ($1, $2, 5000, 500, '2026-10-05')`, [T, rental]);
    const rows = await q(`select source, direction, amount_open::float8 as a, href from public.finance_open_items_v where tenant_id = $1 and source <> 'manual' order by source`, [T]);
    expect(rows).toEqual([
      { source: "commission", direction: "receivable", a: 12000, href: `/app/anlasmalar/${deal}` },
      { source: "owner_payout", direction: "payable", a: 4500, href: `/app/kiralama/${rental}` },
      { source: "recurring", direction: "payable", a: 4500, href: "/app/giderler?sekme=duzenli" },
      { source: "rent", direction: "receivable", a: 15000, href: `/app/kiralama/${rental}` },
    ]);
    // Kaynak izni: definer RPC'ler doğrudan okumadaki RLS ile aynı sonucu verir — kira/komisyon izni olmayan muhasebe rolü
    // kira ve komisyon alacağını yaşlandırma/genel bakış toplamlarında görmez.
    await asAccountant();
    const accAging = (await q(`select sum(amount)::float8 as a from public.finance_aging('receivable')`))[0]!.a as number;
    const accOv = await one<Record<string, number>>(`public.finance_overview('2026-10-01'::date, '2026-10-31'::date, null)`);
    await asOwner();
    const ownAging = (await q(`select sum(amount)::float8 as a from public.finance_aging('receivable')`))[0]!.a as number;
    const ownOv = await one<Record<string, number>>(`public.finance_overview('2026-10-01'::date, '2026-10-31'::date, null)`);
    expect(ownAging - accAging).toBe(12000 + 15000);
    expect(Number(ownOv.receivable_open) - Number(accOv.receivable_open)).toBe(12000 + 15000);
    expect(Number(ownOv.payable_open) - Number(accOv.payable_open)).toBe(4500); // hakediş (rentals)
    const fc = await q(`select sum(outflow)::float8 as o from public.finance_cashflow_forecast(90, null) where not is_actual`);
    // düzenli ödeme 90 günde en az 3 kez (+ hakediş 4500) çıkış olarak tahmine girer
    expect(Number(fc[0]!.o)).toBeGreaterThanOrEqual(4500 * 3 + 4500);
  });

  it("eski giderler tek tıkla hesaba taşınır; defter satır sayısı değişmez, bakiye gider kadar düşer", async () => {
    await asOwner();
    const before = await balances();
    const n = await one<number>(`public.finance_adopt_legacy_expenses($1::uuid, $2::uuid[])`, [KASA, legacyIds.slice(0, 2)]);
    expect(n).toBe(2);
    const after = await balances();
    expect(after[KASA]).toBe(before[KASA]! - 2000);
    await db.exec(`reset role`);
    const rows = await q(`select origin, count(*)::int as n from public.finance_ledger_v where tenant_id = $1 group by origin order by origin`, [T]);
    expect(rows.find((r) => r.origin === "legacy_expense")!.n).toBe(1);
  });

  it("ofis izolasyonu: başka ofisin hesabı, kalemi, carisi RPC ile okunamaz/yazılamaz; RLS satır göstermez", async () => {
    await db.exec(`reset role`);
    const tItem = (await q(`select id from public.finance_open_items where tenant_id = $1 limit 1`, [T]))[0]!.id as string;
    const tParty = (await q(`select id from public.finance_parties where tenant_id = $1 limit 1`, [T]))[0]!.id as string;
    await as(OTHER, T2, FULL, "owner");
    expect(await fails(`select public.finance_open_item_settle($1::uuid, $2::uuid, 1::numeric, '2026-10-05'::date, null)`, [tItem, OTHER_ACC])).toBe("FN:not_found");
    expect(await fails(`select * from public.finance_party_statement($1::uuid, null, null)`, [tParty])).toBe("FN:not_found");
    expect(await fails(`select public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: KASA, direction: "in", amount: 5, title: "x" })])).toBe("FN:not_found");
    expect(await fails(`select public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: OTHER_ACC, direction: "in", amount: 5, title: "x", party_id: tParty })])).toBe("FN:party_not_found");
    expect(await fails(`select public.finance_party_upsert($1::jsonb)`, [JSON.stringify({ id: tParty, name: "Ele geçir" })])).toBe("FN:not_found");
    expect((await q(`select count(*)::int as n from public.finance_party_balances(null, null)`))[0]!.n).toBe(1);
    expect((await q(`select count(*)::int as n from public.finance_parties`))[0]!.n).toBe(1);
    expect((await q(`select count(*)::int as n from public.finance_open_items`))[0]!.n).toBe(0);
    expect((await q(`select count(*)::int as n from public.finance_ledger_v where tenant_id = $1`, [T]))[0]!.n).toBe(0);
    const ov = await one<Record<string, unknown>>(`public.finance_overview('2026-09-01'::date, '2026-10-31'::date, null)`);
    expect(ov).toMatchObject({ legacy_unadopted_count: 0, receivable_open: 0 });
    // Doğrudan yazma yok (kayıtlı görünüm hariç, o da yalnız kendi satırı)
    expect(await fails(`insert into public.finance_parties(tenant_id, name) values ($1, 'x')`, [T2])).toMatch(/permission denied/);
    await q(`insert into public.finance_saved_views(tenant_id, user_id, tab, name, params) values ($1, $2, 'hareketler', 'Bu ay', '{"tur": "out"}')`, [T2, OTHER]);
    expect(await fails(`insert into public.finance_saved_views(tenant_id, user_id, tab, name) values ($1, $2, 'hareketler', 'Sızma')`, [T, OTHER])).toMatch(/row-level security/);
  });

  it("rollback dosyaları ters sırayla temiz çalışır; hareketler ve bakiyeler korunur", async () => {
    await asOwner();
    const before = await balances();
    await db.exec(`reset role`);
    const n = Number((await q(`select count(*)::int as n from public.cash_entries`))[0]!.n);
    await db.exec(read("supabase/rollbacks/20261014001200_finance_ledger_v2_backfill.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261014001100_finance_ledger_v2_rpc.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261014001000_finance_ledger_v2.rollback.sql"));
    expect(Number((await q(`select count(*)::int as n from public.cash_entries`))[0]!.n)).toBe(n);
    expect(await q(`select to_regclass('public.finance_parties') as t, to_regclass('public.finance_ledger_v') as v`)).toEqual([{ t: null, v: null }]);
    await asOwner();
    expect(await balances()).toEqual(before);
    // Yeniden uygulanabilir (idempotent zincir)
    await db.exec(`reset role`);
    for (const f of V2) await db.exec(read(f));
    expect((await q(`select count(*)::int as n from public.cash_entries where nullif(btrim(counterparty), '') is not null and party_id is null`))[0]!.n).toBe(0);
  });
});
