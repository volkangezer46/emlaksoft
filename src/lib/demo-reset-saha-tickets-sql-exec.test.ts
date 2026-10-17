import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * 20261027010300 — demo gece sıfırlaması: [SAHA] destek talepleri + bayat demo oturumları. Gerçek PL/pgSQL (pglite):
 * 20261015041000 → 20261016150301 → 20261024020200 → 20261026010100 → 20261027010300. Kanıtlanan:
 *  - demo_saha_columns support_tickets:subject içerir; kuru sayım ("[SAHA] kalıntısı") talepleri sayar;
 *  - gece sıfırlaması [SAHA] talebini ve çocuklarını (mesaj, olay, SLA uyarısı) siler; gerçek talep ve gerçek ofis kalır;
 *  - demo ofis kullanıcısının 12 saattir etkinliği olmayan oturumu (ve 2FA kaydı) silinir; etkin oturum, personel ve
 *    gerçek ofis oturumu kalır;
 *  - geri alma eski listeye döner.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text);
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, created_at timestamptz default now());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text);
create table public.platform_staff(id uuid primary key);
create table public.support_tickets(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, subject text not null,
  merged_into_id uuid references public.support_tickets(id) on delete set null, created_at timestamptz default now());
create table public.support_ticket_messages(id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id) on delete cascade, body text);
create table public.support_ticket_events(id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id) on delete cascade);
create table public.support_ticket_sla_alerts(id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id) on delete cascade);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz default now(),
  updated_at timestamptz default now(), refreshed_at timestamp);
