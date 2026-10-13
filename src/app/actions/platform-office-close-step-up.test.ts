import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AD11 ofis kapatma kodu (davranış): (1) kapatma talebi kodu BİR KEZ doğrular, ofisi arşivler ve talebi "completed"
 * yapar (arşiv yolu ikinci kez kod istemez); (2) yaşam döngüsü arşivi kodla tamamlanır; (3) doğrudan paket/durum
 * eylemi askıya alma/iptal YENİ geçişinde kod ister, aynı durumda kalan paket değişikliği istemez.
 */
type Row = Record<string, unknown>;
const TENANT = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

const db = vi.hoisted(() => ({
  tenants: [] as Row[],
  kvkk: [] as Row[],
  profiles: [] as Row[],
  rpcCalls: [] as { fn: string; args: Row }[],
  updates: [] as { table: string; values: Row }[],
  verifyCalls: 0,
  verifyError: null as null | { message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })), headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: vi.fn(async () => ({ id: "staff-1", role: "super_admin", email: "a@b.c", full_name: "A", is_active: true })),
  getPlatformStaffIdentity: vi.fn(async () => null),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: vi.fn(async () => undefined), clientIpFrom: () => null }));
vi.mock("@/lib/error-log", () => ({ logError: vi.fn(async () => undefined) }));
vi.mock("@/lib/settings/read", () => ({ getSetting: vi.fn(async () => true) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: [{ id: "f1", status: "verified" }] }, error: null })),
        challengeAndVerify: vi.fn(async () => {
          db.verifyCalls += 1;
          return { data: null, error: db.verifyError };
        }),
      },
    },
  })),
}));

function table(name: string): Row[] {
  if (name === "tenants") return db.tenants;
  if (name === "kvkk_requests") return db.kvkk;
  if (name === "profiles") return db.profiles;
  return [];
}

/** Zincirlenebilir sahte sorgu: eq/in süzer, maybeSingle ilk satırı, update eşleşenleri yazar. */
function query(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let pending: Row | null = null;
  const rows = () => table(name).filter((r) => filters.every((f) => f(r)));
  const api = {
    select: () => api,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
    in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), api),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), api),
    update: (values: Row) => ((pending = values), api),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      if (pending) {
        db.updates.push({ table: name, values: pending });
        for (const r of rows()) Object.assign(r, pending);
      }
      return Promise.resolve({ data: rows(), error: null }).then(resolve);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (name: string) => query(name),
    rpc: async (fn: string, args: Row) => {
      db.rpcCalls.push({ fn, args });
      if (fn === "update_tenant_plan_subscription" && args.p_status) {
        const t = db.tenants.find((r) => r.id === args.p_tenant_id);
        if (t) t.status = args.p_status;
      }
      return { data: { tenantSlug: "ofis" }, error: null };
    },
  }),
}));

import { processOfficeClosureRequestByAdmin } from "./platform-tenant-closure";
import { setTenantLifecycleByAdmin } from "./platform-tenants";
import { updateTenantPlanStatus } from "./platform";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  db.tenants = [{ id: TENANT, name: "Deniz Emlak", status: "active", updated_at: "2026-10-01T00:00:00.000Z" }];
  db.kvkk = [{ id: REQUEST, tenant_id: TENANT, request_type: "account_closure", status: "open", created_by: OWNER }];
  db.profiles = [{ id: OWNER, role: "owner", is_active: true, tenant_id: TENANT }];
  db.rpcCalls = [];
  db.updates = [];
  db.verifyCalls = 0;
  db.verifyError = null;
});

describe("ofis kapatma talebi (account_closure)", () => {
  const base = { request_id: REQUEST, id: TENANT, reason: "Ofis sahibi hesabını kapatmak istedi", confirm_name: "Deniz Emlak" };

  it("kodla: ofis arşivlenir, talep tamamlanır, kod yalnız bir kez doğrulanır", async () => {
    const r = await processOfficeClosureRequestByAdmin(form({ ...base, step_up_code: "123456" }));
    expect(r).toMatchObject({ ok: true });
    expect(db.verifyCalls).toBe(1);
    expect(db.rpcCalls).toEqual([
      { fn: "update_tenant_plan_subscription", args: expect.objectContaining({ p_tenant_id: TENANT, p_status: "cancelled" }) },
    ]);
    expect(db.tenants[0].status).toBe("cancelled");
    expect(db.kvkk[0].status).toBe("completed");
  });

  it("kodsuz: hiçbir şey yazılmaz", async () => {
    const r = await processOfficeClosureRequestByAdmin(form(base));
    expect(r.error).toMatch(/6 haneli kodu/);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.kvkk[0].status).toBe("open");
  });

  it("yanlış kod: hiçbir şey yazılmaz", async () => {
    db.verifyError = { message: "Invalid TOTP code entered" };
    const r = await processOfficeClosureRequestByAdmin(form({ ...base, step_up_code: "123456" }));
    expect(r.error).toMatch(/hatalı/);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.kvkk[0].status).toBe("open");
  });
});

describe("yaşam döngüsü arşivi", () => {
  it("kodla arşivler; kod bir kez doğrulanır", async () => {
    const r = await setTenantLifecycleByAdmin(
      form({ mode: "archive", id: TENANT, reason: "Sözleşme sona erdi", confirm_name: "Deniz Emlak", step_up_code: "123456" }),
    );
    expect(r).toMatchObject({ ok: true });
    expect(db.verifyCalls).toBe(1);
    expect(db.tenants[0].status).toBe("cancelled");
  });
});

describe("updateTenantPlanStatus (satır içi tablo / abonelik penceresi)", () => {
  it("askıya alma kodsuz yapılamaz", async () => {
    const r = await updateTenantPlanStatus(form({ id: TENANT, status: "suspended", plan: "office" }));
    expect(r).toMatchObject({ code: "step_up_required" });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("iptal kodla yapılır", async () => {
    const r = await updateTenantPlanStatus(form({ id: TENANT, status: "cancelled", step_up_code: "123456" }));
    expect(r).toEqual({ ok: true });
    expect(db.verifyCalls).toBe(1);
    expect(db.tenants[0].status).toBe("cancelled");
  });

  it("zaten askıdaki ofiste paket değişikliği kod istemez", async () => {
    db.tenants[0].status = "suspended";
    const r = await updateTenantPlanStatus(form({ id: TENANT, status: "suspended", plan: "business" }));
    expect(r).toEqual({ ok: true });
    expect(db.verifyCalls).toBe(0);
  });

  it("aktif/deneme geçişi kod istemez", async () => {
    const r = await updateTenantPlanStatus(form({ id: TENANT, status: "trial" }));
    expect(r).toEqual({ ok: true });
    expect(db.verifyCalls).toBe(0);
  });
});
