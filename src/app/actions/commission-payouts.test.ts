import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTableMock, type MockRow } from "@/lib/test-support/supabase-table-mock";

/**
 * DAVRANIŞ TESTİ: danışman hakediş ödemesi — yetki/rol kapısı, tahsil edilmemiş komisyonun atlanması, çift ödeme
 * engeli (ödenmiş pay yeniden yazılmaz), bekleyen hakedişin aynı satırda "paid"e yükselmesi, kiracı süzgeci,
 * denetim kaydı ve danışman bildirimi.
 */
type Mock = ReturnType<typeof createTableMock>;
let db: Mock;

const requirePermission = vi.fn();
const logActivity = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const notifyTenant = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));
vi.mock("@/lib/notify", () => ({ notifyTenant: (...a: unknown[]) => notifyTenant(...a) }));
vi.mock("@/lib/after-safe", () => ({ afterSafe: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...(a as [])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));

const T = "t1";
const gate = (role: string) => ({ ok: true, tenantId: T, userId: "boss", role, impersonating: false });
const comm = (id: string, status: string, tenant = T): MockRow => ({ id, tenant_id: tenant, status });
const split = (id: string, commission: string, profile: string | null, amount: number, extra: MockRow = {}): MockRow => ({
  id, tenant_id: T, commission_id: commission, profile_id: profile, amount, kind: "advisor", unresolved: false, label: "Danışman", ...extra,
});

function setup(tables: Record<string, MockRow[]>) {
  db = createTableMock({ commissions: [], commission_splits: [], commission_payouts: [], ...tables });
}

describe("hakediş ödemesi", () => {
  beforeEach(() => {
    setup({});
    requirePermission.mockReset().mockResolvedValue(gate("owner"));
    logActivity.mockClear();
    notifyTenant.mockClear();
  });

  it("yetki reddinde ve owner/gm dışı rolde hiçbir şey yazılmaz", async () => {
    const { payCommissionPayouts } = await import("./commission-payouts");
    requirePermission.mockResolvedValueOnce({ ok: false, error: "Bu işlem için yetkiniz yok." });
    expect(await payCommissionPayouts(["c1"])).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(requirePermission).toHaveBeenCalledWith("commissions", "edit");
    requirePermission.mockResolvedValueOnce(gate("branch_manager"));
    expect((await payCommissionPayouts(["c1"])).error).toMatch(/ofis sahibi veya genel müdür/);
    expect(db.log).toHaveLength(0);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("tahsil edilmemiş komisyonun hakedişi ödenmez", async () => {
    setup({ commissions: [comm("c1", "calculated")], commission_splits: [split("s1", "c1", "adv", 500)] });
    const { payCommissionPayout } = await import("./commission-payouts");
    expect((await payCommissionPayout("c1")).error).toMatch(/tahsil edilmeden/);
    expect(db.tables.commission_payouts).toHaveLength(0);
  });

  it("danışman payları ödenir: onay + ödeme alanları dolu, kiracı süzgeci, denetim ve bildirim", async () => {
    setup({
      commissions: [comm("c1", "paid"), comm("c2", "collected"), comm("cx", "paid", "other")],
      commission_splits: [
        split("s1", "c1", "adv1", 600),
        split("s2", "c2", "adv1", 400),
        split("s3", "c2", "adv2", 250),
        split("s4", "c2", null, 300, { kind: "office" }),
        split("s5", "c2", "adv3", 100, { unresolved: true }),
      ],
    });
    const { payCommissionPayouts } = await import("./commission-payouts");
    const res = await payCommissionPayouts(["c1", "c2", "cx"], "EFT-123");
    expect(res).toMatchObject({ ok: true, paidCount: 3, paidAmount: 1250, skipped: 1 });
    expect(db.hasFilter("commissions", "eq", "tenant_id", T, "select")).toBe(true);
    expect(db.hasFilter("commission_splits", "eq", "kind", "advisor", "select")).toBe(true);
    const rows = db.tables.commission_payouts;
    expect(rows.map((r) => r.split_id).sort()).toEqual(["s1", "s2", "s3"]);
    for (const r of rows) {
      expect(r).toMatchObject({ tenant_id: T, status: "paid", approved_by: "boss", paid_by: "boss", payment_ref: "EFT-123", created_by: "boss" });
      expect(r.approved_at).toBeTruthy();
      expect(r.paid_at).toBeTruthy();
    }
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0]![0]).toMatchObject({ action: "commission_payout.pay", tenantId: T, newValue: { count: 3, amount: 1250 } });
    expect(notifyTenant).toHaveBeenCalledTimes(2);
    expect(notifyTenant.mock.calls.map((c) => (c[0] as { userId: string }).userId).sort()).toEqual(["adv1", "adv2"]);
    expect(notifyTenant.mock.calls[0]![0]).toMatchObject({ prefKey: "commission", href: "/app/cuzdan#odenen-hakedis" });
  });

  it("çift ödeme yok: ödenmiş pay atlanır, bekleyen hakediş aynı satırda paid olur", async () => {
    setup({
      commissions: [comm("c1", "paid")],
      commission_splits: [split("s1", "c1", "adv1", 600), split("s2", "c1", "adv2", 300)],
      commission_payouts: [
        { id: "y1", tenant_id: T, commission_id: "c1", split_id: "s1", profile_id: "adv1", amount: 600, status: "paid", approved_at: "x" },
        { id: "y2", tenant_id: T, commission_id: "c1", split_id: "s2", profile_id: "adv2", amount: 300, status: "pending", approved_at: null },
      ],
    });
    const { payCommissionPayout } = await import("./commission-payouts");
    const res = await payCommissionPayout("c1");
    expect(res).toMatchObject({ ok: true, paidCount: 1, paidAmount: 300 });
    expect(db.tables.commission_payouts).toHaveLength(2);
    expect(db.tables.commission_payouts.find((r) => r.id === "y2")).toMatchObject({ status: "paid", approved_by: "boss", paid_by: "boss" });
    expect(db.log.some((q) => q.table === "commission_payouts" && q.kind === "insert")).toBe(false);

    // İkinci tıklama: ödenecek pay kalmadı.
    const again = await payCommissionPayout("c1");
    expect(again.error).toMatch(/Ödenecek hakediş yok/);
  });

  it("yarışta unique ihlali (23505) 'zaten ödendi' sayılır; denetim/bildirim yazılmaz", async () => {
    setup({ commissions: [comm("c1", "paid")], commission_splits: [split("s1", "c1", "adv1", 600)] });
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const orig = client.from;
    client.from = (t: string) => {
      const b = orig(t);
      if (t === "commission_payouts") {
        b.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) });
      }
      return b;
    };
    const { payCommissionPayout } = await import("./commission-payouts");
    const res = await payCommissionPayout("c1");
    expect(res.error).toMatch(/başka bir oturumda zaten ödendi/);
    expect(logActivity).not.toHaveBeenCalled();
    expect(notifyTenant).not.toHaveBeenCalled();
  });
});
