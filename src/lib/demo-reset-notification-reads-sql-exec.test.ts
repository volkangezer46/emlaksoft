import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * M3 — demo gece sıfırlaması bildirim okunma izlerini (notification_reads) da siler. Gerçek PL/pgSQL (pglite):
 * 20261015041000 + 20261016150301 sırayla uygulanır. Kanıtlanan: demo kiracının okunma satırları silinir (tohum bildirimi
 * yeniden okunmamış görünür), gerçek kiracınınki kalır; tablo yokken adım atlanır; geri alma eski gövdeye döner.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text);
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, created_at timestamptz default now());
`;
const READS = `
create table public.notification_reads(
  tenant_id uuid not null, notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null, read_at timestamptz not null default now(), primary key (notification_id, user_id));
`;

const BASE = "2026-10-01T00:00:00Z";
const LATER = "2026-10-05T03:37:00Z";

describe.skipIf(!mod)("demo gece sıfırlaması — notification_reads (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const reset = async (tenant: string, at: string) =>
    (await q(`select public.demo_tenant_nightly_reset($1::uuid, $2::timestamptz) r`, [tenant, at]))[0]!.r as {
      deleted: Record<string, number>;
      skipped: Record<string, string>;
    };
  const reads = async (tenant: string) => Number((await q(`select count(*)::int n from public.notification_reads where tenant_id = $1`, [tenant]))[0]!.n);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261015041000_demo_tenant_nightly_reset.sql"));
    await db.exec(read("supabase/migrations/20261016150301_demo_reset_notification_reads.sql"));
  });

  it("notification_reads tablosu yokken adım atlanır, sıfırlama çalışır", async () => {
    const demo = (await q(`insert into public.tenants(slug) values ('demo-ofis') returning id`))[0]!.id as string;
    const r = await reset(demo, BASE);
    expect(r.skipped).toEqual({});
    expect(r.deleted).toEqual({});
    await q(`delete from public.demo_reset_state`);
    await q(`delete from public.tenants`);
  });

  it("demo kiracının tohum bildirimi okunma izi silinir; gerçek kiracınınki kalır", async () => {
    await db.exec(READS);
    const demo = (await q(`insert into public.tenants(slug) values ('demo-ofis') returning id`))[0]!.id as string;
    const real = (await q(`insert into public.tenants(slug) values ('gercek-ofis') returning id`))[0]!.id as string;
    await reset(demo, BASE); // taban
    const user = "00000000-0000-4000-8000-000000000001";
    for (const t of [demo, real]) {
      const n = (await q(`insert into public.notifications(tenant_id, title, created_at) values ($1, 'Tohum', '2026-09-01') returning id`, [t]))[0]!.id;
      await q(`insert into public.notification_reads(tenant_id, notification_id, user_id, read_at) values ($1, $2, $3, '2026-10-03')`, [t, n, user]);
    }
    await expect(q(`select public.demo_tenant_nightly_reset($1::uuid, $2::timestamptz)`, [real, LATER])).rejects.toThrow(/demo_reset_not_demo_tenant/);
    expect(await reads(real)).toBe(1);

    const r = await reset(demo, LATER);
    expect(r.skipped).toEqual({});
    expect(r.deleted).toEqual({ notification_reads: 1 });
    expect(await reads(demo)).toBe(0);
    expect(Number((await q(`select count(*)::int n from public.notifications where tenant_id = $1`, [demo]))[0]!.n)).toBe(1);
    expect(await reads(real)).toBe(1);
  });

  it("geri alma eski gövdeye döner: okunma izi artık silinmez", async () => {
    await db.exec(read("supabase/rollbacks/20261016150301_demo_reset_notification_reads.rollback.sql"));
    const demo = (await q(`select id from public.tenants where slug = 'demo-ofis'`))[0]!.id as string;
    const n = (await q(`select id from public.notifications where tenant_id = $1`, [demo]))[0]!.id;
    await q(`insert into public.notification_reads(tenant_id, notification_id, user_id, read_at) values ($1, $2, '00000000-0000-4000-8000-000000000002', '2026-10-04')`, [demo, n]);
    const r = await reset(demo, LATER);
    expect(r.deleted).toEqual({});
    expect(await reads(demo)).toBe(1);
  });
});
