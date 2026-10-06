import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000610 — kayıplı kapanış → 'closure_loss' anomalisi (tek kaynak), uzlaştırma,
 * düzeltmede false_positive, motorun eşitlediği türlere dokunulmaması, rollback. Şema sadeleştirilmiş taklittir.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, assigned_to uuid, unique (id, tenant_id));
create table public.portal_listings(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid);
create table public.listing_closures(id uuid primary key default gen_random_uuid(), tenant_id uuid, portal_listing_id uuid, reason text not null,
  deal_happened boolean, deal_amount numeric, closed_by_us boolean, competitor_closed boolean, estimated_lost_commission numeric,
  created_by uuid, created_at timestamptz not null default now());
create table public.listing_anomalies (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, portal_listing_id uuid,
  type text not null check (type in ('portal_missing', 'not_published', 'unregistered_listing', 'bulk_mismatch', 'price_mismatch', 'advisor_mismatch',
     'duplicate', 'potential_lost_deal', 'sold_still_listed', 'incomplete_closure', 'authority_expiring')),
  severity text not null default 'medium', status text not null default 'open', dedupe_key text not null,
  branch_id uuid, team_id uuid, advisor_id uuid, assignee_id uuid, risk_score smallint, risk_points jsonb not null default '[]',
  details jsonb not null default '{}', first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  sla_stage smallint not null default 0, sla_due_at timestamptz, explained_reason_code text, explained_note text, explained_by uuid,
  explained_at timestamptz, resolved_at timestamptz, created_at timestamptz not null default now(), unique (tenant_id, dedupe_key));
create table public.listing_anomaly_actions(id uuid primary key default gen_random_uuid(), tenant_id uuid, anomaly_id uuid, action text, note text,
  created_at timestamptz default now());
`;

describe.skipIf(!mod)("kapanış kaybı → anomali (pglite)", () => {
  let db: Db;
  let T: string;
  let PL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const A = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    const P = (await q(`insert into public.properties(tenant_id, assigned_to) values ($1, $2) returning id`, [T, A]))[0]!.id as string;
    PL = (await q(`insert into public.portal_listings(tenant_id, property_id) values ($1, $2) returning id`, [T, P]))[0]!.id as string;
    // Migration ÖNCESİ kayıplı kapanış (uzlaştırma taşımalı) + kayıpsız kapanış (taşımamalı)
    await q(`insert into public.listing_closures(tenant_id, portal_listing_id, reason, competitor_closed, estimated_lost_commission) values ($1,$2,'Rakip sattı', true, 60000)`, [T, PL]);
    await q(`insert into public.listing_closures(tenant_id, portal_listing_id, reason, closed_by_us, estimated_lost_commission) values ($1,$2,'Biz sattık', true, 0)`, [T, PL]);
    await db.exec(read("supabase/migrations/20261007000610_closure_loss_anomalies.sql"));
  });

  it("uzlaştırma: yalnız kayıplı kapanış 'closure_loss' olur, açıklanmış durumda (SLA yok), kapsam portföyden", async () => {
    const rows = await q(`select type, status, severity, advisor_id is not null as has_adv, details->>'estimated_lost_commission' as amt from public.listing_anomalies`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "closure_loss", status: "explained", severity: "high", has_adv: true, amt: "60000" });
  });

  it("yeni kayıplı kapanış tetikleyiciyle anında anomali olur; kayıp sıfırlanırsa false_positive", async () => {
    const id = (await q(`insert into public.listing_closures(tenant_id, portal_listing_id, reason, deal_happened, closed_by_us, estimated_lost_commission) values ($1,$2,'Malik başka ofisle sattı', true, false, 150000) returning id`, [T, PL]))[0]!.id as string;
    const a = await q(`select status, severity from public.listing_anomalies where dedupe_key = $1`, [`closure_loss:${id}`]);
    expect(a[0]).toMatchObject({ status: "explained", severity: "critical" });
    await q(`update public.listing_closures set estimated_lost_commission = 0, closed_by_us = true where id = $1`, [id]);
    expect((await q(`select status from public.listing_anomalies where dedupe_key = $1`, [`closure_loss:${id}`]))[0]!.status).toBe("false_positive");
  });

  it("uzlaştırma tekrar çalıştırılabilir (çift kayıt yok); rollback closure_loss satırlarını siler", async () => {
    await db.exec(read("supabase/migrations/20261007000610_closure_loss_anomalies.sql"));
    expect((await q(`select count(*)::int n from public.listing_anomalies where type = 'closure_loss'`))[0]!.n).toBe(2);
    await db.exec(read("supabase/rollbacks/20261007000610_closure_loss_anomalies.rollback.sql"));
    expect((await q(`select count(*)::int n from public.listing_anomalies`))[0]!.n).toBe(0);
    await expect(q(`insert into public.listing_anomalies(tenant_id, property_id, type, dedupe_key) values ($1, gen_random_uuid(), 'closure_loss', 'x')`, [T])).rejects.toThrow();
  });
});
