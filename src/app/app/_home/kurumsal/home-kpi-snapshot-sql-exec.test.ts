import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { DAY_MS, TR_OFFSET_MS, trParts } from "@/lib/clock";
import { weekBuckets } from "../helpers";
import { SPARK_WEEKS, salesSeries, salesSummary, type SalesRange, type SalesRow } from "./core";
import { parseKpiSnapshot, parseSalesWindows, salesFromWindowAggs, salesRpcWindows } from "./kpi-snapshot";

/**
 * PKG-2 PERF-2 — `home_kpi_snapshot` / `home_sales_windows` İŞLEVSEL SQL TESTİ (pglite; migration 20261027020000 gerçek
 * PL/pgSQL ile). Kanıtlanan: SQL çıktısı eski JS kovalamasıyla (loadKpiData head sayımları + `weekBuckets`, `salesSummary` +
 * `salesSeries`) BİREBİR aynı: kapsam (ben/ofis), örnek veri kuralı (p_include_sample), silinmiş müşteri, başka kiracı,
 * gelecek tarih ve talebin müşteri danışmanı üzerinden bağlanması. Oturum/ofis yoksa NULL; anon EXECUTE alamaz.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid, is_sample boolean not null default false, deleted_at timestamptz, created_at timestamptz not null default now());
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid, stage text, deal_type text, deal_value numeric, is_sample boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz);
create table public.customer_demands(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id), is_sample boolean not null default false, created_at timestamptz not null default now());
create table public.calls(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, direction text not null, handled_by uuid, is_sample boolean not null default false, started_at timestamptz not null);
`;

const T = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";
const YOU = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-10-17T13:20:00Z");

/** Deterministik sözde rastgele (aynı veri her koşuda). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

type Row = { tenant: string; who: string; sample: boolean; at: number; deleted?: boolean; stage?: string; dir?: string; value?: number; closedAt?: number | null; dealType?: string };

describe.skipIf(!mod)("home_kpi_snapshot / home_sales_windows — eski JS kovalamasıyla parite (pglite)", () => {
  let db: Db;
  const one = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows[0]!;
  const r = rng(7);
  const pickAt = () => NOW - Math.floor(r() * 140 * DAY_MS) + (r() < 0.04 ? 2 * DAY_MS : 0); // ara sıra gelecekte
  const who = () => (r() < 0.5 ? ME : YOU);
  const customers: (Row & { id: string })[] = [];
  const deals: Row[] = [];
  const demands: (Row & { customerId: string })[] = [];
  const calls: Row[] = [];

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261027020000_home_kpi_snapshot.sql"));
    for (let i = 0; i < 160; i++) {
      const c = { id: "", tenant: r() < 0.9 ? T : OTHER, who: who(), sample: r() < 0.3, at: pickAt(), deleted: r() < 0.08 };
      c.id = String((await one(`insert into public.customers(tenant_id, assigned_to, is_sample, deleted_at, created_at) values ($1, $2, $3, $4, $5) returning id`, [c.tenant, c.who, c.sample, c.deleted ? new Date(NOW).toISOString() : null, new Date(c.at).toISOString()])).id);
      customers.push(c);
    }
    const stages = ["new", "qualified", "negotiation", "won", "lost", null];
    for (let i = 0; i < 140; i++) {
      const at = pickAt();
      const stage = stages[Math.floor(r() * stages.length)] ?? undefined;
      const closed = stage === "won" ? Math.min(NOW - 60_000, at + Math.floor(r() * 40 * DAY_MS)) : null;
      const d: Row = { tenant: r() < 0.9 ? T : OTHER, who: who(), sample: r() < 0.3, at, stage, value: Math.round(r() * 50) * 100_000, closedAt: r() < 0.8 ? closed : null, dealType: r() < 0.6 ? "sale" : "rent" };
      const updated = closed ?? at + DAY_MS;
      await db.query(`insert into public.deals(tenant_id, assigned_to, stage, deal_type, deal_value, is_sample, created_at, updated_at, closed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        d.tenant, d.who, d.stage ?? null, d.dealType, d.value, d.sample, new Date(at).toISOString(), new Date(updated).toISOString(), d.closedAt ? new Date(d.closedAt).toISOString() : null,
      ]);
      deals.push({ ...d, closedAt: d.closedAt ?? null, at, value: d.value, stage: d.stage, who: d.who, ...{ updated } } as Row & { updated: number });
    }
    for (let i = 0; i < 150; i++) {
      const c = customers[Math.floor(r() * customers.length)]!;
      const dm = { tenant: c.tenant, who: c.who, customerId: c.id, sample: r() < 0.3, at: pickAt() };
      await db.query(`insert into public.customer_demands(tenant_id, customer_id, is_sample, created_at) values ($1,$2,$3,$4)`, [dm.tenant, dm.customerId, dm.sample, new Date(dm.at).toISOString()]);
      demands.push(dm);
    }
    const dirs = ["inbound", "inbound", "outbound", "missed"];
    for (let i = 0; i < 150; i++) {
      const k = { tenant: r() < 0.9 ? T : OTHER, who: who(), sample: r() < 0.3, at: pickAt(), dir: dirs[Math.floor(r() * dirs.length)]! };
      await db.query(`insert into public.calls(tenant_id, direction, handled_by, is_sample, started_at) values ($1,$2,$3,$4,$5)`, [k.tenant, k.dir, k.who, k.sample, new Date(k.at).toISOString()]);
      calls.push(k);
    }
  });

  const asUser = async (uid: string | null, tenant: string | null) => {
    await db.exec(`select set_config('t.uid', '${uid ?? ""}', false), set_config('t.tenant', '${tenant ?? ""}', false)`);
  };

  /** Eski JS yolu (loadKpiData): bu ay / geçen ayın eş dönemi / son 12 hafta kovası. */
  function legacy(rows: readonly Row[], mine: boolean, include: boolean, demand = false) {
    const p = trParts(NOW);
    const trMid = (y: number, m: number, d: number) => Date.UTC(y, m, d) - TR_OFFSET_MS;
    const monthStart = trMid(p.year, p.month, 1);
    const prevStart = trMid(p.year, p.month - 1, 1);
    const prevSame = Math.min(monthStart, prevStart + (NOW - monthStart));
    const since = NOW - SPARK_WEEKS * 7 * DAY_MS;
    const set = rows.filter((x) => x.tenant === T && !x.deleted && (!mine || x.who === ME) && (include || !x.sample));
    const cur = demand ? set.filter((x) => x.at >= NOW - 30 * DAY_MS).length : set.filter((x) => x.at >= monthStart).length;
    const prev = demand ? set.filter((x) => x.at >= NOW - 60 * DAY_MS && x.at < NOW - 30 * DAY_MS).length : set.filter((x) => x.at >= prevStart && x.at < prevSame).length;
    const weekly = weekBuckets(set.filter((x) => x.at >= since).map((x) => new Date(x.at).toISOString()), NOW, SPARK_WEEKS);
    return { total: set.length, thisMonth: cur, prevMonth: prev, weekly };
  }

  for (const scope of ["ben", "ofis"] as const) {
    for (const include of [true, false]) {
      it(`KPI parite: kapsam=${scope}, örnek veri ${include ? "dahil" : "hariç"}`, async () => {
        await asUser(ME, T);
        const raw = (await one(`select public.home_kpi_snapshot($1, $2, $3, $4) as j`, [scope, new Date(NOW - SPARK_WEEKS * 7 * DAY_MS).toISOString(), include, new Date(NOW).toISOString()])).j;
        const snap = parseKpiSnapshot(raw, SPARK_WEEKS);
        expect(snap).not.toBeNull();
        const mine = scope === "ben";
        expect(snap!.customers).toEqual(legacy(customers, mine, include));
        const dealLegacy = legacy(deals, mine, include);
        const openDeals = deals.filter((d) => d.tenant === T && (!mine || d.who === ME) && (include || !d.sample) && d.stage != null && d.stage !== "won" && d.stage !== "lost").length;
        expect(snap!.deals).toEqual({ ...dealLegacy, open: openDeals });
        // Talep: kişi bağlantısı müşterinin danışmanı (silinmiş müşteri süzülmez: eski inner join ile aynı).
        expect(snap!.demands).toEqual(legacy(demands.map((d) => ({ ...d, deleted: false })), mine, include, true));
        expect(snap!.calls).toEqual(legacy(calls.filter((k) => k.dir === "inbound"), mine, include));
        expect(snap!.sampleIncluded).toBe(include);
        // Boş veriyle sahte parite olmasın: kovalar ve sayımlar gerçekten dolu.
        expect(snap!.customers.weekly.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        expect(snap!.customers.thisMonth + snap!.calls.thisMonth + snap!.deals.open).toBeGreaterThan(0);
      });
    }
  }

  const salesCases: { range: SalesRange; scope: "ben" | "ofis"; include: boolean; tur?: "sale" | "rent" }[] = [
    { range: "ay", scope: "ofis", include: true },
    { range: "6ay", scope: "ben", include: true },
    { range: "yil", scope: "ofis", include: false, tur: "sale" },
    { range: "6ay", scope: "ofis", include: false, tur: "rent" },
  ];
  for (const c of salesCases) {
    it(`satış parite: ${c.range} · ${c.scope} · örnek ${c.include ? "dahil" : "hariç"}${c.tur ? ` · ${c.tur}` : ""}`, async () => {
      await asUser(ME, T);
      const p = trParts(NOW);
      const trMid = (y: number, m: number, d: number) => Date.UTC(y, m, d) - TR_OFFSET_MS;
      const since = c.range === "ay" ? trMid(p.year, p.month - 1, 1) : c.range === "6ay" ? trMid(p.year, p.month - 11, 1) : trMid(p.year - 1, 0, 1);
      // Eski yol: kazanılmış anlaşma satırları (updated_at >= since) → JS toplam.
      const rows: SalesRow[] = (deals as (Row & { updated: number })[])
        .filter((d) => d.tenant === T && d.stage === "won" && d.updated >= since && (c.scope === "ofis" || d.who === ME) && (c.include || !d.sample) && (!c.tur || d.dealType === c.tur))
        .map((d) => ({ value: d.value ?? 0, createdAt: new Date(d.at).toISOString(), closedAt: new Date(d.closedAt ?? d.updated).toISOString() }));
      const { windows, labels } = salesRpcWindows(c.range, NOW);
      const raw = (await one(`select public.home_sales_windows($1, $2, $3::jsonb, $4, $5, null) as j`, [c.scope, new Date(since).toISOString(), JSON.stringify(windows), c.include, c.tur ?? null])).j;
      const aggs = parseSalesWindows(raw, windows.length);
      expect(aggs).not.toBeNull();
      const fromSql = salesFromWindowAggs(aggs!, labels)!;
      expect(rows.length).toBeGreaterThan(0);
      expect(fromSql.summary).toEqual(salesSummary(rows, c.range, NOW));
      expect(fromSql.series).toEqual(salesSeries(rows, c.range, NOW));
    });
  }

  it("oturum ya da ofis yoksa NULL; geçersiz kapsam NULL; anon EXECUTE alamaz", async () => {
    await asUser(null, T);
    expect((await one(`select public.home_kpi_snapshot('ben', now() - interval '84 days', true) as j`)).j).toBeNull();
    await asUser(ME, null);
    expect((await one(`select public.home_sales_windows('ofis', now(), '[]'::jsonb, true) as j`)).j).toBeNull();
    await asUser(ME, T);
    expect((await one(`select public.home_kpi_snapshot('herkes', now() - interval '84 days', true) as j`)).j).toBeNull();
    const acl = await one(
      `select has_function_privilege('anon', 'public.home_kpi_snapshot(text, timestamptz, boolean, timestamptz)', 'EXECUTE') a,
              has_function_privilege('authenticated', 'public.home_kpi_snapshot(text, timestamptz, boolean, timestamptz)', 'EXECUTE') b,
              has_function_privilege('anon', 'public.home_sales_windows(text, timestamptz, jsonb, boolean, text, uuid)', 'EXECUTE') c`,
    );
    expect(acl).toEqual({ a: false, b: true, c: false });
  });
});
