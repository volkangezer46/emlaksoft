import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261011000700 — danışman (scope='mine') dosya/yapıştırma/eklenti ile "var" göndererek
 * kendi ilanındaki kaçak sinyalini KAPATAMAZ. Gerçek `lc_inventory_import` gövdesi çalışır; bağımlı yardımcılar
 * (lc_apply_check vb.) sadeleştirilmiş taklittir ve çağrıları `applied_log`'a yazılır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select current_setting('t.role', true) $$;
create function public.has_effective_permission(m text, a text) returns boolean language sql stable as $$ select true $$;
create function public.lc_row_visible(b uuid, t uuid, a uuid) returns boolean language sql stable as $$ select true $$;
create table public.applied_log(id serial primary key, portal_listing_id uuid, result text, source_kind text);
create function public.lc_apply_check(t uuid, pl uuid, r text, sk text, a text, b text, o jsonb, c text, d jsonb, e text)
  returns jsonb language plpgsql as $$ begin insert into public.applied_log(portal_listing_id, result, source_kind) values (pl, r, sk); return jsonb_build_object('outcome','applied'); end $$;
create function public.lc_mark_state_stale(t uuid, p uuid) returns void language sql as $$ select 1 $$;
create function public.lc_register_matching_candidates(t uuid, c jsonb) returns integer language sql as $$ select 0 $$;
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, team_id uuid);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, assigned_to uuid, deleted_at timestamptz);
create table public.portal_listings(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, portal_name text, status text);
create table public.portal_listing_health(portal_listing_id uuid primary key, tenant_id uuid, check_state text, last_absent_at timestamptz);
create table public.listing_anomalies(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, portal_listing_id uuid,
  type text, status text default 'open', last_seen_at timestamptz default now());
create table public.listing_anomaly_actions(id uuid primary key default gen_random_uuid(), tenant_id uuid, anomaly_id uuid, action text, actor_id uuid, note text,
  created_at timestamptz default now());
create table public.listing_inventory_imports(id uuid primary key default gen_random_uuid(), expected_count integer, read_count integer);
create table public.listing_matching_candidates(id uuid primary key default gen_random_uuid());
create table public.audit_logs(id uuid primary key default gen_random_uuid());
create function public.lc_inventory_import(p_portal text, p_scope text, p_source text, p_complete boolean, p_observations jsonb, p_candidates jsonb, p_summary jsonb default null) returns jsonb language sql as $$ select '{}'::jsonb $$;
`;

describe.skipIf(!mod)("envanter içe aktarma: danışman kaçak sinyalini kapatamaz (pglite)", () => {
  let db: Db;
  let T: string;
  let ADV: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (role: string) => {
    await db.exec(`select set_config('t.tenant','${T}',false), set_config('t.uid','${ADV}',false), set_config('t.role','${role}',false)`);
  };
  /** state: sağlık durumu; anomaly: açık portal_missing var mı. */
  const mkListing = async (state: string, anomaly: boolean) => {
    const P = (await q(`insert into public.properties(tenant_id, assigned_to) values ($1, $2) returning id`, [T, ADV]))[0]!.id as string;
    const PL = (await q(`insert into public.portal_listings(tenant_id, property_id, portal_name, status) values ($1,$2,'sahibinden','live') returning id`, [T, P]))[0]!.id as string;
    await q(`insert into public.portal_listing_health(portal_listing_id, tenant_id, check_state) values ($1,$2,$3)`, [PL, T, state]);
    let A: string | null = null;
    if (anomaly) A = (await q(`insert into public.listing_anomalies(tenant_id, property_id, portal_listing_id, type) values ($1,$2,$3,'portal_missing') returning id`, [T, P, PL]))[0]!.id as string;
    return { PL, A };
  };
  const present = (pl: string) => JSON.stringify([{ listing_id: pl, result: "present" }]);
  const run = async (scope: string, source: string, obs: string) =>
    (await q(`select public.lc_inventory_import('sahibinden', $1, $2, false, $3::jsonb, '[]'::jsonb, null) as r`, [scope, source, obs]))[0]!.r as Record<string, unknown>;
  const applied = async (pl: string) => (await q(`select count(*)::int n from public.applied_log where portal_listing_id = $1`, [pl]))[0]!.n as number;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = crypto.randomUUID();
    ADV = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261011000700_lc_inventory_import_source_hardening.sql"));
  });

  it("danışman csv ile 2 kez 'var' gönderse de şüpheli ilanda sinyal kapanmaz; anomaliye tek 'escalated' adımı düşer", async () => {
    await as("advisor");
    const { PL, A } = await mkListing("suspect", true);
    const r1 = await run("mine", "csv", present(PL));
    const r2 = await run("mine", "csv", present(PL));
    expect(r1).toMatchObject({ outcome: "ok", observations_applied: 0, observations_held: 1 });
    expect(r2).toMatchObject({ observations_applied: 0, observations_held: 1 });
    expect(await applied(PL)).toBe(0);
    const acts = await q(`select action from public.listing_anomaly_actions where anomaly_id = $1`, [A]);
    expect(acts).toEqual([{ action: "escalated" }]);
    expect((await q(`select status from public.listing_anomalies where id = $1`, [A]))[0]!.status).toBe("open");
  });

  it("durum unverifiable/paused olsa da açık portal_missing anomalisi varsa tutulur", async () => {
    await as("advisor");
    for (const state of ["unverifiable", "paused"]) {
      const { PL } = await mkListing(state, true);
      const r = await run("mine", "paste", present(PL));
      expect(r).toMatchObject({ observations_applied: 0, observations_held: 1 });
      expect(await applied(PL)).toBe(0);
    }
  });

  it("eklenti kaynağı da scope='mine' iken aynı kurala tabidir (tutarlı karar)", async () => {
    await as("advisor");
    const { PL } = await mkListing("probable_missing", true);
    expect(await run("mine", "extension", present(PL))).toMatchObject({ observations_applied: 0, observations_held: 1 });
  });

  it("açık kayıp sinyali yoksa 'var' gözlemi normal uygulanır ('assisted' kaynak)", async () => {
    await as("advisor");
    const { PL } = await mkListing("present", false);
    expect(await run("mine", "csv", present(PL))).toMatchObject({ observations_applied: 1, observations_held: 0 });
    expect((await q(`select source_kind from public.applied_log where portal_listing_id = $1`, [PL]))[0]!.source_kind).toBe("assisted");
  });

  it("ofis geneli (yönetim) 'var' gözlemi tutulmaz ve otoriter 'csv' sayılır", async () => {
    await as("gm");
    const { PL } = await mkListing("suspect", true);
    expect(await run("office", "csv", present(PL))).toMatchObject({ observations_applied: 1, observations_held: 0 });
    expect((await q(`select source_kind from public.applied_log where portal_listing_id = $1`, [PL]))[0]!.source_kind).toBe("csv");
  });
});
