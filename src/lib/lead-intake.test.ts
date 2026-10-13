import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aday girişi (ARS1-1): yeni aday müşteriye dönüşünce "new_customer" otomasyonu tetiklenir;
 * telefonu eşleşen mükerrer talepte tetiklenmez. Tetikleme hatası talebi bozmaz.
 */
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  existingCustomer: null as null | { id: string; assigned_to: string | null },
  inserts: [] as Array<{ table: string; row: Row }>,
  dispatch: vi.fn(async (..._args: unknown[]) => undefined),
  notify: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation-engine", () => ({ dispatchAutomationEvent: h.dispatch }));
vi.mock("@/lib/notify", () => ({ notifyTenant: h.notify }));
vi.mock("@/lib/lead-routing/server", () => ({
  routeNewLead: async () => ({ ok: true, assigneeId: "u-advisor", strategy: "least_loaded", reason: "test", deferred: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        limit: () => chain,
        maybeSingle: async () =>
          table === "tenants"
            ? { data: { id: "t-1", name: "Ofis", status: "active", lead_capture_enabled: true }, error: null }
            : { data: h.existingCustomer, error: null },
        single: async () => ({ data: { id: "c-new" }, error: null }),
        insert: (row: Row) => {
          h.inserts.push({ table, row });
          return Object.assign(Promise.resolve({ error: null }), { select: () => chain });
        },
      };
      return chain;
    },
  }),
}));

import { intakeLead } from "@/lib/lead-intake";

beforeEach(() => {
  vi.clearAllMocks();
  h.existingCustomer = null;
  h.inserts = [];
});

const input = { fullName: "Ayşe Yılmaz", phone: "05321234567", source: "web_form", message: "3+1 arıyorum" };

describe("intakeLead → new_customer otomasyonu", () => {
  it("yeni adayda dispatchAutomationEvent('new_customer') bildirimden sonra çağrılır", async () => {
    const res = await intakeLead("tok", input);
    expect(res).toMatchObject({ ok: true, customerId: "c-new", duplicate: false });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledWith(
      "t-1",
      "new_customer",
      expect.objectContaining({ entityType: "customer", entityId: "c-new", customerId: "c-new", fields: expect.objectContaining({ source: "web_form" }) }),
    );
    expect(h.notify.mock.invocationCallOrder[0]!).toBeLessThan(h.dispatch.mock.invocationCallOrder[0]!);
  });

  it("mükerrer (telefonu eşleşen) talepte tetiklenmez", async () => {
    h.existingCustomer = { id: "c-old", assigned_to: "u-x" };
    const res = await intakeLead("tok", input);
    expect(res).toMatchObject({ ok: true, customerId: "c-old", duplicate: true });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("otomasyon hatası talebi bozmaz", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.dispatch.mockRejectedValueOnce(new Error("motor çöktü"));
    const res = await intakeLead("tok", input);
    expect(res).toMatchObject({ ok: true, duplicate: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledWith("intakeLead automation new_customer", "motor çöktü");
    log.mockRestore();
  });
});
