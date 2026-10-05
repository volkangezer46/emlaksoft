import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Sub = { tenant_id: string; plan: string; status: string; extra_seats?: number };
const state = {
  ready: true as boolean | "error",
  subs: [] as Sub[],
  tenants: {} as Record<string, string>,
  disabled: new Map<string, Set<string>>(),
  settings: {} as Record<string, string | null>,
  created: {} as Record<string, string>,
  /** Defter satırları (grant RPC'si ekler; ön eleme ve ay toplamı buradan okunur). */
  ledger: [] as { tenant_id: string; amount: number; idempotency_key: string }[],
  grants: [] as { p_tenant: string; p_units: number; p_kind: string; p_idem: string }[],
  expires: [] as { p_tenant: string; p_keep: number; p_idem: string }[],
  expireResult: { ok: true, already: false, expired: 0, available: 0 } as { ok: boolean; already: boolean; expired: number; available: number } | "error",
  statusFilter: [] as string[],
  heartbeat: [] as { status: string; detail?: string }[],
};

vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (_job: string, status: string, detail?: string) => {
    state.heartbeat.push({ status, detail });
    return true;
  },
}));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSettingsMany: async () => state.settings,
}));
vi.mock("@/lib/modules/state", () => ({
  getDisabledModulesByTenant: async () => state.disabled,
  isDisabledFor: (map: Map<string, Set<string>>, tenantId: string, key: string) => map.get(tenantId)?.has(key) ?? false,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args?: { p_tenant: string; p_units: number; p_kind: string; p_idem: string; p_keep?: number }) => {
      if (name === "ef_credit_ready") {
        return state.ready === "error" ? { data: null, error: { message: "function does not exist" } } : { data: state.ready, error: null };
      }
      if (name === "ef_credit_grant" && args) {
        const key = `ef:grant:${args.p_tenant}:${args.p_idem}`;
        const already = state.ledger.some((r) => r.idempotency_key === key);
        if (!already) {
          state.ledger.push({ tenant_id: args.p_tenant, amount: args.p_units, idempotency_key: key });
          state.grants.push(args);
        }
        return { data: { ok: true, already, available: 0 }, error: null };
      }
      if (name === "ef_credit_expire_plan" && args) {
        state.expires.push(args as unknown as { p_tenant: string; p_keep: number; p_idem: string });
        if (state.expireResult === "error") return { data: null, error: { message: "function does not exist" } };
        return { data: state.expireResult, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        like: () => q,
        in: (col: string, values: string[]) => {
          if (table === "subscriptions" && col === "status") state.statusFilter = values;
          if (table === "tenants") {
            return Promise.resolve({
              data: values.filter((v) => state.tenants[v]).map((id) => ({ id, status: state.tenants[id], created_at: state.created[id] ?? "2026-10-10T09:00:00Z" })),
              error: null,
            });
          }
          if (table === "account_credit_ledger") {
            if (col === "tenant_id") return Promise.resolve({ data: state.ledger.filter((r) => values.includes(r.tenant_id)), error: null });
            return Promise.resolve({ data: state.ledger.filter((r) => values.includes(r.idempotency_key)), error: null });
          }
          return q;
        },
        order: () => q,
        range: () =>
          Promise.resolve({ data: state.subs.filter((s) => state.statusFilter.includes(s.status)), error: null }),
      };
      return q;
    },
  }),
}));

