import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DAVRANIŞ TESTİ: komisyon eylemleri — yetki reddi, 200 sınırı, zaten paid olanın atlanması, kasa hatasında
 * cashFailedIds, retry'da duplicate = başarı, tahsil edilmiş komisyonda paylaşım değişimi (rol + gerekçe + denetim kaydı).
 */
type Row = Record<string, unknown>;
let commissionRows: Row[] = [];
let updateReturns: Row[] = [];
let lastUpdatePayload: Row | null = null;
let lastInIds: string[] = [];
let lastStatusFilter: string[] | null = null;

const requirePermission = vi.fn();
const logActivity = vi.fn(async () => ({ ok: true }));
const recordCollectionCashResult = vi.fn();
const voidCollectionCash = vi.fn(async () => undefined);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...(a as [])) }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...(a as [])) }));
vi.mock("@/lib/finance/cash/collection-link", () => ({
  recordCollectionCashResult: (...a: unknown[]) => recordCollectionCashResult(...(a as [])),
  voidCollectionCash: (...a: unknown[]) => voidCollectionCash(...(a as [])),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let mode: "select" | "update" = "select";
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (payload: Row) => {
          mode = "update";
          lastUpdatePayload = payload;
          return chain;
        },
        in: (col: string, v: string[]) => {
          if (col === "id") lastInIds = v;
          if (col === "status") lastStatusFilter = v;
          return chain;
        },
        eq: () => chain,
        not: () => chain,
        maybeSingle: async () => ({ data: commissionRows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: mode === "update" ? updateReturns : commissionRows, error: null }),
      };
      return chain;
    },
  }),
}));

const ownerGate = { ok: true, tenantId: "t1", userId: "u1", role: "owner", impersonating: false };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

