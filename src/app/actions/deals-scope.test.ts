import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP2 eylem bağlantısı: danışman başka danışmanın anlaşmasında aşama değiştiremez (RPC hiç çağrılmaz);
 * kendi anlaşmasını "Kazanıldı"ya almak zorunlu onaya gider, onaylıysa RPC çalışır ve onay tüketilir; owner onaysız geçer.
 */
let gateRole = "advisor";
const rpcCalls: string[] = [];
let dealOwner = "u2";
let approval: "pending" | "approved" = "pending";
const consume = vi.fn(async () => true);
const check = vi.fn(async (input: { role: string }) =>
  input.role === "owner" || input.role === "gm"
    ? { status: "not_required" as const }
    : approval === "approved"
      ? { status: "approved" as const, approvalId: "ap1" }
      : { status: "pending" as const, approvalId: "ap1", message: "yönetici onayı bekliyor" },
);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/after-safe", () => ({ afterSafe: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/automation-engine", () => ({ dispatchAutomationEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/playbook-trigger", () => ({ triggerPlaybooks: vi.fn(async () => undefined) }));
vi.mock("@/lib/integrations-api/webhooks", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn(async () => undefined) }));
vi.mock("@/lib/post-close", async (orig) => ({
  ...(await orig<typeof import("@/lib/post-close")>()),
  runPostCloseCleanup: vi.fn(async () => ({ closedDemands: [], anniversary: null })),
  notifyPostCloseAdvisors: vi.fn(),
}));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => ({ ok: true, tenantId: "t1", userId: "u1", role: gateRole }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/approval-mandatory", () => ({
  checkMandatoryApproval: (...a: unknown[]) => check(...(a as [{ role: string }])),
  consumeMandatoryApproval: (...a: unknown[]) => consume(...(a as [])),
}));
vi.mock("@/lib/permission-data-scope", async (orig) => ({
  ...(await orig<typeof import("@/lib/permission-data-scope")>()),
  dealWriteScopeFilter: async (g: { userId: string; role: string }) =>
    g.role === "owner" ? { kind: "none" } : { kind: "self", userId: g.userId },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { id: "d1", stage: "negotiation", property_id: "p1", customer_id: "c1", deal_type: "sale", deal_value: 12_000_000, assigned_to: dealOwner },
          error: null,
        }),
      };
      return chain;
    },
    rpc: async (_n: string, args: { p_deal_id: string }) => {
      rpcCalls.push(args.p_deal_id);
      return { data: { outcome: "applied", previous_stage: "negotiation", property_id: "p1" }, error: null };
    },
  }),
}));

import { updateDealStage } from "./deals";

const fd = (stage: string) => {
  const f = new FormData();
  f.set("deal_id", "0f8fad5b-d9cb-469f-a165-70867728950e");
  f.set("stage", stage);
  return f;
};

beforeEach(() => {
  gateRole = "advisor";
  dealOwner = "u2";
  approval = "pending";
  rpcCalls.length = 0;
  check.mockClear();
  consume.mockClear();
});

describe("anlaşma aşaması: kapsam ve Kazanıldı onayı", () => {
  it("danışman başka danışmanın anlaşmasında aşama değiştiremez", async () => {
    const res = await updateDealStage(fd("qualified"));
    expect(res.error).toMatch(/kapsamınızda değil/);
    expect(rpcCalls).toEqual([]);
  });

  it("danışman kendi anlaşmasını Kazanıldı'ya alırken onay talebi açılır, RPC çağrılmaz", async () => {
    dealOwner = "u1";
    const res = await updateDealStage(fd("won"));
    expect(res.error).toMatch(/onay/);
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ action: "deal_won", requestedValue: 12_000_000, role: "advisor" }));
    expect(rpcCalls).toEqual([]);
  });

  it("onaylı talepte Kazanıldı uygulanır ve onay tüketilir", async () => {
    dealOwner = "u1";
    approval = "approved";
    const res = await updateDealStage(fd("won"));
    expect(res.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
    expect(consume).toHaveBeenCalledWith("t1", "u1", "ap1");
  });

  it("ofis sahibi başkasının anlaşmasını onaysız kazanır", async () => {
    gateRole = "owner";
    const res = await updateDealStage(fd("won"));
    expect(res.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
    expect(consume).not.toHaveBeenCalled();
  });
});
