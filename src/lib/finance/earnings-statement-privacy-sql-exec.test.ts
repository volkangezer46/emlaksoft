import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { applyFinanceBase, applyWp2, OWNER_FINANCE_PERMS } from "@/lib/test-support/finance-accrual-db";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261011001300_earnings_statement_privacy.
 *  - tenant_commission_aggregates / tenant_reporting_aggregates: earnings_all yoksa yalnız KENDİ kayıtları, advisors = [].
 *  - finance_statement_lines/imports/mappings okuma politikaları: hesap görünürlüğü + maaş süzgeci + bekleyen satır yalnız expenses:create.
 *  - WP2 (20261017010200/010300): danışman carisi (kind danisman, user_id) ve pay/hakediş tahakkuk kalemleri earnings_all yoksa
 *    yalnız sahibine görünür (finance_parties / finance_open_items / finance_open_items_v + finance_open_item_settle P12 kapısı).
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
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text, is_sample boolean not null default false);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_sample boolean not null default false, deleted_at timestamptz, source text);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_sample boolean not null default false, deleted_at timestamptz);
create table public.customer_demands(id uuid primary key default gen_random_uuid(), tenant_id uuid, status text, is_sample boolean not null default false, created_at timestamptz default now());
create table public.portal_listings(id uuid primary key default gen_random_uuid(), tenant_id uuid, status text, last_confirmed_at timestamptz);
create table public.listing_closures(id uuid primary key default gen_random_uuid(), tenant_id uuid, estimated_lost_commission numeric default 0, created_at timestamptz default now());
create table public.appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid, scheduled_at timestamptz, is_sample boolean not null default false);
create table public.calls(id uuid primary key default gen_random_uuid(), tenant_id uuid, started_at timestamptz, is_sample boolean not null default false);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid, stage text, loss_reason text, deal_value numeric default 0,
  is_sample boolean not null default false, customer_id uuid, assigned_to uuid);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid, gross_amount numeric default 0,
  status text default 'pending', created_at timestamptz default now(), is_sample boolean not null default false, splits jsonb not null default '[]'::jsonb);
