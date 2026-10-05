import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Sub = { tenant_id: string; plan: string; status: string };
const state = {
  ready: true as boolean | "error",
  subs: [] as Sub[],
  tenants: {} as Record<string, string>,
  disabled: new Map<string, Set<string>>(),
  settings: {} as Record<string, string | null>,
  ledgerKeys: [] as string[],
  alreadyKeys: new Set<string>(),
  grants: [] as { p_tenant: string; p_units: number; p_kind: string; p_idem: string }[],
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
    rpc: async (name: string, args?: { p_tenant: string; p_units: number; p_kind: string; p_idem: string }) => {
      if (name === "ef_credit_ready") {
        return state.ready === "error" ? { data: null, error: { message: "function does not exist" } } : { data: state.ready, error: null };
      }
      if (name === "ef_credit_grant" && args) {
        const already = state.alreadyKeys.has(args.p_idem);
        if (!already) {
          state.alreadyKeys.add(args.p_idem);
          state.grants.push(args);
        }
        return { data: { ok: true, already, available: 0 }, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
    from: (table: string) => {
      const q = {
        select: () => q,
        in: (col: string, values: string[]) => {
          if (table === "subscriptions" && col === "status") state.statusFilter = values;
          if (table === "tenants") {
            return Promise.resolve({ data: values.filter((v) => state.tenants[v]).map((id) => ({ id, status: state.tenants[id] })), error: null });
          }
          if (table === "account_credit_ledger") {
            return Promise.resolve({ data: state.ledgerKeys.filter((k) => values.includes(k)).map((k) => ({ idempotency_key: k })), error: null });
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
  state.settings = { "ef.welcome_units": "0" };
  state.ledgerKeys = [];
  state.alreadyKeys = new Set();
  state.grants = [];
  state.statusFilter = [];
  state.heartbeat = [];
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

  it("planın aylık hakkını TR ay anahtarıyla verir; aboneliği yalnız trialing/active olanlardan sorgular", async () => {
    state.subs = [
      { tenant_id: "t1", plan: "office", status: "active" },
      { tenant_id: "t2", plan: "advisor", status: "trialing" },
      { tenant_id: "t3", plan: "office", status: "past_due" },
      { tenant_id: "t4", plan: "enterprise", status: "active" },
    ];
    state.tenants = { t1: "active", t2: "trial", t3: "past_due", t4: "active" };
    const res = await GET(req("Bearer s3cret"));
    const body = await res.json();
    expect(state.statusFilter.sort()).toEqual(["active", "trialing"]);
    const key = /^plan:(t\d):(\d{4}-\d{2})$/;
    expect(state.grants.map((g) => [g.p_tenant, g.p_units, g.p_kind]).sort()).toEqual([
      ["t1", 40, "plan_monthly"],
      ["t2", 10, "plan_monthly"],
    ]);
    for (const g of state.grants) expect(g.p_idem).toMatch(key);
    expect(body).toMatchObject({ offices: 2, units: 50, grants: 2, failed: 0 });
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
    state.subs = [{ tenant_id: "t4", plan: "enterprise", status: "active" }];
    state.tenants = { t4: "active" };
    state.settings = { "ef.welcome_units": "0" };
    await GET(req("Bearer s3cret"));
    expect(state.grants).toEqual([]);

    state.settings = { "ef.welcome_units": "10" };
    await GET(req("Bearer s3cret"));
    expect(state.grants).toEqual([{ p_tenant: "t4", p_units: 10, p_kind: "bonus", p_idem: "welcome:t4", p_meta: expect.anything() }].map((g) => expect.objectContaining(g)));
    await GET(req("Bearer s3cret"));
    expect(state.grants).toHaveLength(1);
  });

  it("deftere yazılmış anahtar ön elemeyle atlanır", async () => {
    state.subs = [{ tenant_id: "t1", plan: "office", status: "active" }];
    state.tenants = { t1: "active" };
    state.settings = { "ef.welcome_units": "10" };
    state.ledgerKeys = ["welcome:t1"];
    await GET(req("Bearer s3cret"));
    expect(state.grants.map((g) => g.p_kind)).toEqual(["plan_monthly"]);
  });
});