describe("komisyon eylemleri", () => {
  beforeEach(() => {
    commissionRows = [];
    updateReturns = [];
    lastUpdatePayload = null;
    lastInIds = [];
    lastStatusFilter = null;
    requirePermission.mockReset().mockResolvedValue(ownerGate);
    logActivity.mockClear();
    recordCollectionCashResult.mockReset().mockResolvedValue({ ok: true });
    voidCollectionCash.mockClear();
  });

  it("yetki reddinde hiçbir şey yazılmaz (toplu, yeniden deneme, paylaşım)", async () => {
    requirePermission.mockResolvedValue({ ok: false, error: "Bu işlem için yetkiniz yok." });
    const { markCommissionsPaidBulk, retryCommissionCash, updateCommissionSplits } = await import("./commissions");
    expect(await markCommissionsPaidBulk(["a"], "acc")).toMatchObject({ error: "Bu işlem için yetkiniz yok.", cashFailedIds: [], cashFailedCount: 0 });
    expect(await retryCommissionCash(["a"], "acc")).toMatchObject({ error: "Bu işlem için yetkiniz yok." });
    expect(await updateCommissionSplits("a", [{ label: "Ofis", rate: 100 }])).toMatchObject({ error: "Bu işlem için yetkiniz yok." });
    expect(requirePermission).toHaveBeenCalledWith("commissions", "edit");
    expect(recordCollectionCashResult).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("toplu tahsilat 200 kayıtla sınırlanır", async () => {
    updateReturns = [];
    const { markCommissionsPaidBulk } = await import("./commissions");
    await markCommissionsPaidBulk(ids(250), null);
    expect(lastInIds).toHaveLength(200);
  });

  it("zaten paid olan atlanır: yalnız güncellenen satırlar için kasa yazımı denenir", async () => {
    updateReturns = [{ id: "c1", gross_amount: 1000 }]; // c0 zaten paid -> update dönüşünde yok
    const { markCommissionsPaidBulk } = await import("./commissions");
    const res = await markCommissionsPaidBulk(["c0", "c1"], "acc");
    expect(res).toMatchObject({ ok: true, updated: 1, cashFailedIds: [], cashFailedCount: 0 });
    expect(recordCollectionCashResult).toHaveBeenCalledTimes(1);
    expect(recordCollectionCashResult.mock.calls[0]![1]).toMatchObject({ sourceId: "c1", sourceType: "commission", accountId: "acc" });
  });

  it("kasa hatasında cashFailedIds ve sayısı döner; son uyarı öncekileri ezmez", async () => {
    updateReturns = [
      { id: "c1", gross_amount: 100 },
      { id: "c2", gross_amount: 200 },
      { id: "c3", gross_amount: 300 },
    ];
    recordCollectionCashResult.mockImplementation(async (_s: unknown, a: { sourceId: string }) =>
      a.sourceId === "c2" ? { ok: true } : { ok: false, code: "rpc_error", warning: "uyarı" },
    );
    const { markCommissionsPaidBulk } = await import("./commissions");
    const res = await markCommissionsPaidBulk(["c1", "c2", "c3"], "acc");
    expect(res).toMatchObject({ ok: true, updated: 3, cashFailedIds: ["c1", "c3"], cashFailedCount: 2, info: "uyarı" });
  });

  it("retry: 200 üstü reddedilir; yalnız paid/collected okunur; duplicate başarı sayılır", async () => {
    const { retryCommissionCash } = await import("./commissions");
    expect(await retryCommissionCash(ids(201), "acc")).toMatchObject({ error: expect.stringContaining("200") });
    commissionRows = [
      { id: "c1", gross_amount: 100 },
      { id: "c2", gross_amount: 200 },
    ];
    recordCollectionCashResult.mockResolvedValueOnce({ ok: true, duplicate: true }).mockResolvedValueOnce({ ok: true });
    const res = await retryCommissionCash(["c1", "c2"], "acc");
    expect(lastStatusFilter).toEqual(["paid", "collected"]);
    expect(res).toMatchObject({ ok: true, recorded: 2, failedCount: 0, failedIds: [] });
  });

  it("retry: hâlâ başarısız olanlar failedIds ile döner", async () => {
    commissionRows = [{ id: "c1", gross_amount: 100 }, { id: "c2", gross_amount: 200 }];
    recordCollectionCashResult.mockResolvedValueOnce({ ok: false, code: "rpc_error", warning: "x" }).mockResolvedValueOnce({ ok: true });
    const { retryCommissionCash } = await import("./commissions");
    const res = await retryCommissionCash(["c1", "c2"], "acc");
    expect(res).toMatchObject({ ok: false, failedIds: ["c1"], failedCount: 1, recorded: 1 });
  });

  it("tahsil edilmiş komisyonda gerekçesiz paylaşım değişimi reddedilir ve gerekçe istenir", async () => {
    commissionRows = [{ gross_amount: 1000, status: "collected", splits: [{ label: "Ofis", rate: 100 }] }];
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }]);
    expect(res).toMatchObject({ needsReason: true });
    expect(res.ok).toBeUndefined();
    expect((await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }], "kısa")).needsReason).toBe(true);
    expect(lastUpdatePayload).toBeNull();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("tahsil edilmiş komisyonda owner/gm dışı rol değiştiremez", async () => {
    requirePermission.mockResolvedValue({ ...ownerGate, role: "accounting" });
    commissionRows = [{ gross_amount: 1000, status: "paid", splits: [] }];
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }], "geçerli gerekçe");
    expect(res.error).toContain("ofis sahibi veya genel müdür");
    expect(lastUpdatePayload).toBeNull();
  });

  it("tahsil edilmiş komisyonda owner gerekçeyle değiştirir; eski/yeni paylar ve gerekçe denetim kaydına yazılır", async () => {
    const old = [{ label: "Ofis", rate: 100 }];
    commissionRows = [{ gross_amount: 1000, status: "collected", splits: old }];
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }], "Sözleşmeye göre düzeltildi");
    expect(res.ok).toBe(true);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "commission.splits_updated",
        oldValue: expect.objectContaining({ splits: old }),
        newValue: expect.objectContaining({ reason: "Sözleşmeye göre düzeltildi" }),
      }),
    );
  });

  it("bekleyen komisyonda gerekçesiz (eski imza) çağrı çalışır ve yine denetim kaydı yazılır", async () => {
    requirePermission.mockResolvedValue({ ...ownerGate, role: "advisor" });
    commissionRows = [{ gross_amount: 1000, status: "calculated", splits: [] }];
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100 }]);
    expect(res.ok).toBe(true);
    expect(logActivity).toHaveBeenCalledTimes(1);
  });
});