create table public.two_factor_verified_sessions(session_id text not null, user_id uuid not null);
`;

const CHAIN = [
  "supabase/migrations/20261015041000_demo_tenant_nightly_reset.sql",
  "supabase/migrations/20261016150301_demo_reset_notification_reads.sql",
  "supabase/migrations/20261024020200_demo_tenant_pristine_reset.sql",
  "supabase/migrations/20261026010100_demo_reset_records_tables.sql",
  "supabase/migrations/20261027010300_demo_reset_saha_tickets_sessions.sql",
];

const NIGHT = "2026-10-28T03:37:00Z";

describe.skipIf(!mod)("demo sıfırlama — [SAHA] destek talepleri + bayat demo oturumları (pglite)", () => {
  let db: Db;
  let DEMO: string;
  let REAL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const n = async (sql: string, params?: unknown[]) => Number((await one(sql, params)).n);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    for (const f of CHAIN) await db.exec(read(f));
    DEMO = String((await one(`insert into public.tenants(slug, name) values ('demo-ofis', 'Demo Emlak Ofisi') returning id`)).id);
    REAL = String((await one(`insert into public.tenants(slug, name) values ('gercek', 'Gerçek') returning id`)).id);
  });

  it("demo_saha_columns destek talebi konusunu kapsar", async () => {
    const cols = (await one(`select public.demo_saha_columns() c`)).c as string[];
    expect(cols).toContain("support_tickets:subject");
    expect(cols).toContain("customers:full_name");
  });

  it("[SAHA] talebi ve çocukları silinir; gerçek talep ve gerçek ofisin [SAHA] talebi kalır; kuru sayım sayar", async () => {
    const saha = String((await one(`insert into public.support_tickets(tenant_id, subject) values ($1, '[SAHA] ui-admin-paneli veri gelişi') returning id`, [DEMO])).id);
    await q(`insert into public.support_ticket_messages(ticket_id, body) values ($1, 'x')`, [saha]);
    await q(`insert into public.support_ticket_events(ticket_id) values ($1)`, [saha]);
    await q(`insert into public.support_ticket_sla_alerts(ticket_id) values ($1)`, [saha]);
    await q(`insert into public.support_tickets(tenant_id, subject) values ($1, 'Fatura sorusu')`, [DEMO]);
    await q(`insert into public.support_tickets(tenant_id, subject) values ($1, '[SAHA] gerçek ofiste kalmalı')`, [REAL]);

    const dry = (await one(`select public.demo_tenant_saha_cleanup($1, now(), true) r`, [DEMO])).r as { total: number; tables: Record<string, number> };
    expect(dry.tables).toMatchObject({ support_tickets: 1 });

    const r = (await one(`select public.demo_tenant_nightly_reset($1, $2::timestamptz) r`, [DEMO, NIGHT])).r as { deleted: Record<string, unknown>; skipped: Record<string, string> };
    expect(r.skipped).toEqual({});
    expect(r.deleted).toMatchObject({ saha: { support_tickets: 1 } });
    expect(await n(`select count(*)::int n from public.support_tickets where tenant_id = $1 and subject like '[SAHA]%'`, [DEMO])).toBe(0);
    expect(await n(`select count(*)::int n from public.support_tickets where tenant_id = $1`, [DEMO])).toBe(1);
    expect(await n(`select count(*)::int n from public.support_ticket_messages`)).toBe(0);
    expect(await n(`select count(*)::int n from public.support_ticket_sla_alerts`)).toBe(0);
    expect(await n(`select count(*)::int n from public.support_tickets where tenant_id = $1`, [REAL])).toBe(1);
  });

  it("bayat demo oturumu ve 2FA kaydı silinir; etkin oturum, personel ve gerçek ofis oturumu kalır", async () => {
    const demoUser = String((await one(`insert into public.profiles(tenant_id, full_name) values ($1, 'Demo Danışman') returning id`, [DEMO])).id);
    const staffWithProfile = String((await one(`insert into public.profiles(tenant_id, full_name) values ($1, 'Personel') returning id`, [DEMO])).id);
    await q(`insert into public.platform_staff(id) values ($1)`, [staffWithProfile]);
    const realUser = String((await one(`insert into public.profiles(tenant_id, full_name) values ($1, 'Gerçek') returning id`, [REAL])).id);
    const old = "2026-10-27T10:00:00Z"; // 17 saat önce
    const fresh = "2026-10-28T01:00:00Z"; // 2,5 saat önce
    const stale = String((await one(`insert into auth.sessions(user_id, created_at, updated_at, refreshed_at) values ($1, $2, $2, $2::timestamptz at time zone 'UTC') returning id`, [demoUser, old])).id);
    await q(`insert into public.two_factor_verified_sessions(session_id, user_id) values ($1, $2)`, [stale, demoUser]);
    await q(`insert into auth.sessions(user_id, created_at, updated_at, refreshed_at) values ($1, $2, $3, $3::timestamptz at time zone 'UTC')`, [demoUser, old, fresh]);
    await q(`insert into auth.sessions(user_id, created_at, updated_at) values ($1, $2, $2)`, [staffWithProfile, old]);
    await q(`insert into auth.sessions(user_id, created_at, updated_at) values ($1, $2, $2)`, [realUser, old]);

    const r = (await one(`select public.demo_tenant_nightly_reset($1, $2::timestamptz) r`, [DEMO, NIGHT])).r as { deleted: Record<string, unknown> };
    expect(r.deleted).toMatchObject({ auth_sessions: 1 });
    expect(await n(`select count(*)::int n from auth.sessions where id = $1`, [stale])).toBe(0);
    expect(await n(`select count(*)::int n from public.two_factor_verified_sessions`)).toBe(0);
    expect(await n(`select count(*)::int n from auth.sessions where user_id = $1`, [demoUser])).toBe(1);
    expect(await n(`select count(*)::int n from auth.sessions where user_id = $1`, [staffWithProfile])).toBe(1);
    expect(await n(`select count(*)::int n from auth.sessions where user_id = $1`, [realUser])).toBe(1);
  });

  it("geri alma eski listeye döner", async () => {
    await db.exec(read("supabase/rollbacks/20261027010300_demo_reset_saha_tickets_sessions.rollback.sql"));
    const cols = (await one(`select public.demo_saha_columns() c`)).c as string[];
    expect(cols).not.toContain("support_tickets:subject");
  });
});
