import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn(async (_mod: string, _action: string) => ({ ok: true as boolean, tenantId: "t1", userId: "u1", error: "" }));
const logActivity = vi.fn(async (_i: unknown) => ({ ok: true }));
const updateAppointmentStatus = vi.fn(async (_fd: FormData) => ({ ok: true }) as { ok?: boolean; error?: string });

type Call = { table: string; patch?: unknown; filters: [string, string, unknown][] };
let calls: Call[] = [];
let respond: (c: Call) => { data: unknown; error?: unknown } = () => ({ data: [] });

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (i: unknown) => logActivity(i) }));
vi.mock("@/lib/require-permission", () => ({
  requirePermission: (m: string, a: string) => requirePermission(m, a),
}));
vi.mock("@/app/actions/appointments", () => ({ updateAppointmentStatus: (fd: FormData) => updateAppointmentStatus(fd) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      const add = (kind: string) => (col: string, v: unknown) => {
        call.filters.push([kind, col, v]);
        return chain;
      };
      chain.update = (patch: unknown) => {
        call.patch = patch;
        return chain;
      };
      chain.select = () => chain;
      chain.eq = add("eq");
      chain.in = add("in");
      chain.maybeSingle = () => Promise.resolve({ error: null, ...respond(call) });
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null, ...respond(call) }).then(res);
      return chain;
    },
  }),
}));

import { cancelPostCloseAppointments, undoPostCloseCleanup } from "./post-close";

const DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  calls = [];
  respond = (c) => (c.table === "customers" ? { data: { id: C1 } } : { data: [{ id: D1 }] });
  requirePermission.mockClear();
  requirePermission.mockImplementation(async () => ({ ok: true, tenantId: "t1", userId: "u1", error: "" }));
  logActivity.mockClear();
  updateAppointmentStatus.mockClear();
});

describe("undoPostCloseCleanup", () => {
  it("talepleri önceki durumuna (yalnız hâlâ closed olanları) ve bu işlemin yıldönümünü geri alır", async () => {
    respond = (c) => (c.table === "customers" ? { data: { id: C1 } } : { data: c.patch && (c.patch as { status: string }).status === "active" ? [{ id: D1 }] : [{ id: D2 }] });
    const res = await undoPostCloseCleanup({
      dealId: DEAL,
      closedDemands: [{ id: D1, previousStatus: "active" }, { id: D2, previousStatus: "new" }],
      anniversary: { customerId: C1, date: "2026-10-15", note: "Satın alma" },
    });
    expect(res).toEqual({ ok: true, restoredDemands: 2, anniversaryCleared: true });
    expect(requirePermission).toHaveBeenCalledWith("demands", "edit");
    expect(requirePermission).toHaveBeenCalledWith("customers", "edit");
    const demandCalls = calls.filter((c) => c.table === "customer_demands");
    expect(demandCalls).toHaveLength(2);
    for (const c of demandCalls) {
      expect(c.filters).toContainEqual(["eq", "tenant_id", "t1"]);
      expect(c.filters).toContainEqual(["eq", "status", "closed"]);
    }
    const cust = calls.find((c) => c.table === "customers")!;
    expect(cust.patch).toEqual({ anniversary_date: null, anniversary_note: null });
    expect(cust.filters).toContainEqual(["eq", "anniversary_date", "2026-10-15"]);
    expect(cust.filters).toContainEqual(["eq", "anniversary_note", "Satın alma"]);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "deal.post_close_undo", entityId: DEAL }));
  });

  it("izin yoksa hiçbir şey yazılmaz", async () => {
    requirePermission.mockImplementation(async () => ({ ok: false, tenantId: "", userId: "", error: "Yetkiniz yok." }));
    const res = await undoPostCloseCleanup({ dealId: DEAL, closedDemands: [{ id: D1, previousStatus: "active" }], anniversary: null });
    expect(res.error).toBe("Yetkiniz yok.");
    expect(calls).toHaveLength(0);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("geçersiz önceki durum / kimlik süzülür; geriye bir şey kalmazsa hata", async () => {
    const res = await undoPostCloseCleanup({
      dealId: DEAL,
      closedDemands: [{ id: D1, previousStatus: "closed" }, { id: "x", previousStatus: "active" }],
      anniversary: null,
    });
    expect(res.error).toBe("Geri alınacak değişiklik yok.");
    expect(requirePermission).not.toHaveBeenCalled();
  });
});

describe("cancelPostCloseAppointments", () => {
  it("randevu iznini ister, her randevuyu durum geçişinden iptal eder", async () => {
    updateAppointmentStatus.mockImplementationOnce(async () => ({ ok: true })).mockImplementationOnce(async () => ({ error: "Bu randevu durum geçişi desteklenmiyor." }));
    const res = await cancelPostCloseAppointments([D1, D2, D1, "bozuk"]);
    expect(requirePermission).toHaveBeenCalledWith("appointments", "edit");
    expect(updateAppointmentStatus).toHaveBeenCalledTimes(2);
    const fd = updateAppointmentStatus.mock.calls[0][0];
    expect(fd.get("status")).toBe("cancelled");
    expect(res).toEqual({ updated: 1, failed: 1, firstError: "Bu randevu durum geçişi desteklenmiyor." });
  });

  it("izin yoksa durur", async () => {
    requirePermission.mockImplementation(async () => ({ ok: false, tenantId: "", userId: "", error: "Yetkiniz yok." }));
    expect(await cancelPostCloseAppointments([D1])).toEqual({ error: "Yetkiniz yok." });
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
  });
});
