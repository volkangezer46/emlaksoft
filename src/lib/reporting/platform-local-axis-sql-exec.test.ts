import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016060400_tenant_is_internal + 20261016060500_platform_reporting_local_axis.
 *  - B178: iç/test/demo ofis (is_internal) MRR'a, plan satırlarına, ofis sayılarına ve benimsemeye girmez; bayrağı yalnız sunucu değiştirir.
 *  - B110: MRR = aktif aboneliklerin amount_try toplamı; aboneliği eksik aktif ofis ayrı sayaçta (MRR'a 0 ekler).
 *  - B110: mrr_trend = her TR ayının SON anlık görüntü günü (iç ofis hariç); anlık görüntüsü olmayan ay satır üretmez.
 *  - Yerel eksen: p_from/p_to ve ay sınırları Europe/Istanbul (TR 1 Eki 00:30 = UTC 30 Eyl 21:30 Ekim'e düşer).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text, plan text, status text,
  trial_ends_at timestamptz, created_at timestamptz not null default now());
create table public.subscriptions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  plan text, status text, amount_try numeric, created_at timestamptz not null default now());
create table public.support_tickets(id uuid primary key default gen_random_uuid(), status text, priority text, created_at timestamptz not null default now());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.demo_requests(id uuid primary key default gen_random_uuid(), status text);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, action text, created_at timestamptz not null default now());
create table public.platform_mrr_daily(day date not null, tenant_id uuid not null references public.tenants(id), subscription_id uuid,
  plan_id text, mrr_try numeric not null default 0, status text, primary key (day, tenant_id));
