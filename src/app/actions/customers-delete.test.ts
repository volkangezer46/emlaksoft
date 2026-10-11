import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, hasFilter, type MockResolver } from "../../test/supabase-mock";

/**
 * DAVRANIŞ TESTİ: müşteri silme (yumuşak) ve silme etkisi sayımı.
 * - yetki reddinde hiçbir sorgu gitmez,
 * - her sorgu/yazma tenant_id süzgeci taşır,
 * - yeni/aktif/eşleşmiş açık talebi (ve açık anlaşması) olan müşteri onaysız (confirm_linked) silinmez,
 * - ham veritabanı hata metni kullanıcıya sızmaz.
 */
const requirePermission = vi.fn();
let resolver: MockResolver = () => undefined;
let mock = createSupabaseMock((q) => resolver(q));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/assignment-notify", () => ({ idsDigest: vi.fn(() => "d"), notifyAssignment: vi.fn() }));
vi.mock("@/lib/automation-engine", () => ({ dispatchAutomationEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/playbook-trigger", () => ({ triggerPlaybooks: vi.fn(async () => undefined) }));
vi.mock("@/lib/integrations-api/webhooks", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mock.client }));

const allow = { ok: true, tenantId: "t1", userId: "u1", role: "owner" };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

/** Sayım sorgularına tablo bazında count döndürür. */
function counts(byTable: Record<string, number>): MockResolver {
  return (q) => (q.op === "select" ? { count: byTable[q.table] ?? 0 } : undefined);
}

describe("müşteri silme etkisi ve silme davranışı", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue(allow);
    resolver = () => undefined;
    mock = createSupabaseMock((q) => resolver(q));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("yetki reddi: etki sayımı ve silme hiçbir sorgu atmaz", async () => {
    requirePermission.mockResolvedValue({ ok: false, error: "Yetkiniz yok." });
    const { getCustomerDeleteImpact, deleteCustomerWithResult } = await import("./customers");
    const impact = await getCustomerDeleteImpact(["c1"]);
    expect(impact.error).toBe("Yetkiniz yok.");
    expect(impact.ok).toBeUndefined();
    const res = await deleteCustomerWithResult(fd({ id: "c1", confirm_linked: "1" }));
    expect(res).toEqual({ error: "Yetkiniz yok." });
    expect(mock.queries).toHaveLength(0);
    expect(requirePermission).toHaveBeenCalledWith("customers", "delete");
  });

  it("etki sayımı: her sorgu tenant_id süzer; talep new/active/matched, randevu imza dahil", async () => {
    resolver = counts({ deals: 1, customer_demands: 2, tasks: 3, appointments: 4, contracts: 5 });
    const { getCustomerDeleteImpact } = await import("./customers");
    const impact = await getCustomerDeleteImpact(["c1", "c2"]);
    expect(impact).toMatchObject({ ok: true, openDeals: 1, openDemands: 2, openTasks: 3, activeAppointments: 4, contracts: 5 });
    for (const q of mock.queries) expect(hasFilter(q, "eq", "tenant_id", "t1"), q.table).toBe(true);

    const demand = mock.forTable("customer_demands")[0];
    const statusIn = demand.filters.find((f) => f.method === "in" && f.args[0] === "status");
    expect(statusIn?.args[1]).toEqual(expect.arrayContaining(["new", "active", "matched"]));
    expect(statusIn?.args[1]).not.toContain("closed");

    const appt = mock.forTable("appointments")[0];
    const apptIn = appt.filters.find((f) => f.method === "in" && f.args[0] === "status");
    expect(apptIn?.args[1]).toEqual(expect.arrayContaining(["pending", "confirmed", "signature"]));
    expect(apptIn?.args[1]).not.toContain("cancelled");
  });

  it("açık talebi (new/matched) olan müşteri confirm_linked olmadan silinmez; yazma gitmez", async () => {
    resolver = counts({ customer_demands: 1 });
    const { deleteCustomerWithResult } = await import("./customers");
    const res = await deleteCustomerWithResult(fd({ id: "c1" }));
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/onay olmadan silinemez/);
    expect(mock.forTable("customers", "update")).toHaveLength(0);
  });

  it("açık anlaşması olan müşteri confirm_linked olmadan silinmez", async () => {
    resolver = counts({ deals: 2 });
    const { deleteCustomerWithResult } = await import("./customers");
    const res = await deleteCustomerWithResult(fd({ id: "c1" }));
    expect(res.error).toMatch(/Açık anlaşması/);
    expect(mock.forTable("customers", "update")).toHaveLength(0);
  });

  it("confirm_linked=1: yumuşak silme id + tenant_id süzgeciyle yazılır", async () => {
    resolver = counts({ deals: 2, customer_demands: 3 });
    const { deleteCustomerWithResult } = await import("./customers");
    const res = await deleteCustomerWithResult(fd({ id: "c1", confirm_linked: "1" }));
    expect(res).toEqual({ ok: true });
    const [upd] = mock.forTable("customers", "update");
    expect(upd).toBeDefined();
    expect(upd.payload).toHaveProperty("deleted_at");
    expect(hasFilter(upd, "eq", "id", "c1")).toBe(true);
    expect(hasFilter(upd, "eq", "tenant_id", "t1")).toBe(true);
    // Onaylı silmede etki sayımı yeniden çalıştırılmaz.
    expect(mock.forTable("deals")).toHaveLength(0);
  });

  it("veritabanı hatası: ham mesaj kullanıcıya sızmaz", async () => {
    const raw = 'new row violates row-level security policy "customers_secret_policy" (XX000)';
    resolver = (q) => (q.table === "customers" && q.op === "update" ? { error: { code: "XX000", message: raw } } : counts({})(q));
    const { deleteCustomerWithResult } = await import("./customers");
    const res = await deleteCustomerWithResult(fd({ id: "c1", confirm_linked: "1" }));
    expect(res.ok).toBeUndefined();
    expect(res.error).toBeTruthy();
    expect(res.error).not.toContain("customers_secret_policy");
    expect(res.error).not.toContain("row-level security");
    expect(res.error).not.toContain("XX000");
  });
});
