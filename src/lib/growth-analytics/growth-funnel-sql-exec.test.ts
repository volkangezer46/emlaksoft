import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { parseGrowthFunnel, rate } from "./funnel";

/**
 * İŞLEVSEL SQL TESTİ (pglite, bellek içi Postgres): SP3 migration'ları GERÇEK dosyalardan yüklenir
 * (20261013003200 ölçüm tabloları + ingest/prune/vitals özeti, 003210 atıf sütunları, 003220 huni RPC'si).
 * tenants/properties/subscriptions/invoices/signup_attributions canlı tabloların SADELEŞTİRİLMİŞ taklididir.
 * Modül yüklenemezse ATLANIR (CI'da `npm ci` ile kurulu, koşar).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), name text default 'Ofis', status text default 'trial', created_at timestamptz not null default now());
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), is_sample boolean not null default false);
create table public.subscriptions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), status text not null default 'trialing', amount_try numeric not null default 0);
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), status text not null default 'draft', amount_try numeric not null default 0, total_try numeric not null default 0, paid_at timestamptz);
create table public.signup_attributions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  ref_kind text check (ref_kind in ('referral','partner','tool','powered_by','none')),
  referrer_tenant_id uuid, partner_id uuid,
  utm_source text, utm_medium text, utm_campaign text, landing_path text, first_seen_at timestamptz,
  created_at timestamptz not null default now()
);
`;

const MIGRATIONS = [
  "supabase/migrations/20261013003200_public_measurement.sql",
  "supabase/migrations/20261013003210_signup_attribution_ext.sql",
  "supabase/migrations/20261013003220_growth_funnel.sql",
];

describe.skipIf(!mod)("SP3 ölçüm ve huni SQL — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async (sql: string, params?: unknown[]) => Object.values((await q(sql, params))[0] ?? {})[0];
  const as = (role: string) => db.exec(`select set_config('request.jwt.claim.role','${role}',false)`);
  const today = async () => String(await one(`select ((now() at time zone 'Europe/Istanbul')::date)::text`));

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    for (const m of MIGRATIONS) await db.exec(read(m).replace(/notify pgrst[^;]*;/g, ""));
  });

  async function tenant(opts: { channel?: string | null; lp?: string; property?: boolean; sample?: boolean; paid?: boolean; paidAfterDays?: number } = {}) {
    const id = String(await one(`insert into public.tenants(created_at) values (now() - interval '2 days') returning id`));
    if (opts.channel !== undefined) {
      await q(`insert into public.signup_attributions(tenant_id, ref_kind, channel, landing_path) values ($1,'none',$2,$3)`, [id, opts.channel, opts.lp ?? null]);
    }
    if (opts.property) await q(`insert into public.properties(tenant_id, is_sample) values ($1,$2)`, [id, Boolean(opts.sample)]);
    await q(`insert into public.subscriptions(tenant_id, status, amount_try) values ($1,$2,$3)`, [id, opts.paid ? "active" : "trialing", opts.paid ? 990 : 0]);
    if (opts.paidAfterDays !== undefined) {
      await q(`insert into public.invoices(tenant_id, status, total_try, paid_at) values ($1,'paid',990,(select created_at from public.tenants where id=$1) + make_interval(days => $2))`, [id, opts.paidAfterDays]);
    }
    return id;
  }

  it("RPC'ler yalnız service_role: anon/authenticated reddedilir", async () => {
    await as("authenticated");
    await expect(q(`select public.analytics_ingest('{}'::jsonb)`)).rejects.toThrow(/forbidden/);
    await expect(q(`select public.platform_growth_funnel(current_date - 7, current_date)`)).rejects.toThrow(/forbidden/);
    await expect(q(`select public.analytics_prune()`)).rejects.toThrow(/forbidden/);
    await expect(q(`select public.analytics_vitals_summary(current_date - 7, current_date)`)).rejects.toThrow(/forbidden/);
  });

  it("veri yokken huni: ziyaret null (ölçüm yok), oranlar null, sıfır uydurulmaz", async () => {
    await as("service_role");
    const d = await today();
    const f = parseGrowthFunnel(await one(`select public.platform_growth_funnel(($1::date) - 27, $1::date)`, [d]))!;
    expect(f.hasPageviews).toBe(false);
    expect(f.visitsTotal).toBeNull();
    expect(f.channels).toEqual([]);
    expect(rate(f.totals.attributed, f.totals.signups)).toBeNull();
  });

  it("ingest: aynı anahtar partide toplanır, tekrar çağrıda artar; geçersiz satır atlanır", async () => {
    await as("service_role");
    const d = await today();
    const row = { day: d, path_tpl: "/", channel: "organic_search", source: "", medium: "", campaign: "", device: "mobile", n: 2 };
    const res = await one(`select public.analytics_ingest($1::jsonb)`, [
      JSON.stringify({
        pv: [
          row,
          { ...row, n: 3 },
          { ...row, channel: "uydurma" },
          { ...row, day: "2020-01-01" },
          { ...row, path_tpl: "" },
          { ...row, n: -1 },
          { ...row, path_tpl: "/fiyatlar", channel: "paid_search", source: "google", medium: "cpc", device: "desktop", n: 4 },
        ],
        wv: [
          { day: d, path_tpl: "/", device: "mobile", metric: "LCP", bucket: 3, static: true, n: 5 },
          { day: d, path_tpl: "/", device: "mobile", metric: "XYZ", bucket: 3, static: true, n: 5 },
          { day: d, path_tpl: "/", device: "mobile", metric: "LCP", bucket: 99, static: true, n: 5 },
        ],
      }),
    ]);
    expect(res).toEqual({ pv: 2, wv: 1 });
    await q(`select public.analytics_ingest($1::jsonb)`, [JSON.stringify({ pv: [row] })]);
    expect(await one(`select n from public.public_pageviews_daily where path_tpl='/' and channel='organic_search'`)).toBe(7);
    expect(await one(`select count(*)::int from public.public_pageviews_daily`)).toBe(2);
    expect(await one(`select n from public.web_vitals_daily where metric='LCP'`)).toBe(5);
    // Tablo doğrudan erişime kapalı (anon/authenticated)
    expect(await one(`select has_table_privilege('anon','public.public_pageviews_daily','select')`)).toBe(false);
    expect(await one(`select has_table_privilege('authenticated','public.web_vitals_daily','select')`)).toBe(false);
  });

  it("huni: atıfsız kiracı 'bilinmiyor', kanal başına ziyaret/kayıt/ilk ilan/ödeme, payda 0'da oran null", async () => {
    await as("service_role");
    const d = await today();
    await tenant({ channel: "organic_search", lp: "/", property: true, paid: true, paidAfterDays: 4 });
    await tenant({ channel: "organic_search", lp: "/", property: true, sample: true, paidAfterDays: -3 }); // örnek ilan sayılmaz; ödeme kayıttan önce → bozuk
    await tenant({}); // atıf satırı yok → bilinmiyor
    await tenant({ channel: "direct" });
    await tenant({ channel: null }); // eski satır: kanal boş → unknown
    const f = parseGrowthFunnel(await one(`select public.platform_growth_funnel(($1::date) - 27, $1::date)`, [d]))!;
    const by = Object.fromEntries(f.channels.map((c) => [c.channel, c]));
    expect(by.organic_search).toMatchObject({ visits: 7, signups: 2, activated: 1, paid: 1, paidSamples: 1, medianDaysToPaid: 4 });
    expect(by.bilinmiyor).toMatchObject({ visits: null, signups: 1, activated: 0, paid: 0, medianDaysToPaid: null });
    expect(by.unknown).toMatchObject({ signups: 1 });
    expect(by.direct).toMatchObject({ visits: 0, signups: 1 });
    // ziyaret var, kayıt yok: ücretli arama
    expect(by.paid_search).toMatchObject({ visits: 4, signups: 0 });
    expect(rate(by.paid_search!.paid, by.paid_search!.signups)).toBeNull(); // payda 0 → null
    expect(f.totals).toEqual({ signups: 5, attributed: 3, activated: 1, paid: 1 });
    expect(f.visitsTotal).toBe(11);
    expect(f.hasPageviews).toBe(true);
    expect(f.landings.find((l) => l.path === "/")).toMatchObject({ visits: 7, signups: 2, paid: 1 });
    expect(f.landings.find((l) => l.path === "/fiyatlar")).toMatchObject({ visits: 4, signups: 0 });
  });

  it("ilk ödeme: total_try=0 ama amount_try>0 olan fatura da örneğe girer", async () => {
    await as("service_role");
    const d = await today();
    const id = await tenant({ channel: "direct" });
    await q(`insert into public.invoices(tenant_id, status, amount_try, total_try, paid_at) values ($1,'paid',990,0,(select created_at from public.tenants where id=$1) + interval '6 days')`, [id]);
    const f = parseGrowthFunnel(await one(`select public.platform_growth_funnel(($1::date) - 27, $1::date)`, [d]))!;
    expect(f.channels.find((c) => c.channel === "direct")).toMatchObject({ signups: 2, paidSamples: 1, medianDaysToPaid: 6 });
  });

  it("geçersiz aralık reddedilir", async () => {
    await as("service_role");
    await expect(q(`select public.platform_growth_funnel(current_date, current_date - 1)`)).rejects.toThrow(/invalid_range/);
    await expect(q(`select public.platform_growth_funnel(current_date - 500, current_date)`)).rejects.toThrow(/invalid_range/);
  });

  it("atıf sütun kısıtları: kanal kümesi, host deseni, iniş yolu sorgusuz ≤120", async () => {
    await as("service_role");
    const id = String(await one(`insert into public.tenants default values returning id`));
    const ins = (cols: string, vals: unknown[]) =>
      q(`insert into public.signup_attributions(tenant_id, ref_kind, ${cols}) values ($1,'none',${vals.map((_, i) => `$${i + 2}`).join(",")})`, [id, ...vals]);
    await expect(ins("channel", ["reklam"])).rejects.toThrow(/channel_check/);
    await expect(ins("src_host", ["Evil Host"])).rejects.toThrow(/src_host_check/);
    await expect(ins("landing_path", ["/kayit?x=1"])).rejects.toThrow(/landing_path_check/);
    await expect(ins("landing_path", [`/${"a".repeat(120)}`])).rejects.toThrow(/landing_path_check/);
    await expect(ins("utm_term", ['a"b'])).rejects.toThrow(/utm_term_check/);
    await expect(ins("first_touch", ['["dizi"]'])).rejects.toThrow(/touch_check/);
    await ins("channel, src_host, landing_path, utm_term, first_touch", ["social", "t.co", "/vitrin/[ofis]", "emlak crm", '{"channel":"social"}']);
    expect(await one(`select count(*)::int from public.signup_attributions where tenant_id=$1`, [id])).toBe(1);
  });

  it("vitals özeti dönem toplamı; prune eski satırları siler", async () => {
    await as("service_role");
    const d = await today();
    await q(`insert into public.web_vitals_daily(day, path_tpl, device, metric, bucket, static, n) values ((($1::date) - 1), '/', 'mobile', 'LCP', 3, true, 2)`, [d]);
    const rows = (await one(`select public.analytics_vitals_summary(($1::date) - 6, $1::date)`, [d])) as { n: number; bucket: number }[];
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.n)).toBe(7);
    await q(`insert into public.public_pageviews_daily(day, path_tpl, channel, device, n) values ((($1::date) - 500), '/eski', 'direct', 'mobile', 1)`, [d]);
    await q(`insert into public.web_vitals_daily(day, path_tpl, device, metric, bucket, static, n) values ((($1::date) - 100), '/eski', 'mobile', 'LCP', 1, false, 1)`, [d]);
    expect(await one(`select public.analytics_prune()`)).toEqual({ pv: 1, wv: 1 });
    expect(await one(`select count(*)::int from public.public_pageviews_daily where path_tpl='/eski'`)).toBe(0);
  });
});
