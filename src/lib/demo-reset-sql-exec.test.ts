import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { runDemoNightlyReset } from "@/lib/demo-reset";

/**
 * YD1 demo gece sıfırlaması — İŞLEVSEL SQL TESTİ (pglite, migration 20261015041000 gerçek PL/pgSQL ile). Şema sadeleştirilmiş
 * taklittir (tenants/customers/properties/deals/calls/referrals/surveys/notifications/api_keys/webhook_endpoints). Kanıtlanan: (1) gerçek kiracı
 * kimliğiyle çağrı HATA verir ve hiçbir satıra dokunmaz; (2) demo kiracıda yalnız tabandan SONRA eklenen iş kayıtları ve
 * dış bağlantı yüzeyleri silinir; tohum, gelecek tarihli tohum ve başka kiracının satırları kalır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, created_at timestamptz default now());
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, owner_customer_id uuid references public.customers(id) on delete set null, created_at timestamptz default now());
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id), customer_id uuid references public.customers(id), created_at timestamptz default now());
-- created_at'i olmayan, NO ACTION FK'li bağımlılar (canlıdaki gibi)
create table public.calls(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id));
create table public.referrals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, referrer_customer_id uuid references public.customers(id), created_customer_id uuid references public.customers(id), created_at timestamptz default now());
create table public.surveys(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid references public.deals(id), customer_id uuid references public.customers(id));
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, created_at timestamptz default now());
create table public.api_keys(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text, created_at timestamptz default now());
create table public.webhook_endpoints(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, url text, created_at timestamptz default now());
create table public.webhook_deliveries(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, endpoint_id uuid references public.webhook_endpoints(id) on delete cascade, created_at timestamptz default now());
`;

const BASE = "2026-10-01T00:00:00Z";
const LATER = "2026-10-05T03:37:00Z";

describe.skipIf(!mod)("demo gece sıfırlaması — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  let DEMO: string;
  let REAL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const count = async (table: string, tenant: string) => Number((await q(`select count(*)::int n from public.${table} where tenant_id = $1`, [tenant]))[0]!.n);
  const reset = (tenant: string, at: string) => q(`select public.demo_tenant_nightly_reset($1::uuid, $2::timestamptz) r`, [tenant, at]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261015041000_demo_tenant_nightly_reset.sql"));
    DEMO = (await q(`insert into public.tenants(slug, name) values ('demo-ofis', 'Demo Emlak Ofisi') returning id`))[0]!.id as string;
    REAL = (await q(`insert into public.tenants(slug, name) values ('gercek-ofis', 'Demo Emlak') returning id`))[0]!.id as string;
    // Tohum (tabandan önce) — her iki kiracıda
    for (const t of [DEMO, REAL]) {
      const c = (await q(`insert into public.customers(tenant_id, full_name, created_at) values ($1, 'Tohum', '2026-09-01') returning id`, [t]))[0]!.id;
      const p = (await q(`insert into public.properties(tenant_id, title, owner_customer_id, created_at) values ($1, 'Tohum ilan', $2, '2026-09-01') returning id`, [t, c]))[0]!.id;
      await q(`insert into public.deals(tenant_id, property_id, customer_id, created_at) values ($1, $2, $3, '2026-09-02')`, [t, p, c]);
    }
    // Gelecek tarihli tohum (eski seed kalıntısı) — silinmemeli
    await q(`insert into public.properties(tenant_id, title, created_at) values ($1, 'Gelecek tarihli tohum', '2026-12-17')`, [DEMO]);
  });

  it("gerçek kiracı kimliğiyle çağrı reddedilir ve hiçbir satıra dokunmaz", async () => {
    await q(`insert into public.api_keys(tenant_id, name) values ($1, 'gercek anahtar')`, [REAL]);
    const before = await Promise.all(["customers", "properties", "deals", "api_keys"].map((t) => count(t, REAL)));
    await expect(reset(REAL, LATER)).rejects.toThrow(/demo_reset_not_demo_tenant/);
    const after = await Promise.all(["customers", "properties", "deals", "api_keys"].map((t) => count(t, REAL)));
    expect(after).toEqual(before);
    expect((await q(`select count(*)::int n from public.demo_reset_state`))[0]!.n).toBe(0);
  });

  it("ilk çağrı tabanı yazar; tohum silinmez, dış bağlantı yüzeyi silinir", async () => {
    await q(`insert into public.api_keys(tenant_id, name) values ($1, 'ziyaretçi anahtarı')`, [DEMO]);
    const r = (await reset(DEMO, BASE))[0]!.r as { baseline_at: string; deleted: Record<string, number> };
    expect(new Date(r.baseline_at).toISOString()).toBe(new Date(BASE).toISOString());
    expect(r.deleted).toEqual({ api_keys: 1 });
    expect(await count("customers", DEMO)).toBe(1);
    expect(await count("properties", DEMO)).toBe(2);
  });

  it("sonraki gece: tabandan sonra eklenen ziyaretçi kayıtları silinir; tohum, gelecek tarihli ve gerçek kiracı kalır", async () => {
    // Ziyaretçi eklemeleri (tabandan sonra) — demo ve gerçek kiracıda
    for (const t of [DEMO, REAL]) {
      const c = (await q(`insert into public.customers(tenant_id, full_name, created_at) values ($1, 'Ziyaretçi', '2026-10-03') returning id`, [t]))[0]!.id;
      const p = (await q(`insert into public.properties(tenant_id, title, owner_customer_id, created_at) values ($1, 'Ziyaretçi ilanı', $2, '2026-10-03') returning id`, [t, c]))[0]!.id;
      const seedProp = (await q(`select id from public.properties where tenant_id = $1 and title = 'Tohum ilan'`, [t]))[0]!.id;
      // Ziyaretçi anlaşması TOHUM portföye bağlı (FK no action): önce anlaşma silinmeli
      await q(`insert into public.deals(tenant_id, property_id, customer_id, created_at) values ($1, $2, $3, '2026-10-04')`, [t, seedProp, c]);
      const d = (await q(`insert into public.deals(tenant_id, property_id, created_at) values ($1, $2, '2026-10-04') returning id`, [t, p]))[0]!.id;
      // NO ACTION bağımlılar: bunlar silinmezse customers/deals silmesi her gece engellenirdi
      await q(`insert into public.calls(tenant_id, customer_id) values ($1, $2)`, [t, c]);
      await q(`insert into public.surveys(tenant_id, deal_id) values ($1, $2)`, [t, d]);
      const seedCust = (await q(`select id from public.customers where tenant_id = $1 and full_name = 'Tohum'`, [t]))[0]!.id;
      await q(`insert into public.referrals(tenant_id, referrer_customer_id, created_customer_id, created_at) values ($1, $2, $3, '2026-09-01')`, [t, seedCust, c]);
      await q(`insert into public.notifications(tenant_id, title, created_at) values ($1, 'gürültü', '2026-10-04')`, [t]);
    }
    const ep = (await q(`insert into public.webhook_endpoints(tenant_id, url, created_at) values ($1, 'https://ornek.com', '2026-09-01') returning id`, [DEMO]))[0]!.id;
    await q(`insert into public.webhook_deliveries(tenant_id, endpoint_id) values ($1, $2)`, [DEMO, ep]);
    // Tohum müşteriye bağlı tohum araması kalmalı
    const seedCustDemo = (await q(`select id from public.customers where tenant_id = $1 and full_name = 'Tohum'`, [DEMO]))[0]!.id;
    await q(`insert into public.calls(tenant_id, customer_id) values ($1, $2)`, [DEMO, seedCustDemo]);
    const realBefore = await Promise.all(["customers", "properties", "deals", "notifications", "api_keys", "calls", "surveys", "referrals"].map((t) => count(t, REAL)));

    const r = (await reset(DEMO, LATER))[0]!.r as { deleted: Record<string, number>; skipped: Record<string, string> };
    expect(r.skipped).toEqual({});
    expect(r.deleted).toMatchObject({ customers: 1, properties: 1, deals: 2, notifications: 1, webhook_endpoints: 1, webhook_deliveries: 1, calls: 1, surveys: 1, referrals: 1 });
    expect(await count("calls", DEMO)).toBe(1);
    expect(await count("surveys", DEMO)).toBe(0);
    expect(await count("referrals", DEMO)).toBe(0);

    expect((await q(`select title from public.properties where tenant_id = $1 order by title`, [DEMO])).map((x) => x.title)).toEqual([
      "Gelecek tarihli tohum",
      "Tohum ilan",
    ]);
    expect(await count("customers", DEMO)).toBe(1);
    expect(await count("deals", DEMO)).toBe(1);
    expect(await count("notifications", DEMO)).toBe(0);
    // Gerçek kiracı: hiçbir satır değişmedi
    const realAfter = await Promise.all(["customers", "properties", "deals", "notifications", "api_keys", "calls", "surveys", "referrals"].map((t) => count(t, REAL)));
    expect(realAfter).toEqual(realBefore);
  });

  it("TS adımı: demo slug'ı dışındaki satırı RPC'ye hiç göndermez", async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const fake = {
      from: () => ({ select: () => ({ in: async () => ({ data: [{ id: REAL, slug: "gercek-ofis" }, { id: DEMO, slug: "demo-ofis" }], error: null }) }) }),
      rpc,
    };
    const out = await runDemoNightlyReset(fake as never, { nowMs: Date.parse(LATER) });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("demo_tenant_nightly_reset", { p_tenant_id: DEMO, p_now: new Date(LATER).toISOString() });
    expect(out).toEqual({ tenants: 1, results: { "demo-ofis": { ok: true } } });
  });

  it("TS adımı: fonksiyon yoksa atlanır, demo kiracı yoksa hiç çağrılmaz", async () => {
    const missing = {
      from: () => ({ select: () => ({ in: async () => ({ data: [{ id: DEMO, slug: "demo-ofis" }], error: null }) }) }),
      rpc: async () => ({ data: null, error: { code: "PGRST202" } }),
    };
    expect(await runDemoNightlyReset(missing as never, { nowMs: 0 })).toEqual({ skipped: "not_installed" });
    const rpc = vi.fn();
    const none = { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }), rpc };
    expect(await runDemoNightlyReset(none as never, { nowMs: 0 })).toEqual({ skipped: "no_demo_tenant" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
