import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, hasFilter, type MockResolver } from "../../test/supabase-mock";

/**
 * DAVRANIŞ TESTİ: portföy silme (arşivleme) engelleri.
 * Açık anlaşma, canlı portal ilanı, ofis dışındaki anahtar ya da planlı/aktif açık ev varsa silinmez;
 * yetki reddinde sorgu gitmez; sayımlar ve yazma tenant_id süzgeci taşır.
 */
const requirePermission = vi.fn();
const redirect = vi.fn();
const requestApprovalIfNeeded = vi.fn();
let resolver: MockResolver = () => undefined;
let mock = createSupabaseMock((q) => resolver(q));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => redirect(...a) }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/assignment-notify", () => ({ idsDigest: vi.fn(() => "d"), notifyAssignment: vi.fn() }));
vi.mock("@/lib/automation-engine", () => ({ dispatchAutomationEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/playbook-trigger", () => ({ triggerPlaybooks: vi.fn(async () => undefined) }));
vi.mock("@/lib/integrations-api/webhooks", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/comparables", () => ({ resolvePriceHealth: vi.fn() }));
vi.mock("@/lib/match-notify", () => ({ notifyMatchingDemandsForProperty: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn() }));
vi.mock("@/lib/matching", () => ({ fetchTenantMatchingWeights: vi.fn(), scoreDemandProperty: vi.fn() }));
vi.mock("@/lib/duplicate-finders", () => ({ findPropertyDuplicates: vi.fn(async () => []) }));
vi.mock("@/lib/geo/reader", () => ({ getDistrictName: vi.fn(), getProvinceName: vi.fn() }));
vi.mock("@/lib/property-owner/persist", () => ({ saveOwnerInfo: vi.fn() }));
vi.mock("@/lib/property-owner/server", () => ({ publishBlockReason: vi.fn() }));
vi.mock("@/lib/pool/server", () => ({ enqueueListingPool: vi.fn(), isPoolEnabled: vi.fn(async () => false), toPoolProperty: vi.fn() }));
vi.mock("@/lib/pool/system-assign", () => ({ assignPoolEntryAsSystem: vi.fn() }));
vi.mock("@/lib/pool/sources", () => ({ isIncomingPoolSource: vi.fn(() => false), parseIncomingPoolSource: vi.fn() }));
vi.mock("@/lib/pool/notify", () => ({ notifyNewListing: vi.fn(), notifyPoolAssigned: vi.fn(), notifyPoolEntry: vi.fn() }));
vi.mock("@/lib/oversight/approval-gate", () => ({ requestApprovalIfNeeded: (...a: unknown[]) => requestApprovalIfNeeded(...a) }));
vi.mock("@/lib/eids/authority-term", () => ({ shortAuthorityWarning: vi.fn() }));
vi.mock("@/lib/custom-fields/save", () => ({ prepareCustomFieldInputs: vi.fn(), writeCustomFieldInputs: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mock.client }));

const allow = { ok: true, tenantId: "t1", userId: "u1", role: "owner" };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const counts = (byTable: Record<string, number>): MockResolver => (q) =>
  q.op === "select" ? { count: byTable[q.table] ?? 0 } : undefined;

describe("deleteProperty engelleri", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue(allow);
    requestApprovalIfNeeded.mockReset();
    requestApprovalIfNeeded.mockResolvedValue({ status: "not_required" });
    redirect.mockReset();
    resolver = () => undefined;
    mock = createSupabaseMock((q) => resolver(q));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("yetki reddi: hata döner, onay kapısı ve sorgular çalışmaz", async () => {
    requirePermission.mockResolvedValue({ ok: false, error: "Yetkiniz yok." });
    const { deleteProperty } = await import("./properties");
    const res = await deleteProperty(fd({ id: "p1" }));
    expect(res).toEqual({ error: "Yetkiniz yok." });
    expect(requirePermission).toHaveBeenCalledWith("properties", "delete");
    expect(requestApprovalIfNeeded).not.toHaveBeenCalled();
    expect(mock.queries).toHaveLength(0);
  });

  it.each([
    ["açık anlaşma", "deals"],
    ["canlı portal ilanı", "portal_listings"],
    ["ofis dışındaki anahtar", "property_keys"],
    ["planlı/aktif açık ev", "open_houses"],
  ])("%s varsa silinmez (yazma gitmez)", async (_ad, table) => {
    resolver = counts({ [table]: 1 });
    const { deleteProperty } = await import("./properties");
    const res = await deleteProperty(fd({ id: "p1" }));
    expect(res).toBeUndefined();
    expect(mock.forTable("properties", "update")).toHaveLength(0);
  });

  it("engelde redirect_to varsa 'silme=engellendi' sayfasına gider", async () => {
    resolver = counts({ deals: 1 });
    const { deleteProperty } = await import("./properties");
    await deleteProperty(fd({ id: "p1", redirect_to: "/app/portfoyler" }));
    expect(redirect).toHaveBeenCalledWith("/app/portfoyler/p1?silme=engellendi");
    expect(mock.forTable("properties", "update")).toHaveLength(0);
  });

  it("engel sayımları tenant_id + property_id süzer; açık anlaşma kapanmış aşamaları hariç tutar", async () => {
    resolver = counts({ deals: 1 });
    const { deleteProperty } = await import("./properties");
    await deleteProperty(fd({ id: "p1" }));
    for (const t of ["deals", "portal_listings", "property_keys", "open_houses"]) {
      const [q] = mock.forTable(t);
      expect(q, t).toBeDefined();
      expect(hasFilter(q, "eq", "tenant_id", "t1"), `${t} tenant`).toBe(true);
      expect(hasFilter(q, "eq", "property_id", "p1"), `${t} property`).toBe(true);
    }
    const [deals] = mock.forTable("deals");
    expect(hasFilter(deals, "not", "stage", "in", "(won,lost)")).toBe(true);
  });

  it("engel yoksa arşivler: id + tenant_id süzgeciyle yumuşak silme yazılır", async () => {
    const { deleteProperty } = await import("./properties");
    const res = await deleteProperty(fd({ id: "p1" }));
    expect(res).toBeUndefined();
    const [upd] = mock.forTable("properties", "update");
    expect(upd).toBeDefined();
    expect(upd.payload).toMatchObject({ status: "archived" });
    expect(upd.payload).toHaveProperty("deleted_at");
    expect(hasFilter(upd, "eq", "id", "p1")).toBe(true);
    expect(hasFilter(upd, "eq", "tenant_id", "t1")).toBe(true);
  });

  it("onay bekleyen silme (yönetici onayı) yazmaz", async () => {
    requestApprovalIfNeeded.mockResolvedValue({ status: "pending", message: "Onay bekleniyor." });
    const { deleteProperty } = await import("./properties");
    const res = await deleteProperty(fd({ id: "p1" }));
    expect(res).toEqual({ error: "Onay bekleniyor." });
    expect(mock.queries).toHaveLength(0);
  });

  it("veritabanı hatasında ham mesaj sızmaz", async () => {
    resolver = (q) => (q.table === "properties" && q.op === "update" ? { error: { code: "XX000", message: "raw pg internals" } } : undefined);
    const { deleteProperty } = await import("./properties");
    const res = await deleteProperty(fd({ id: "p1" }));
    expect(res).toEqual({ error: "Portföy arşivlenemedi." });
  });
});
