import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DAVRANIŞ TESTİ: arama kaydı → geri arama döngüsü. Cevapsız çağrı "Geri ara" görevi açar (atanan başkasıysa
 * bildirim), giden arama aynı numaranın açık geri arama görevini tamamlar; gelen (cevaplanmış) arama ikisine de dokunmaz.
 */
const requirePermission = vi.fn();
const logActivity = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const notifyTenant = vi.fn(async (..._a: unknown[]) => undefined);
const ensureMissedCallbackTask = vi.fn();
const completeCallbackTasksForPhone = vi.fn();
const insert = vi.fn(async (..._a: unknown[]) => ({ error: null }));
const client = { from: () => ({ insert }) };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));
vi.mock("@/lib/notify", () => ({ notifyTenant: (...a: unknown[]) => notifyTenant(...a) }));
vi.mock("@/lib/after-safe", () => ({ afterSafe: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/insights/close-on-contact", () => ({ closeCallPriorityAfterContact: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...(a as [])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/calls/callback-tasks", () => ({
  ensureMissedCallbackTask: (...a: unknown[]) => ensureMissedCallbackTask(...a),
  completeCallbackTasksForPhone: (...a: unknown[]) => completeCallbackTasksForPhone(...a),
}));

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("geri arama döngüsü — createCall", () => {
  beforeEach(() => {
    requirePermission.mockReset().mockResolvedValue({ ok: true, tenantId: "t1", userId: "me", role: "agent", impersonating: false });
    logActivity.mockClear();
    notifyTenant.mockClear();
    insert.mockClear();
    ensureMissedCallbackTask.mockReset().mockResolvedValue({ created: true, taskId: "task1", assignedTo: "adv", title: "Geri ara: 0532 111 11 11" });
    completeCallbackTasksForPhone.mockReset().mockResolvedValue(["task1"]);
  });

  it("cevapsız çağrı görevi açar ve danışmana bildirir", async () => {
    const { createCall } = await import("./calls");
    const res = await createCall(form({ direction: "missed", phone: "05321111111" }));
    expect(res).toEqual({ ok: true });
    expect(ensureMissedCallbackTask).toHaveBeenCalledWith(client, { tenantId: "t1", actorId: "me", phone: "05321111111", customerId: null });
    expect(completeCallbackTasksForPhone).not.toHaveBeenCalled();
    expect(logActivity.mock.calls.some((c) => (c[0] as { action: string; entityId?: string }).action === "task.create")).toBe(true);
    expect(notifyTenant).toHaveBeenCalledWith(expect.objectContaining({ userId: "adv", href: "/app/gorevler?gorev=task1", prefKey: "assignment" }));
  });

  it("görev zaten varsa (idempotent) bildirim yok", async () => {
    ensureMissedCallbackTask.mockResolvedValue({ created: false, reason: "exists" });
    const { createCall } = await import("./calls");
    await createCall(form({ direction: "missed", phone: "05321111111" }));
    expect(notifyTenant).not.toHaveBeenCalled();
  });

  it("giden arama aynı numaranın geri arama görevini tamamlar", async () => {
    const { createCall } = await import("./calls");
    await createCall(form({ direction: "outbound", phone: "0532 111 11 11", disposition: "Ulaşıldı" }));
    expect(completeCallbackTasksForPhone).toHaveBeenCalledWith(client, { tenantId: "t1", phone: "05321111111" });
    expect(ensureMissedCallbackTask).not.toHaveBeenCalled();
    expect(logActivity.mock.calls.some((c) => (c[0] as { action: string }).action === "task.complete")).toBe(true);
  });

  it("gelen (cevaplanmış) arama döngüye dokunmaz", async () => {
    const { createCall } = await import("./calls");
    await createCall(form({ direction: "inbound", phone: "05321111111", disposition: "Ulaşıldı" }));
    expect(ensureMissedCallbackTask).not.toHaveBeenCalled();
    expect(completeCallbackTasksForPhone).not.toHaveBeenCalled();
  });
});
