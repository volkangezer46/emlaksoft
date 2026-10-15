import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016060000_reporting_aggregates_local_axis.
 *  - B077: eksen İstanbul yerel ayından kurulur; 31 Eki, 1 Mar ve 29 Şub 23:30 (TR) için 12 benzersiz ve ardışık `ym`.
 *  - B077: kova sınırları yerel ay başı; ayın 29-31'i düşmez, Ekim kovası 'Eyl' olarak kaymaz.
 *  - B158: ofis geneli RPC kullanıcıya göre değişmez (komisyon yok); izleyen RPC'si earnings_all yoksa yalnız kendi kayıtları.
 *  - B165: gider serisi yalnız expenses:view ile dolu, yoksa null.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, amount numeric default 0, expense_date date,
  is_sample boolean not null default false);
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
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

type Viewer = {
  month_ym: string;
  month_commission: number;
  monthly: { ym: string; month_start: string; income: number; expense: number | null }[];
  earnings_scope: string;
  expense_visible: boolean;
};

describe.skipIf(!mod)("rapor toplulaştırması yerel ay ekseni (pglite)", () => {
  let db: Db;
  let T: string, OWNER: string, RO: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, perms: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false)`);
    await db.exec(`set role authenticated`);
  };
  const ownerPerms = "commissions:view reports:view earnings_all:view expenses:view";
  const roPerms = "commissions:view reports:view";
  const viewer = async (asOf: string) =>
    (await q(`select public.tenant_reporting_viewer_aggregates($1::timestamptz) as r`, [asOf]))[0]!.r as Viewer;
  const office = async (asOf: string) =>
    (await q(`select public.tenant_reporting_aggregates($1::timestamptz) as r`, [asOf]))[0]!.r as Record<string, unknown> & { summary: Record<string, unknown> };
  const comm = async (asOf: string) =>
    (await q(`select public.tenant_commission_aggregates($1::timestamptz) as r`, [asOf]))[0]!.r as {
      month_total: number;
      monthly: { ym: string; accrued: number }[];
    };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Sahip') returning id`, [T]))[0]!.id as string;
    RO = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Salt okunur') returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261016060000_reporting_aggregates_local_axis.sql"));
    const deal = (await q(`insert into public.deals(tenant_id, assigned_to, stage) values ($1, $2, 'won') returning id`, [T, OWNER]))[0]!.id as string;
    // Ay sınırı kenarları (TR): 1 Eki 00:30 (UTC'de 30 Eyl 21:30), 31 Eki 23:30, 31 Tem 23:00, 30 Haz 23:59.
    const rows: [string, number][] = [
      ["2026-10-01 00:30+03", 100],
      ["2026-10-31 23:30+03", 200],
      ["2026-07-31 23:00+03", 300],
      ["2026-06-30 23:59+03", 400],
      ["2026-09-29 12:00+03", 500],
    ];
    for (const [at, gross] of rows) {
      await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, created_at) values ($1, $2, $3, $4::timestamptz)`, [T, deal, gross, at]);
    }
    // Gider: 31 Ekim (UTC tarihine göre kayarsa Kasım'a düşerdi) ve 1 Ekim.
    await q(`insert into public.expenses(tenant_id, amount, expense_date) values ($1, 70, '2026-10-31'), ($1, 30, '2026-10-01'), ($1, 5, '2026-09-30')`, [T]);
  });

  it.each(["2026-10-31 23:30+03", "2027-03-01 00:00+03", "2028-02-29 23:30+03"])(
    "%s için 12 benzersiz ve ardışık ym döner, son ay as_of'un TR ayıdır",
    async (asOf) => {
      await as(OWNER, ownerPerms);
      const r = await viewer(asOf);
      const yms = r.monthly.map((m) => m.ym);
      expect(yms).toHaveLength(12);
      expect(new Set(yms).size).toBe(12);
      for (let i = 1; i < yms.length; i++) {
        const [py, pm] = yms[i - 1]!.split("-").map(Number);
        const [y, m] = yms[i]!.split("-").map(Number);
        expect((y! - py!) * 12 + (m! - pm!)).toBe(1);
      }
      const trMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit" })
        .format(new Date(asOf.replace(" ", "T").replace("+03", "+03:00")))
        .slice(0, 7);
      expect(yms.at(-1)).toBe(trMonth);
      expect(r.month_ym).toBe(trMonth);
    },
  );

  it("kova sınırları TR ay başıdır: Ekim kovası 1 Eki 00:30 ve 31 Eki 23:30'u içerir, Eylül 29'u Eylül'de kalır", async () => {
    await as(OWNER, ownerPerms);
    const r = await viewer("2026-10-31 23:30+03");
    const by = new Map(r.monthly.map((m) => [m.ym, m]));
    expect(Number(by.get("2026-10")!.income)).toBe(300);
    expect(Number(by.get("2026-09")!.income)).toBe(500);
    expect(Number(by.get("2026-07")!.income)).toBe(300);
    expect(Number(by.get("2026-06")!.income)).toBe(400);
    expect(Number(r.month_commission)).toBe(300);
    // Gider yerel tarihle (lm::date): 31 Ekim Ekim'de.
    expect(Number(by.get("2026-10")!.expense)).toBe(100);
    expect(Number(by.get("2026-09")!.expense)).toBe(5);
    expect(r.expense_visible).toBe(true);
    expect(r.earnings_scope).toBe("office");
  });

  it("komisyon 6 aylık ekseni de yerel ay: ym benzersiz ve toplam kaybolmaz", async () => {
    await as(OWNER, ownerPerms);
    const r = await comm("2026-10-15 12:00+03");
    const yms = r.monthly.map((m) => m.ym);
    expect(yms).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(r.monthly.reduce((s, m) => s + Number(m.accrued), 0)).toBe(1500);
    expect(Number(r.month_total)).toBe(300);
  });

  it("izleyen RPC'si: earnings_all yoksa yalnız kendi kayıtları (salt okunur 0), gider serisi null", async () => {
    await as(RO, roPerms);
    const r = await viewer("2026-10-31 23:30+03");
    expect(Number(r.month_commission)).toBe(0);
    expect(r.monthly.every((m) => Number(m.income) === 0)).toBe(true);
    expect(r.monthly.every((m) => m.expense === null)).toBe(true);
    expect(r.expense_visible).toBe(false);
    expect(r.earnings_scope).toBe("own");
  });

  it("ofis geneli RPC kullanıcıya göre değişmez ve komisyon/gider taşımaz", async () => {
    await as(OWNER, ownerPerms);
    const a = await office("2026-10-31 23:30+03");
    await as(RO, roPerms);
    const b = await office("2026-10-31 23:30+03");
    expect(a).toEqual(b);
    expect(a.summary).not.toHaveProperty("month_commission");
    expect(a).not.toHaveProperty("monthly");
    expect(a.month_ym).toBe("2026-10");
  });

  it("reports:view yoksa iki RPC de reddeder", async () => {
    await as(RO, "commissions:view");
    await expect(viewer("2026-10-15 12:00+03")).rejects.toThrow(/forbidden/);
    await expect(office("2026-10-15 12:00+03")).rejects.toThrow(/forbidden/);
  });
});