create table public.commission_splits(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, commission_id uuid not null, profile_id uuid);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("kazanç + ekstre gizliliği (pglite)", () => {
  let db: Db;
  let T: string, OWNER: string, ADV: string, ADV2: string, ACC: string, VIEWER: string, OUTSIDER: string;
  let BANK: string, PERSONAL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const ownerPerms = "commissions:view reports:view earnings_all:view expenses:view expenses:create expenses:edit expenses:delete";
  const advPerms = "commissions:view reports:view";
  const agg = async () => (await q(`select public.tenant_commission_aggregates() as r`))[0]!.r as { total: number; record_count: number; advisors: { profile_id: string; pay: number }[] };
  const rep = async () =>
    (await q(`select public.tenant_reporting_aggregates() as r`))[0]!.r as { summary: { month_commission: number }; monthly: { income: number }[] };
  const lineCount = async (where: string) => Number((await q(`select count(*)::int as n from public.finance_statement_lines where ${where}`))[0]!.n);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (name: string) => (await q(`insert into public.profiles(tenant_id, full_name) values ($1, $2) returning id`, [T, name]))[0]!.id as string;
    OWNER = await prof("Ofis Sahibi");
    ADV = await prof("Danışman Bir");
    ADV2 = await prof("Danışman İki");
    ACC = await prof("Muhasebeci");
    VIEWER = await prof("Gözlemci");
    OUTSIDER = await prof("Yetkisiz");
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001200_bank_statement_import.sql"));
    await db.exec(read("supabase/migrations/20261011001300_earnings_statement_privacy.sql"));

    // --- Komisyon verisi: c1 (ADV'nin anlaşması, pay ADV + ADV2), c2 (ADV2'nin anlaşması, pay ADV2)
    const deal = async (assigned: string) => (await q(`insert into public.deals(tenant_id, assigned_to) values ($1, $2) returning id`, [T, assigned]))[0]!.id as string;
    const d1 = await deal(ADV);
    const d2 = await deal(ADV2);
    const comm = async (d: string, gross: number, splits: unknown[]) =>
      (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, splits) values ($1, $2, $3, $4::jsonb) returning id`, [T, d, gross, JSON.stringify(splits)]))[0]!.id as string;
    const c1 = await comm(d1, 1000, [
      { label: "Danışman Bir", rate: 50, profile_id: ADV },
      { label: "Danışman İki", rate: 50, profile_id: ADV2 },
    ]);
    const c2 = await comm(d2, 2000, [{ label: "Danışman İki", rate: 100, profile_id: ADV2 }]);
    for (const [c, p] of [[c1, ADV], [c1, ADV2], [c2, ADV2]] as const) {
      await q(`insert into public.commission_splits(tenant_id, commission_id, profile_id) values ($1, $2, $3)`, [T, c, p]);
    }

    // --- Ekstre verisi
    await as(OWNER, ownerPerms, "owner");
    BANK = ((await q(`select public.finance_account_create('office','bank','İş Bankası Örnek',null,'TRY',10000::numeric,'2026-10-01'::date) as r`))[0]!.r as { account_id: string }).account_id;
    await as(ADV, advPerms, "advisor");
    PERSONAL = ((await q(`select public.finance_account_create('user','bank','Kişisel banka',null,'TRY',0::numeric,'2026-10-01'::date) as r`))[0]!.r as { account_id: string }).account_id;
    await db.exec(`reset role`);

    const entry = async (cat: string, title: string) =>
      (await q(
        `insert into public.cash_entries(tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title)
         values ($1, $2, 'out', 100, 'TRY', '2026-10-05', 'expense', $3, $4) returning id`,
        [T, BANK, cat, title],
      ))[0]!.id as string;
    const salaryEntry = await entry("maas", "Maaş ödemesi");
    const rentEntry = await entry("kira", "Kira");
    const imp = async (acc: string, hash: string) =>
      (await q(`insert into public.finance_statement_imports(tenant_id, account_id, file_hash, format, row_count) values ($1, $2, $3, 'csv', 1) returning id`, [T, acc, hash.repeat(64)]))[0]!.id as string;
    const impBank = await imp(BANK, "a");
    const impPersonal = await imp(PERSONAL, "b");
    const ln = (importId: string, acc: string, hash: string, status: string, entryId: string | null) =>
      q(
        `insert into public.finance_statement_lines(tenant_id, import_id, account_id, line_hash, line_date, direction, amount, description, status, entry_id)
         values ($1, $2, $3, $4, '2026-10-05', 'out', 100, $5, $6, $7)`,
        [T, importId, acc, hash, `satir ${hash}`, status, entryId],
      );
    await ln(impBank, BANK, "line-salary-matched", "matched", salaryEntry);
    await ln(impBank, BANK, "line-rent-matched", "matched", rentEntry);
    await ln(impBank, BANK, "line-rent-posted", "posted", rentEntry);
    await ln(impBank, BANK, "line-pending", "pending", null);
    await ln(impPersonal, PERSONAL, "line-personal", "pending", null);
    await q(`insert into public.finance_statement_mappings(tenant_id, account_id, mapping) values ($1, $2, '{"date":0}'::jsonb)`, [T, BANK]);
  });

  describe("kazanç toplulaştırmaları", () => {
    it("danışman: tenant_commission_aggregates yalnız kendi payı olan kayıtları görür, advisors boş", async () => {
      await as(ADV, advPerms, "advisor");
      const r = await agg();
      expect(r.record_count).toBe(1);
      expect(Number(r.total)).toBe(1000);
      expect(r.advisors).toEqual([]);
    });

    it("diğer danışman: kendi anlaşması + payı olan kayıt; başkasının payı dökümü yok", async () => {
      await as(ADV2, advPerms, "advisor");
      const r = await agg();
      expect(r.record_count).toBe(2);
      expect(Number(r.total)).toBe(3000);
      expect(r.advisors).toEqual([]);
    });

    it("owner (earnings_all): tüm kayıtlar ve en az iki danışman dağılımı", async () => {
      await as(OWNER, ownerPerms, "owner");
      const r = await agg();
      expect(r.record_count).toBe(2);
      expect(Number(r.total)).toBe(3000);
      expect(r.advisors.length).toBeGreaterThanOrEqual(2);
      expect(r.advisors.map((a) => a.profile_id).sort()).toEqual([ADV, ADV2].sort());
    });

    it("tenant_reporting_aggregates: ofis komisyon toplamı danışmanda yalnız kendi kaydı, owner'da tamamı", async () => {
      await as(ADV, advPerms, "advisor");
      const a = await rep();
      expect(Number(a.summary.month_commission)).toBe(1000);
      expect(Number(a.monthly[a.monthly.length - 1]!.income)).toBe(1000);
      await as(OWNER, ownerPerms, "owner");
      const o = await rep();
      expect(Number(o.summary.month_commission)).toBe(3000);
      expect(Number(o.monthly[o.monthly.length - 1]!.income)).toBe(3000);
    });

    it("commissions:view olmayan kullanıcı reddedilir", async () => {
      await as(OUTSIDER, "", "advisor");
      await expect(q(`select public.tenant_commission_aggregates()`)).rejects.toThrow(/forbidden/);
    });
  });

  describe("ekstre satırı okuma politikaları", () => {
    it("muhasebe (expenses:view+create, owner/gm değil): maaş hareketine bağlı satır 0, diğerleri ve bekleyen görünür", async () => {
      await as(ACC, "expenses:view expenses:create", "accountant");
      expect(await lineCount(`line_hash = 'line-salary-matched'`)).toBe(0);
      expect(await lineCount(`line_hash = 'line-rent-matched'`)).toBe(1);
      expect(await lineCount(`line_hash = 'line-rent-posted'`)).toBe(1);
      expect(await lineCount(`line_hash = 'line-pending'`)).toBe(1);
    });

    it("owner: maaşa bağlı satırı görür (1)", async () => {
      await as(OWNER, ownerPerms, "owner");
      expect(await lineCount(`line_hash = 'line-salary-matched'`)).toBe(1);
      expect(await lineCount(`line_hash = 'line-pending'`)).toBe(1);
    });

    it("yalnız expenses:view: bekleyen satır görünmez, onaylanan maaşsız satır görünür", async () => {
      await as(VIEWER, "expenses:view", "readonly");
      expect(await lineCount(`line_hash = 'line-pending'`)).toBe(0);
      expect(await lineCount(`line_hash = 'line-salary-matched'`)).toBe(0);
      expect(await lineCount(`line_hash = 'line-rent-posted'`)).toBe(1);
    });

    it("hesabı göremeyen kullanıcı (expenses:view yok): ofis hesabı satırı, içe aktarma ve eşleme 0", async () => {
      await as(OUTSIDER, "", "advisor");
      expect(await lineCount(`account_id = '${BANK}'`)).toBe(0);
      expect((await q(`select count(*)::int as n from public.finance_statement_imports where account_id = '${BANK}'`))[0]!.n).toBe(0);
      expect((await q(`select count(*)::int as n from public.finance_statement_mappings where account_id = '${BANK}'`))[0]!.n).toBe(0);
    });

    it("kişisel hesap satırı yalnız sahibine görünür (owner dahil kimse görmez)", async () => {
      await as(ADV, advPerms, "advisor");
      expect(await lineCount(`line_hash = 'line-personal'`)).toBe(1);
      await as(OWNER, ownerPerms, "owner");
      expect(await lineCount(`line_hash = 'line-personal'`)).toBe(0);
    });

    it("expenses:view sahibi içe aktarma ve eşlemeyi görür", async () => {
      await as(ACC, "expenses:view expenses:create", "accountant");
      expect((await q(`select count(*)::int as n from public.finance_statement_imports where account_id = '${BANK}'`))[0]!.n).toBe(1);
      expect((await q(`select count(*)::int as n from public.finance_statement_mappings where account_id = '${BANK}'`))[0]!.n).toBe(1);
    });
  });
});

describe.skipIf(!mod)("WP2 danışman carisi + tahakkuk kalemi gizliliği (pglite, 20261017010200/010300)", () => {
  let db: Db;
  let T: string, OWNER: string, ADV: string, ADV2: string, BANKA: string;
  let S1: string, S2: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  // Danışman: Muhasebe görüntüleme (expenses:view) açık olsa bile earnings_all yoksa başkasının danışman carisini görmez.
  const advPerms = "expenses:view commissions:view";

  beforeAll(async () => {
    db = new mod!.PGlite();
    await applyFinanceBase(db);
    await applyWp2(db, ["triggers", "backfill"]);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (name: string) => (await q(`insert into public.profiles(tenant_id, full_name) values ($1, $2) returning id`, [T, name]))[0]!.id as string;
    OWNER = await prof("Ofis Sahibi");
    ADV = await prof("Danışman Bir");
    ADV2 = await prof("Danışman İki");
    const cust = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Ayşe Yılmaz') returning id`, [T]))[0]!.id as string;
    const deal = (await q(`insert into public.deals(tenant_id, customer_id) values ($1, $2) returning id`, [T, cust]))[0]!.id as string;
    const c = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, vat_amount, created_at) values ($1, $2, 10000, 2000, '2026-09-05T10:00:00+03') returning id`, [T, deal]))[0]!.id as string;
    const split = async (pid: string, amount: number) =>
      (await q(`insert into public.commission_splits(tenant_id, commission_id, kind, amount, profile_id, label) values ($1, $2, 'advisor', $3, $4, 'Danışman') returning id`, [T, c, amount, pid]))[0]!.id as string;
    S1 = await split(ADV, 3000);
    S2 = await split(ADV2, 2000);
    await as(OWNER, OWNER_FINANCE_PERMS, "owner");
    BANKA = ((await q(`select public.finance_account_create('office','bank','Banka',null,'TRY',10000::numeric,'2026-01-01'::date) as r`))[0]!.r as { account_id: string }).account_id;
    await db.exec(`reset role`);
  }, 180_000);

  it("sahip (earnings_all) iki danışman carisini ve iki pay borcunu görür", async () => {
    await as(OWNER, OWNER_FINANCE_PERMS, "owner");
    const parties = await q(`select name, user_id::text as u from public.finance_parties where kind = 'danisman' order by name`);
    expect(parties).toEqual([{ name: "Danışman Bir", u: ADV }, { name: "Danışman İki", u: ADV2 }]);
    expect((await q(`select count(*)::int as n from public.finance_open_items where event_type = 'commission.split_accrued'`))[0]!.n).toBe(2);
    expect((await q(`select count(*)::int as n from public.finance_open_items_v where category = 'danisman_hakedis'`))[0]!.n).toBe(2);
  });

  it("danışman (earnings_all yok) yalnız kendi carisini ve kendi pay borcunu görür", async () => {
    await as(ADV, advPerms, "advisor");
    expect(await q(`select name from public.finance_parties where kind = 'danisman'`)).toEqual([{ name: "Danışman Bir" }]);
    const own = await q(`select source_id::text as s, amount::float8 as a from public.finance_open_items where event_type = 'commission.split_accrued'`);
    expect(own).toEqual([{ s: S1, a: 3000 }]);
    const view = await q(`select amount_open::float8 as a from public.finance_open_items_v where category = 'danisman_hakedis'`);
    expect(view).toEqual([{ a: 3000 }]);
    // Müşteri alacağı (danışman carisi değil) Muhasebe görüntüleme ile görünür.
    expect((await q(`select count(*)::int as n from public.finance_open_items where event_type = 'commission.accrued'`))[0]!.n).toBe(1);
  });

  it("başkasının pay borcu kimlikle de kapatılamaz (P12: not_found)", async () => {
    await db.exec(`reset role`);
    const foreign = (await q(`select id::text as i from public.finance_open_items where source_id = $1`, [S2]))[0]!.i as string;
    await as(ADV, `${advPerms} expenses:create`, "advisor");
    await expect(q(`select public.finance_open_item_settle($1::uuid, $2::uuid, 100::numeric, '2026-09-10'::date, null)`, [foreign, BANKA]))
      .rejects.toThrow(/not_found/);
    await db.exec(`reset role`);
  });
});
