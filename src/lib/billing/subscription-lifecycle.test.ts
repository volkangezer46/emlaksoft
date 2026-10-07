import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const insertNotifications = vi.fn(async (_admin: unknown, rows: unknown[]) => rows.length);
vi.mock("@/lib/notify-batch", () => ({ insertNotifications: (...a: [unknown, unknown[]]) => insertNotifications(...a) }));

import { pausedSubscriptionIds, runSubscriptionLifecycle } from "@/lib/billing/subscription-lifecycle";

type RpcMap = Record<string, { data?: unknown; error?: { code?: string; message?: string } | null }>;

function adminWith(rpcs: RpcMap, pausedRows: { id: string }[] | null = []) {
  const calls: string[] = [];
  const admin = {
    rpc: vi.fn(async (name: string) => {
      calls.push(name);
      const r = rpcs[name];
      return { data: r?.data ?? null, error: r?.error ?? null };
    }),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.in = () => chain;
      chain.not = async () => (pausedRows === null ? { data: null, error: { message: "column does not exist" } } : { data: pausedRows, error: null });
      return chain;
    }),
  } as unknown as SupabaseClient;
  return { admin, calls };
}

beforeEach(() => {
  insertNotifications.mockClear();
});

describe("abonelik-kontrol duraklatma / planlı düşürme adımları", () => {
  it("süresi dolan duraklatmaları devam ettirir ve ofislere bildirir; sonra planlı düşürmeleri uygular", async () => {
    const { admin, calls } = adminWith({
      subscription_resume_due: { data: { ok: true, resumed: 2, tenantIds: ["t1", "t2"] } },
      subscription_apply_scheduled_plan_changes: {
        data: { ok: true, applied: 1, appliedTenantIds: ["t3"], failed: 1, failedTenantIds: ["t4"] },
      },
    });
    const out = await runSubscriptionLifecycle(admin);
    expect(calls).toEqual(["subscription_resume_due", "subscription_apply_scheduled_plan_changes"]);
    expect(out).toMatchObject({ resumed: 2, downgraded: 1, downgradeFailed: 1, notified: 4, skipped: false });
    const rows = insertNotifications.mock.calls[0]![1] as { tenant_id: string; title: string; kind: string }[];
    expect(rows.map((r) => r.tenant_id).sort()).toEqual(["t1", "t2", "t3", "t4"]);
    expect(rows.find((r) => r.tenant_id === "t4")!.kind).toBe("warning");
    expect(rows.find((r) => r.tenant_id === "t1")!.title).toMatch(/devam ediyor/);
  });

  it("RPC'ler yoksa (migration uygulanmadı) sessizce atlanır, bildirim yazılmaz", async () => {
    const missing = { error: { code: "PGRST202", message: "Could not find the function public.subscription_resume_due" } };
    const { admin } = adminWith({
      subscription_resume_due: missing,
      subscription_apply_scheduled_plan_changes: missing,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runSubscriptionLifecycle(admin);
    expect(out).toEqual({ resumed: 0, downgraded: 0, downgradeFailed: 0, notified: 0, skipped: true });
    expect(insertNotifications).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("başka RPC hatası loglanır ama diğer adımı ve cron'u bozmaz", async () => {
    const { admin } = adminWith({
      subscription_resume_due: { error: { code: "XX000", message: "boom" } },
      subscription_apply_scheduled_plan_changes: { data: { ok: true, applied: 0, appliedTenantIds: [], failed: 0, failedTenantIds: [] } },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runSubscriptionLifecycle(admin);
    expect(errSpy).toHaveBeenCalled();
    expect(out.resumed).toBe(0);
    expect(out.skipped).toBe(false);
    errSpy.mockRestore();
  });

  it("hiç iş yoksa bildirim yazılmaz", async () => {
    const { admin } = adminWith({
      subscription_resume_due: { data: { ok: true, resumed: 0, tenantIds: [] } },
      subscription_apply_scheduled_plan_changes: { data: { ok: true, applied: 0, appliedTenantIds: [], failed: 0, failedTenantIds: [] } },
    });
    await runSubscriptionLifecycle(admin);
    expect(insertNotifications).not.toHaveBeenCalled();
  });
});

describe("duraklatılmış abonelik otomatik iptal/gecikme akışından muaf", () => {
  it("duraklatılmış abonelik kimliklerini döndürür", async () => {
    const { admin } = adminWith({}, [{ id: "s2" }]);
    expect([...(await pausedSubscriptionIds(admin, ["s1", "s2"]))]).toEqual(["s2"]);
  });

  it("sütun yoksa boş küme (eski davranış korunur); boş girdi sorgu atmaz", async () => {
    const { admin } = adminWith({}, null);
    expect((await pausedSubscriptionIds(admin, ["s1"])).size).toBe(0);
    const { admin: a2 } = adminWith({});
    expect((await pausedSubscriptionIds(a2, [])).size).toBe(0);
    expect((a2.from as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