import { GET } from "./route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/ef-kontor-hak", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  state.ready = true;
  state.subs = [];
  state.tenants = {};
  state.disabled = new Map();
  state.settings = { "ef.welcome_units": "0", "ef.welcome_since": "2026-10-06T00:00:00Z" };
  state.created = {};
  state.ledger = [];
  state.grants = [];
  state.expires = [];
  state.expireResult = { ok: true, already: false, expired: 0, available: 0 };
  // Ayın 10'u (devir tavanı penceresi dışı); tavan testleri tarihi 2'ye çeker.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T09:00:00Z"));
  state.statusFilter = [];
  state.heartbeat = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cron ef-kontor-hak", () => {
  it("CRON_SECRET Bearer olmadan 401", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer yanlis"))).status).toBe(401);
  });

  it("cüzdan hazır değilse (false ya da RPC yok) hiç hibe yapmaz, atlandı yazar", async () => {
    state.subs = [{ tenant_id: "t1", plan: "office", status: "active" }];
    state.tenants = { t1: "active" };
    for (const ready of [false, "error"] as const) {
      state.ready = ready;
      const res = await GET(req("Bearer s3cret"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ skipped: true });
    }
    expect(state.grants).toEqual([]);
    expect(state.heartbeat.at(-1)).toEqual({ status: "ok", detail: "atlandı: cüzdan hazır değil" });
  });

  it("planın aylık hakkını TR ay anahtarıyla verir (yalnız active); deneme aylık hak almaz; aboneliği trialing/active olanlardan sorgular", async () => {
    state.subs = [
      { tenant_id: "t1", plan: "office", status: "active" },
      { tenant_id: "t2", plan: "advisor", status: "trialing" },
      { tenant_id: "t3", plan: "office", status: "past_due" },
      { tenant_id: "t4", plan: "enterprise", status: "active", extra_seats: 100 },
    ];
    state.tenants = { t1: "active", t2: "trial", t3: "past_due", t4: "active" };
    const res = await GET(req("Bearer s3cret"));
    const body = await res.json();
    expect(state.statusFilter.sort()).toEqual(["active", "trialing"]);
    const key = /^plan:(t\d):(\d{4}-\d{2})$/;
    expect(state.grants.map((g) => [g.p_tenant, g.p_units, g.p_kind]).sort()).toEqual([
      ["t1", 40, "plan_monthly"],
      // Kurumsal: 400 + 100 ek kullanıcı x 6
      ["t4", 1000, "plan_monthly"],
    ]);
    for (const g of state.grants) expect(g.p_idem).toMatch(key);
    expect(body).toMatchObject({ offices: 2, units: 1040, grants: 2, failed: 0 });
  });

  it("aynı gün/ay ikinci çalıştırma çift hibe üretmez (idempotent)", async () => {
    state.subs = [{ tenant_id: "t1", plan: "office", status: "active" }];
    state.tenants = { t1: "active" };
    await GET(req("Bearer s3cret"));
    const first = state.grants.length;
    await GET(req("Bearer s3cret"));
    expect(first).toBe(1);
    expect(state.grants).toHaveLength(1);
  });

  it("askıdaki ofis ve valuation modülü kapalı ofis hak almaz", async () => {
    state.subs = [
      { tenant_id: "t1", plan: "office", status: "active" },
      { tenant_id: "t2", plan: "office", status: "active" },
    ];
    state.tenants = { t1: "suspended", t2: "active" };
    state.disabled = new Map([["t2", new Set(["valuation"])]]);
    const res = await GET(req("Bearer s3cret"));
    expect(state.grants).toEqual([]);
    expect(await res.json()).toMatchObject({ offices: 0, skipped: 2, skippedModuleClosed: 1 });
  });

  it("hoş geldin kontörü tek sefer (welcome:<tenant>), 0 = kapalı", async () => {
    // Plan kontör hakkı olmayan (kataloğa girmeyen eski) paket de hoş geldin alır.
    state.subs = [{ tenant_id: "t4", plan: "legacy", status: "active" }];
    state.tenants = { t4: "active" };
    state.settings = { "ef.welcome_units": "0", "ef.welcome_since": "2026-10-06T00:00:00Z" };
    await GET(req("Bearer s3cret"));
    expect(state.grants).toEqual([]);

    state.settings = { "ef.welcome_units": "10", "ef.welcome_since": "2026-10-06T00:00:00Z" };
    await GET(req("Bearer s3cret"));
    expect(state.grants).toEqual([{ p_tenant: "t4", p_units: 10, p_kind: "bonus", p_idem: "welcome:t4", p_meta: expect.anything() }].map((g) => expect.objectContaining(g)));
    await GET(req("Bearer s3cret"));
    expect(state.grants).toHaveLength(1);
  });

  it("deftere yazılmış anahtar ön elemeyle atlanır", async () => {
    state.subs = [{ tenant_id: "t1", plan: "office", status: "active" }];
    state.tenants = { t1: "active" };
    state.settings = { "ef.welcome_units": "10", "ef.welcome_since": "2026-10-06T00:00:00Z" };
    state.ledger = [{ tenant_id: "t1", amount: 10, idempotency_key: "ef:grant:t1:welcome:t1" }];
    await GET(req("Bearer s3cret"));
    expect(state.grants.map((g) => g.p_kind)).toEqual(["plan_monthly"]);
  });

  it("aynı ay plan yükseltmede yalnız pozitif fark (delta anahtarı), tekrar koşuda ek hibe yok", async () => {
    state.subs = [{ tenant_id: "t1", plan: "office", status: "active" }];
    state.tenants = { t1: "active" };
    await GET(req("Bearer s3cret"));
    state.subs = [{ tenant_id: "t1", plan: "enterprise", status: "active", extra_seats: 0 }]; // yükseltme: 400
    await GET(req("Bearer s3cret"));
    await GET(req("Bearer s3cret"));
    expect(state.grants.map((g) => [g.p_units, g.p_idem])).toEqual([
      [40, expect.stringMatching(/^plan:t1:\d{4}-\d{2}$/)],
      [360, expect.stringMatching(/^plan:t1:\d{4}-\d{2}:delta:400$/)],
    ]);
  });

  it("deneme (trialing) ofisi yalnız hoş geldin alır, aylık plan hakkı almaz", async () => {
    state.subs = [{ tenant_id: "t2", plan: "office", status: "trialing", extra_seats: 4 }];
    state.tenants = { t2: "trial" };
    state.settings = { "ef.welcome_units": "10", "ef.welcome_since": "2026-10-06T00:00:00Z" };
    await GET(req("Bearer s3cret"));
    expect(state.grants.map((g) => [g.p_kind, g.p_idem])).toEqual([["bonus", "welcome:t2"]]);
  });

  it("hoş geldin geriye dönük dağıtılmaz: since öncesi ofise ve ayar yokken hiç ofise grant yok", async () => {
    state.subs = [{ tenant_id: "eski", plan: "legacy", status: "active" }];
    state.tenants = { eski: "active" };
    state.created = { eski: "2026-01-01T00:00:00Z" };
    state.settings = { "ef.welcome_units": "10", "ef.welcome_since": "2026-10-06T00:00:00Z" };
    await GET(req("Bearer s3cret"));
    state.settings = { "ef.welcome_units": "10" };
    state.created = { eski: "2026-10-09T00:00:00Z" };
    await GET(req("Bearer s3cret"));
    expect(state.grants).toEqual([]);
  });

  it("devir tavanı: ayın ilk günlerinde active ofis için 3 aylık hak ile çağrılır; deneme/ay ortası çağrılmaz; hata cron'u düşürmez", async () => {
    state.subs = [
      { tenant_id: "t1", plan: "office", status: "active" },
      { tenant_id: "t2", plan: "office", status: "trialing" },
    ];
    state.tenants = { t1: "active", t2: "trial" };
    await GET(req("Bearer s3cret"));
    expect(state.expires).toEqual([]); // 10. gün: pencere dışı

    vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
    state.expireResult = "error";
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(state.expires).toEqual([{ p_tenant: "t1", p_keep: 120, p_idem: "plan-expire:2026-10" }]);
    expect(await res.json()).toMatchObject({ ok: true, expireFailed: 1, expiredUnits: 0 });

    state.expireResult = { ok: true, already: false, expired: 80, available: 120 };
    const ok = await GET(req("Bearer s3cret"));
    expect(await ok.json()).toMatchObject({ expiredUnits: 80, expireFailed: 0 });
  });

  it("devir tavanı: defterde ay anahtarı varsa RPC çağrılmaz", async () => {
    vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
    state.subs = [{ tenant_id: "t1", plan: "office", status: "active" }];
    state.tenants = { t1: "active" };
    state.ledger = [{ tenant_id: "t1", amount: -80, idempotency_key: "ef:expire:t1:plan-expire:2026-10" }];
    await GET(req("Bearer s3cret"));
    expect(state.expires).toEqual([]);
  });
});