grant usage on schema public to authenticated, service_role;
grant usage on schema auth to authenticated, service_role;
grant select, update on public.tenants to authenticated;
`;

type Agg = {
  summary: Record<string, number>;
  plan_stats: { plan: string; active_count: number; subscription_count: number; subscription_mrr: number }[];
  mrr_trend: { ym: string; snap_day: string; month_start: string; subscription_mrr: number; professional_count: number }[];
  weekly: { week_start: string; tenants: number }[];
  top_tenants: { name: string }[];
  adoption: { module: string; offices: number }[];
  all_tenant_count: number;
};

describe.skipIf(!mod)("platform toplulaştırması: iç ofis hariç, anlık görüntü eğrisi, yerel eksen (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const asRole = async (role: "service_role" | "authenticated") => {
    await db.exec(`reset role; select set_config('request.jwt.claim.role','${role}',false)`);
    await db.exec(`set role ${role}`);
  };
  const agg = async (asOf: string, from: string | null = null, to: string | null = null) => {
    await asRole("service_role");
    const r = (await q(`select public.platform_reporting_aggregates($1::date, $2::date, $3::timestamptz) as r`, [from, to, asOf]))[0]!.r as Agg;
    await db.exec(`reset role`);
    return r;
  };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    const tenant = async (slug: string, plan: string, status: string, createdAt: string) =>
      (ids[slug] = (await q(`insert into public.tenants(slug, name, plan, status, created_at) values ($1, $1, $2, $3, $4) returning id`, [slug, plan, status, createdAt]))[0]!.id as string);
    await tenant("gezertasar-emlak", "professional", "active", "2026-07-21T10:00:00Z");
    await tenant("demo-ofis", "professional", "active", "2026-07-25T10:00:00Z");
    await tenant("e2e-test", "professional", "active", "2026-07-26T10:00:00Z");
    await tenant("admin", "office", "suspended", "2026-07-25T10:00:00Z");
    await tenant("aboneliksiz-gercek", "office", "active", "2026-08-10T10:00:00Z");
    // TR 1 Eki 00:30 = UTC 30 Eyl 21:30: yerel eksende Ekim'e düşer.
    await tenant("ekim-ilk-saat", "advisor", "trial", "2026-09-30T21:30:00Z");
    const sub = (slug: string, plan: string, status: string, amount: number) =>
      q(`insert into public.subscriptions(tenant_id, plan, status, amount_try, created_at) values ($1, $2, $3, $4, '2026-08-01T00:00:00Z')`, [ids[slug], plan, status, amount]);
    await sub("gezertasar-emlak", "professional", "active", 5990);
    await sub("demo-ofis", "professional", "active", 5990);
    await sub("admin", "office", "paused", 2490);
    // Gizli/yeni paket: eski 4 sabit planlı eksende MRR'dan sessizce düşerdi.
    await q(`insert into public.tenants(slug, name, plan, status, created_at) values ('business-ofis', 'B', 'business', 'active', '2026-08-02T00:00:00Z')`);
    ids["business-ofis"] = (await q(`select id from public.tenants where slug = 'business-ofis'`))[0]!.id as string;
    await sub("business-ofis", "business", "active", 9990);
    await q(`insert into public.audit_logs(tenant_id, action, created_at) values ($1, 'customer.create', '2026-10-10T10:00:00Z'), ($2, 'customer.create', '2026-10-10T10:00:00Z')`,
      [ids["gezertasar-emlak"], ids["demo-ofis"]]);
    await q(`insert into public.profiles(tenant_id) values ($1), ($2), (null)`, [ids["gezertasar-emlak"], ids["e2e-test"]]);
    // Anlık görüntüler: Eylül'de iki gün (son gün 30 Eyl kullanılır), Ekim'de bayraktan önce yazılmış iç ofis satırlarıyla.
    const snap = (day: string, slug: string, plan: string, mrr: number) =>
      q(`insert into public.platform_mrr_daily(day, tenant_id, plan_id, mrr_try) values ($1, $2, $3, $4)`, [day, ids[slug], plan, mrr]);
    await snap("2026-09-28", "gezertasar-emlak", "professional", 4990);
    await snap("2026-09-30", "gezertasar-emlak", "professional", 5990);
    await snap("2026-09-30", "e2e-test", "professional", 5490);
    await snap("2026-10-14", "gezertasar-emlak", "professional", 5990);
    await snap("2026-10-14", "demo-ofis", "professional", 5990);
    await snap("2026-10-14", "e2e-test", "professional", 5490);
    await snap("2026-10-14", "business-ofis", "business", 9990);
    await db.exec(read("supabase/migrations/20261016060400_tenant_is_internal.sql"));
    await db.exec(read("supabase/migrations/20261016060500_platform_reporting_local_axis.sql"));
  });

  it("migration iç ofisleri işaretler; gerçek ofislere dokunmaz ve tekrar uygulanabilir", async () => {
    await db.exec(read("supabase/migrations/20261016060400_tenant_is_internal.sql"));
    const rows = await q(`select slug, is_internal from public.tenants order by slug`);
    const internal = rows.filter((r) => r.is_internal).map((r) => r.slug);
    expect(internal.sort()).toEqual(["admin", "demo-ofis", "e2e-test"]);
  });

  it("MRR = iç olmayan aktif aboneliklerin toplamı; aboneliği eksik ofis ayrı sayaçta", async () => {
    const r = await agg("2026-10-15T09:00:00Z");
    expect(Number(r.summary.subscription_mrr)).toBe(5990 + 9990);
    expect(r.plan_stats.reduce((n, p) => n + Number(p.subscription_mrr), 0)).toBe(5990 + 9990);
    expect(r.plan_stats.find((p) => p.plan === "business")).toMatchObject({ subscription_count: 1 });
    expect(Number(r.summary.missing_subscription_count)).toBe(1); // aboneliksiz-gercek (e2e-test iç ofis)
    expect(Number(r.summary.internal_count)).toBe(3);
    expect(Number(r.summary.active_count)).toBe(3); // gezertasar, aboneliksiz-gercek, business-ofis
    expect(Number(r.all_tenant_count)).toBe(4);
    expect(Number(r.summary.member_count)).toBe(2); // e2e-test üyesi hariç, ofissiz personel dahil
    expect(r.top_tenants.map((t) => t.name)).not.toContain("demo-ofis");
    expect(r.adoption).toEqual([{ module: "customers", offices: 1 }]);
  });

  it("mrr_trend: her ayın SON anlık görüntü günü, iç ofis hariç; anlık görüntüsüz ay satır üretmez", async () => {
    const r = await agg("2026-10-15T09:00:00Z");
    expect(r.mrr_trend.map((m) => m.ym)).toEqual(["2026-09", "2026-10"]);
    const [sep, oct] = r.mrr_trend;
    expect(sep).toMatchObject({ snap_day: "2026-09-30", professional_count: 1 });
    expect(Number(sep!.subscription_mrr)).toBe(5990);
    expect(Number(oct!.subscription_mrr)).toBe(5990 + 9990);
    // Ay başı TR gece yarısı (UTC 21:00 önceki gün).
    expect(new Date(oct!.month_start).toISOString()).toBe("2026-09-30T21:00:00.000Z");
  });

  it("yerel eksen: p_from/p_to TR günü; ayın ilk saatleri önceki aya düşmez", async () => {
    const oct = await agg("2026-10-15T09:00:00Z", "2026-10-01", "2026-10-31");
    expect(Number(oct.summary.tenant_count)).toBe(1);
    expect(Number(oct.summary.trial_count)).toBe(1);
    const sep = await agg("2026-10-15T09:00:00Z", "2026-09-01", "2026-09-30");
    expect(Number(sep.summary.tenant_count)).toBe(0);
    // Hafta ekseni TR Pazartesi 00:00.
    const r = await agg("2026-10-15T09:00:00Z");
    expect(new Date(r.weekly.at(-1)!.week_start).toISOString()).toBe("2026-10-11T21:00:00.000Z");
    expect(r.weekly.length).toBe(8);
  });

  it("yalnız service_role çağırır", async () => {
    await asRole("authenticated");
    await expect(q(`select public.platform_reporting_aggregates(null, null, now())`)).rejects.toThrow();
    await db.exec(`reset role`);
  });

  it("is_internal bayrağını ofis kullanıcısı değiştiremez; sunucu yolu değiştirir", async () => {
    await asRole("authenticated");
    await expect(q(`update public.tenants set is_internal = true where slug = 'aboneliksiz-gercek'`)).rejects.toThrow(/sunucu yolundan/);
    // Bayrağa dokunmayan güncelleme serbest.
    await q(`update public.tenants set name = 'Yeni ad' where slug = 'aboneliksiz-gercek'`);
    await db.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false)`);
    await q(`update public.tenants set is_internal = false where slug = 'admin'`);
    expect((await q(`select is_internal from public.tenants where slug = 'admin'`))[0]!.is_internal).toBe(false);
    await q(`update public.tenants set is_internal = true where slug = 'admin'`);
  });
});
