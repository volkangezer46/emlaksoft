import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DAVRANIŞ TESTİ: toplu aşama değişimi (100 kayıt). Kapı BİR kez alınır, kayıtlar en çok 6'lı eşzamanlılıkla
 * işlenir, mükerrer kimlik tek kez işlenir, ilk hata liste sırasına göre seçilir (işçi sırasına değil).
 * Her veritabanı turu sanal gecikme taşır; sıralı işleme 100 x 2 tur = 200 gecikme tutardı.
 */
const LATENCY_MS = 15;
let inFlight = 0;
let maxInFlight = 0;
let rpcCalls: string[] = [];
let slowId = "";
let failById = new Map<string, string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function dbTurn<T>(value: T, extraMs = 0): Promise<T> {
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await sleep(LATENCY_MS + extraMs);
  inFlight -= 1;
  return value;
}

const requirePermission = vi.fn(async () => ({ ok: true, tenantId: "t1", userId: "u1", role: "owner" }));
const logActivity = vi.fn(async () => ({ ok: true }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...(a as [])) }));
vi.mock("@/lib/automation-engine", () => ({ dispatchAutomationEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/playbook-trigger", () => ({ triggerPlaybooks: vi.fn(async () => undefined) }));
vi.mock("@/lib/integrations-api/webhooks", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...(a as [])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let id = "";
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: string) => {
          if (col === "id") id = v;
          return chain;
        },
        maybeSingle: () =>
          dbTurn({ data: { id, stage: "new", property_id: "p1", customer_id: "c1", deal_type: "sale", deal_value: 1, assigned_to: "u1" }, error: null }),
      };
      return chain;
    },
    rpc: (_name: string, args: { p_deal_id: string }) => {
      rpcCalls.push(args.p_deal_id);
      const fail = failById.get(args.p_deal_id);
      return dbTurn(
        { data: { outcome: fail ?? "applied", previous_stage: "new", property_id: "p1" }, error: null },
        args.p_deal_id === slowId ? 80 : 0,
      );
    },
  }),
}));

const ids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());

describe("bulkUpdateDealStage davranışı", () => {
  beforeEach(() => {
    inFlight = 0;
    maxInFlight = 0;
    rpcCalls = [];
    slowId = "";
    failById = new Map();
    requirePermission.mockClear();
    logActivity.mockClear();
  });

  it("100 kayıt: kapı bir kez, eşzamanlılık <= 6, sıralı işlemden belirgin hızlı, hepsi güncellenir", async () => {
    const { bulkUpdateDealStage } = await import("./deals");
    const list = ids(100);
    const t0 = performance.now();
    const res = await bulkUpdateDealStage(list, "qualified");
    const elapsed = performance.now() - t0;
    expect(res).toMatchObject({ updated: 100, failed: 0 });
    expect(requirePermission).toHaveBeenCalledTimes(1);
    expect(rpcCalls).toHaveLength(100);
    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxInFlight).toBeGreaterThan(1);
    // Sıralı: 100 x 2 tur x 15 ms = 3000 ms; 6'lı: ~17 dalga x 30 ms = ~510 ms. Bol payla yarının altı.
    expect(elapsed).toBeLessThan(1500);
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it("mükerrer kimlik tek kez işlenir; ilk hata liste sırasına göre seçilir", async () => {
    const { bulkUpdateDealStage } = await import("./deals");
    const list = ids(12);
    slowId = list[2]; // erken indeks ama GEÇ biter
    failById.set(list[2], "conflict");
    failById.set(list[9], "property_required");
    const res = await bulkUpdateDealStage([...list, list[0], list[1]], "qualified");
    expect(rpcCalls).toHaveLength(12);
    expect(res.failed).toBe(2);
    expect(res.updated).toBe(10);
    expect(res.firstError).toBe("Anlaşma aşaması başka bir işlemde değişti. Sayfayı yenileyin.");
  });

  it("açık olmayan aşama ve boş seçim reddedilir", async () => {
    const { bulkUpdateDealStage } = await import("./deals");
    expect((await bulkUpdateDealStage(ids(2), "won")).error).toMatch(/yalnız açık aşamalar/);
    expect((await bulkUpdateDealStage([], "qualified")).error).toBe("Anlaşma seçin.");
    expect(rpcCalls).toHaveLength(0);
  });
});
