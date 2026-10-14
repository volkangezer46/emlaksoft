import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";
import { computeProfileCompletion, type ProfileFacts } from "@/lib/profile-completion";
import type { ProfileSnapshot } from "@/lib/profile-completion-data";
import { EMPTY_ONBOARDING_CONTENT } from "@/lib/onboarding-content";
import {
  composeOnboardingSnapshot,
  loadOnboardingRawLegacy,
  loadOnboardingRawRpc,
  parseOnboardingRpc,
  type OnboardingRaw,
} from "@/lib/onboarding-snapshot-core";

/**
 * KQ5: onboarding_snapshot RPC'si (20261015021000) ile eski 22 ayrı sayım AYNI veride AYNI snapshot'ı verir.
 * Gerçek SQL pglite'ta çalışır; eski yol aynı satırlar üzerinde PostgREST davranışını taklit eden sahte istemciyle koşar.
 */
const mod = await loadPglite();
const MIGRATION = readFileSync(resolve(process.cwd(), "supabase/migrations/20261015021000_onboarding_snapshot_rpc.sql"), "utf8");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADV = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;
type Fixture = Record<string, Row[]>;

const SCHEMA = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create table public.tenants(id uuid primary key, name text not null, slug text, sample_seeded_at timestamptz, plan text, listing_pool_enabled boolean not null default false);
create table public.profiles(id uuid primary key, tenant_id uuid not null, title text, role text not null);
create table public.customers(id serial primary key, tenant_id uuid, is_sample boolean not null default false, deleted_at timestamptz);
create table public.properties(id serial primary key, tenant_id uuid, is_sample boolean not null default false, published_at timestamptz, deleted_at timestamptz);
create table public.customer_demands(id serial primary key, tenant_id uuid, is_sample boolean not null default false);
create table public.appointments(id serial primary key, tenant_id uuid, is_sample boolean not null default false);
create table public.definitions(id serial primary key, tenant_id uuid);
create table public.advisor_specialties(id serial primary key, tenant_id uuid, profile_id uuid, is_sample boolean not null default false);
create table public.advisor_regions(id serial primary key, tenant_id uuid, profile_id uuid, is_sample boolean not null default false);
create table public.subscriptions(id serial primary key, tenant_id uuid unique, status text);
create table public.finance_accounts(id serial primary key, tenant_id uuid, owner_scope text, archived_at timestamptz);
create table public.recurring_rules(id serial primary key, tenant_id uuid, scope text);
create table public.tenant_modules(tenant_id uuid, module_key text);
create table public.tenant_portal_accounts(tenant_id uuid, portal text, source text);
create table public.eids_inbound_addresses(tenant_id uuid, revoked_at timestamptz, last_received_at timestamptz);
create table public.tenant_integrations(id serial primary key, tenant_id uuid, provider text, is_active boolean);
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
-- Canlıdaki gibi: authenticated tenant_integrations'ı OKUYAMAZ (20260731000136 sonrası kolon izni yok).
revoke all on public.tenant_integrations from authenticated;
`;

const TABLES = [
  "tenants", "profiles", "customers", "properties", "customer_demands", "appointments", "definitions", "advisor_specialties",
  "advisor_regions", "subscriptions", "finance_accounts", "recurring_rules", "tenant_modules", "tenant_portal_accounts",
  "eids_inbound_addresses", "tenant_integrations",
];

/* --------------------------- Sahte PostgREST istemcisi --------------------------- */

function fakeClient(fx: Fixture, denied: ReadonlySet<string> = new Set()) {
  const client = {
    from(table: string) {
      const preds: ((r: Row) => boolean)[] = [];
      let head = false;
      let cols = "*";
      const b: Record<string, unknown> = {};
      b.select = (c: string, opts?: { head?: boolean }) => {
        cols = c;
        head = Boolean(opts?.head);
        return b;
      };
      b.eq = (c: string, v: unknown) => (preds.push((r) => r[c] === v), b);
      b.is = (c: string, v: null) => (preds.push((r) => (r[c] ?? null) === v), b);
      b.not = (c: string, op: string, v: null) => (preds.push((r) => op === "is" && (r[c] ?? null) !== v), b);
      b.in = (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), b);
      const run = () => {
        if (denied.has(table)) return { data: null, count: null, error: { code: "42501", message: "permission denied" } };
        const rows = (fx[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (head) return { data: null, count: rows.length, error: null };
        const pick = (r: Row) => Object.fromEntries(cols.split(",").map((k) => [k.trim(), r[k.trim()] ?? null]));
        return { data: rows.map(pick), count: null, error: null, rows };
      };
      b.maybeSingle = () => {
        const r = run();
        if (r.error) return Promise.resolve(r);
        const data = r.data as Row[];
        if (data.length > 1) return Promise.resolve({ data: null, error: { code: "PGRST116" } });
        return Promise.resolve({ data: data[0] ?? null, error: null });
      };
      b.then = (resolve: (v: unknown) => unknown) => resolve(run());
      return b;
    },
  };
  return client as unknown as SupabaseClient;
}

/* ------------------------------- Senaryolar ------------------------------- */

const base = (): Fixture => Object.fromEntries(TABLES.map((t) => [t, [] as Row[]]));

function emptyOffice(): Fixture {
  const fx = base();
  fx.tenants.push({ id: T, name: "Boş Ofis", slug: "bos", sample_seeded_at: null, plan: "starter", listing_pool_enabled: false });
  fx.profiles.push({ id: OWNER, tenant_id: T, title: null, role: "owner" });
  return fx;
}

function fullOffice(): Fixture {
  const fx = base();
  fx.tenants.push(
    { id: T, name: "Dolu Ofis", slug: "dolu", sample_seeded_at: "2026-10-01T00:00:00+00:00", plan: "pro", listing_pool_enabled: true },
    { id: T2, name: "Başka", slug: "baska", sample_seeded_at: null, plan: "pro", listing_pool_enabled: true },
  );
  fx.profiles.push(
    { id: OWNER, tenant_id: T, title: "Broker", role: "owner" },
    { id: ADV, tenant_id: T, title: "  ", role: "advisor" },
    { id: OTHER, tenant_id: T2, title: "X", role: "owner" },
  );
  for (let i = 0; i < 7; i++) fx.customers.push({ tenant_id: T, is_sample: false, deleted_at: i === 0 ? "2026-01-01T00:00:00Z" : null });
  for (let i = 0; i < 3; i++) fx.customers.push({ tenant_id: T, is_sample: true, deleted_at: null });
  fx.properties.push(
    { tenant_id: T, is_sample: false, published_at: "2026-10-02T00:00:00Z", deleted_at: null },
    { tenant_id: T, is_sample: false, published_at: null, deleted_at: null },
    { tenant_id: T, is_sample: true, published_at: "2026-10-02T00:00:00Z", deleted_at: null },
  );
  fx.customer_demands.push({ tenant_id: T, is_sample: false });
  fx.appointments.push({ tenant_id: T, is_sample: true });
  fx.definitions.push({ tenant_id: T }, { tenant_id: T2 });
  fx.advisor_specialties.push({ tenant_id: T, profile_id: OWNER, is_sample: true }, { tenant_id: T, profile_id: ADV, is_sample: false });
  fx.advisor_regions.push({ tenant_id: T, profile_id: ADV, is_sample: false });
  fx.subscriptions.push({ tenant_id: T, status: "active" });
  fx.finance_accounts.push({ tenant_id: T, owner_scope: "office", archived_at: "2026-01-01T00:00:00Z" });
  fx.recurring_rules.push({ tenant_id: T, scope: "office" });
  fx.tenant_modules.push({ tenant_id: T, module_key: "rentals" });
  fx.tenant_portal_accounts.push({ tenant_id: T, portal: "sahibinden", source: "unknown" });
  fx.eids_inbound_addresses.push({ tenant_id: T, revoked_at: null, last_received_at: "2026-10-03T00:00:00Z" });
  return fx;
}

function declaredOffice(): Fixture {
  const fx = fullOffice();
  fx.tenant_portal_accounts.push({ tenant_id: T, portal: "emlakjet", source: "owner_declared" });
  fx.subscriptions[0]!.status = "trial";
  fx.eids_inbound_addresses[0]!.revoked_at = "2026-10-04T00:00:00Z";
  fx.finance_accounts.push({ tenant_id: T, owner_scope: "office", archived_at: null });
  return fx;
}

function profileSnapshot(licenseNo: string | null, located: boolean): ProfileSnapshot {
  const facts: ProfileFacts = {
    provinceId: located ? "p1" : null,
    districtId: located ? "d1" : null,
    addressLine: located ? "Atatürk Cad. No 12 Kat 3 Daire 5" : null,
    phone: null,
    licenseNo,
    taxNumber: null,
    logoUrl: null,
    brandColor: null,
    extAvailable: true,
    officeType: null,
    focusSegments: null,
    workDistrictIds: null,
    memberCount: 1,
  };
  return { facts, completion: computeProfileCompletion(facts), office: { name: "Ofis", taxOffice: null, slug: null } };
}

const SCENARIOS: { name: string; fx: () => Fixture; viewer: string | null; licenseNo: string | null; located: boolean }[] = [
  { name: "boş ofis, sahip", fx: emptyOffice, viewer: OWNER, licenseNo: null, located: false },
  { name: "dolu ofis, sahip", fx: fullOffice, viewer: OWNER, licenseNo: "3400123", located: true },
  { name: "dolu ofis, danışman (beyan yetkisi yok)", fx: fullOffice, viewer: ADV, licenseNo: " ", located: true },
  { name: "beyanlı portal, deneme aboneliği, iptal EİDS adresi", fx: declaredOffice, viewer: OWNER, licenseNo: "1", located: false },
  { name: "oturum kimliği yok", fx: fullOffice, viewer: null, licenseNo: null, located: true },
];

describe("parseOnboardingRpc", () => {
  it("bozuk/eksik yanıtta null döner (sahte ilerleme yok)", () => {
    expect(parseOnboardingRpc(null)).toBeNull();
    expect(parseOnboardingRpc({ customers: 1 })).toBeNull();
    expect(parseOnboardingRpc([])).toBeNull();
  });

  it("RPC yoksa (PGRST202) null döner; çağıran eski yola düşer", async () => {
    resetRpcProbes();
    const rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await loadOnboardingRawRpc({ rpc } as never, T)).toBeNull();
  });
});

describe.skipIf(!mod)("onboarding_snapshot RPC = eski ayrı sayımlar (pglite)", () => {
  let db: Db;
  const reset = async (fx: Fixture) => {
    await db.exec(`reset role; truncate ${TABLES.map((t) => `public.${t}`).join(", ")}`);
    for (const t of TABLES) {
      for (const row of fx[t] ?? []) {
        const keys = Object.keys(row);
        await db.query(
          `insert into public.${t} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
          keys.map((k) => row[k]),
        );
      }
    }
  };
  const rpcAs = async (viewer: string | null): Promise<unknown> => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${viewer ?? ""}', false), set_config('test.tenant', '${T}', false)`);
    await db.exec("set role authenticated");
    const rows = (await db.query("select public.onboarding_snapshot($1::uuid) as s", [T])).rows;
    await db.exec("reset role");
    return rows[0]!.s;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(SCHEMA);
    await db.exec(MIGRATION.replace(/^set local lock_timeout.*$/m, "").replace(/^notify pgrst.*$/m, ""));
  });
  beforeEach(() => resetRpcProbes());

  for (const sc of SCENARIOS) {
    it(`aynı snapshot: ${sc.name}`, async () => {
      const fx = sc.fx();
      await reset(fx);
      const json = await rpcAs(sc.viewer);
      const viaRpc = parseOnboardingRpc(json);
      expect(viaRpc).not.toBeNull();
      // Eski yol: canlıdaki gibi tenant_integrations okunamazsa eski kod null döndürürdü; eşitlik için okunabilir kabul edilir
      // (bu senaryolarda aktif entegrasyon yok, iki yol da "yok" der).
      const viaLegacy = await loadOnboardingRawLegacy(fakeClient(fx), T, sc.viewer);
      expect(viaLegacy).not.toBeNull();
      const ctx = { profile: profileSnapshot(sc.licenseNo, sc.located), content: EMPTY_ONBOARDING_CONTENT, skipped: [] };
      expect(composeOnboardingSnapshot(viaRpc!, ctx)).toEqual(composeOnboardingSnapshot(viaLegacy as OnboardingRaw, ctx));
    });
  }

  it("tam sayılar (müşteri/portföy/örnek müşteri) birebir; RPC tek çağrı", async () => {
    const fx = fullOffice();
    await reset(fx);
    let calls = 0;
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      calls++;
      expect(fn).toBe("onboarding_snapshot");
      expect(args).toEqual({ p_tenant_id: T });
      return { data: await rpcAs(OWNER), error: null };
    };
    const raw = await loadOnboardingRawRpc({ rpc } as never, T);
    expect(calls).toBe(1);
    expect(raw).toMatchObject({ customers: 7, properties: 2, sampleCustomers: 3, members: 2, viewerTitle: "Broker", viewerRole: "owner" });
  });

  it("tenant_integrations okunamasa da RPC hata vermez (eski yol tümüyle null dönerdi)", async () => {
    const fx = fullOffice();
    await reset(fx);
    expect(parseOnboardingRpc(await rpcAs(OWNER))?.activeIntegrations).toBe(0);
    expect(await loadOnboardingRawLegacy(fakeClient(fx, new Set(["tenant_integrations"])), T, OWNER)).toBeNull();
  });

  it("aktif entegrasyon okunabiliyorsa sayılır (yalnız netgsm/whatsapp)", async () => {
    const fx = fullOffice();
    fx.tenant_integrations.push({ tenant_id: T, provider: "netgsm", is_active: true }, { tenant_id: T, provider: "smtp", is_active: true });
    await reset(fx);
    await db.exec("grant select on public.tenant_integrations to authenticated");
    try {
      const viaRpc = parseOnboardingRpc(await rpcAs(OWNER))!;
      const viaLegacy = (await loadOnboardingRawLegacy(fakeClient(fx), T, OWNER))!;
      expect(viaRpc.activeIntegrations > 0).toBe(viaLegacy.activeIntegrations > 0);
      expect(viaRpc.activeIntegrations).toBe(1);
    } finally {
      await db.exec("revoke all on public.tenant_integrations from authenticated");
    }
  });
});
