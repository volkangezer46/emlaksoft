import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTableMock, type MockRow } from "@/lib/test-support/supabase-table-mock";

/**
 * DAVRANIŞ TESTİ: komisyon eylemleri — yetki reddi, 200 sınırı, zaten paid olanın atlanması, kiracı sınırı, kasa hatasında
 * cashFailedIds, retry'da duplicate = başarı, hesap zorunluluğu (SK6/B109), kasaya KDV dahil tutar, tahsil edilmiş komisyonda
 * paylaşım değişimi (rol + gerekçe + denetim kaydı).
 *
 * SK6/B180: sahte Supabase istemcisi süzgeçleri KAYDEDER ve satırlara UYGULAR (`createTableMock`). Eylemdeki çift tahsilat
 * süzgeci (`.not("status","in","(paid,collected)")`) ya da kiracı süzgeci (`.eq("tenant_id", …)`) silinirse testler kırılır.
 */
type Mock = ReturnType<typeof createTableMock>;
let db: Mock;

const requirePermission = vi.fn();
const logActivity = vi.fn(async () => ({ ok: true }));
const recordCollectionCashResult = vi.fn();
const voidCollectionCash = vi.fn(async () => undefined);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...(a as [])) }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...(a as [])) }));
// Hesap kararı ve KDV dahil tutar GERÇEK kodla çalışır; yalnız RPC çağıran yazım/iptal sahtedir.
vi.mock("@/lib/finance/cash/collection-link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/cash/collection-link")>()),
  recordCollectionCashResult: (...a: unknown[]) => recordCollectionCashResult(...(a as [])),
  voidCollectionCash: (...a: unknown[]) => voidCollectionCash(...(a as [])),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));

const T = "t1";
const ACC = "11111111-1111-4111-8111-111111111111";
const ownerGate = { ok: true, tenantId: T, userId: "u1", role: "owner", impersonating: false };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
const comm = (id: string, status: string, gross: number, vat = 0, tenant = T): MockRow => ({ id, tenant_id: tenant, status, gross_amount: gross, vat_amount: vat, splits: [] });
const officeAccount = { id: ACC, tenant_id: T, owner_scope: "office", archived_at: null };

function setup(commissions: MockRow[], accounts: MockRow[] = [officeAccount]) {
  db = createTableMock({ commissions, finance_accounts: accounts });
  return db;
}

describe("komisyon eylemleri", () => {
  beforeEach(() => {
    setup([]);
    requirePermission.mockReset().mockResolvedValue(ownerGate);
    logActivity.mockClear();
    recordCollectionCashResult.mockReset().mockResolvedValue({ ok: true });
    voidCollectionCash.mockClear();
  });

  it("yetki reddinde hiçbir şey yazılmaz (toplu, yeniden deneme, paylaşım)", async () => {
    requirePermission.mockResolvedValue({ ok: false, error: "Bu işlem için yetkiniz yok." });
    const { markCommissionsPaidBulk, retryCommissionCash, updateCommissionSplits } = await import("./commissions");
    expect(await markCommissionsPaidBulk(["a"], ACC)).toMatchObject({ error: "Bu işlem için yetkiniz yok.", cashFailedIds: [], cashFailedCount: 0 });
    expect(await retryCommissionCash(["a"], ACC)).toMatchObject({ error: "Bu işlem için yetkiniz yok." });
    expect(await updateCommissionSplits("a", [{ label: "Ofis", rate: 100 }])).toMatchObject({ error: "Bu işlem için yetkiniz yok." });
    expect(requirePermission).toHaveBeenCalledWith("commissions", "edit");
    expect(recordCollectionCashResult).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(db.log).toHaveLength(0);
  });

  it("toplu tahsilat 200 kayıtla sınırlanır", async () => {
    const { markCommissionsPaidBulk } = await import("./commissions");
    await markCommissionsPaidBulk(ids(250), ACC);
    const upd = db.log.find((q) => q.table === "commissions" && q.kind === "update")!;
    expect((upd.filters.find((f) => f.op === "in" && f.col === "id")!.val as string[]).length).toBe(200);
  });

  it("zaten paid/collected olan atlanır: yalnız güncellenen satır için kasa yazımı denenir (çift tahsilat süzgeci)", async () => {
    setup([comm("c0", "paid", 500), comm("c1", "calculated", 1000), comm("c2", "collected", 700)]);
    const { markCommissionsPaidBulk } = await import("./commissions");
    const res = await markCommissionsPaidBulk(["c0", "c1", "c2"], ACC);
    expect(res).toMatchObject({ ok: true, updated: 1, cashFailedIds: [], cashFailedCount: 0 });
    expect(db.hasFilter("commissions", "not.in", "status", "(paid,collected)", "update")).toBe(true);
    expect(recordCollectionCashResult).toHaveBeenCalledTimes(1);
    expect(recordCollectionCashResult.mock.calls[0]![1]).toMatchObject({ sourceId: "c1", sourceType: "commission", accountId: ACC });
    // collected durumu paid'e çevrilmez (geri gidiş yok).
    expect(db.tables.commissions.find((r) => r.id === "c2")!.status).toBe("collected");
  });

  it("ikinci işaretleme hiçbir satırı güncellemez ve kasaya ikinci kez yazmaz (idempotent)", async () => {
    setup([comm("c1", "calculated", 1000, 200)]);
    const { markCommissionsPaidBulk } = await import("./commissions");
    expect(await markCommissionsPaidBulk(["c1"], ACC)).toMatchObject({ ok: true, updated: 1 });
    expect(await markCommissionsPaidBulk(["c1"], ACC)).toMatchObject({ ok: true, updated: 0 });
    expect(recordCollectionCashResult).toHaveBeenCalledTimes(1);
  });

  it("kiracı sınırı: başka ofisin aynı kimlikli kaydı güncellenmez (tenant_id süzgeci)", async () => {
    setup([comm("c1", "calculated", 1000), comm("x1", "calculated", 9000, 0, "t2")]);
    const { markCommissionsPaidBulk } = await import("./commissions");
    const res = await markCommissionsPaidBulk(["c1", "x1"], ACC);
    expect(res).toMatchObject({ ok: true, updated: 1 });
    expect(db.hasFilter("commissions", "eq", "tenant_id", T, "update")).toBe(true);
    expect(db.tables.commissions.find((r) => r.id === "x1")!.status).toBe("calculated");
    expect(recordCollectionCashResult.mock.calls.map((c) => (c[1] as { sourceId: string }).sourceId)).toEqual(["c1"]);
  });

  it("B109: kasaya KDV DAHİL tutar yazılır (gross_amount KDV hariç matrah)", async () => {
    setup([comm("c1", "calculated", 192000, 38400)]);
    const { markCommissionsPaidBulk } = await import("./commissions");
    await markCommissionsPaidBulk(["c1"], ACC);
    expect(recordCollectionCashResult.mock.calls[0]![1]).toMatchObject({ amount: 230400 });
  });

  it("B109: ofiste hesap varsa hesapsız işaretleme reddedilir ve hiçbir satır değişmez", async () => {
    setup([comm("c1", "calculated", 1000)]);
    const { markCommissionsPaidBulk } = await import("./commissions");
    const res = await markCommissionsPaidBulk(["c1"], null);
    expect(res.error).toContain("hesabı seçin");
    expect(res.needsCashConfirm).toBeUndefined();
    // "Kasaya yazmadan" onayı hesap varken geçmez.
    expect((await markCommissionsPaidBulk(["c1"], null, { skipCash: true })).error).toContain("hesabı seçin");
    expect(db.tables.commissions[0]!.status).toBe("calculated");
    expect(recordCollectionCashResult).not.toHaveBeenCalled();
  });

  it("B109: ofiste hesap yoksa önce bilinçli onay istenir; onayla kasaya yazmadan işaretlenir", async () => {
    setup([comm("c1", "calculated", 1000)], []);
    const { markCommissionsPaidBulk } = await import("./commissions");
    const first = await markCommissionsPaidBulk(["c1"], null);
    expect(first).toMatchObject({ needsCashConfirm: true });
    expect(db.tables.commissions[0]!.status).toBe("calculated");
    const res = await markCommissionsPaidBulk(["c1"], null, { skipCash: true });
    expect(res).toMatchObject({ ok: true, updated: 1 });
    expect(recordCollectionCashResult).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ newValue: expect.objectContaining({ cash_skipped: true }) }));
  });

  it("kasa hatasında cashFailedIds ve sayısı döner; son uyarı öncekileri ezmez", async () => {
    setup([comm("c1", "calculated", 100), comm("c2", "calculated", 200), comm("c3", "calculated", 300)]);
    recordCollectionCashResult.mockImplementation(async (_s: unknown, a: { sourceId: string }) =>
      a.sourceId === "c2" ? { ok: true } : { ok: false, code: "rpc_error", warning: "uyarı" },
    );
    const { markCommissionsPaidBulk } = await import("./commissions");
    const res = await markCommissionsPaidBulk(["c1", "c2", "c3"], ACC);
    expect(res).toMatchObject({ ok: true, updated: 3, cashFailedIds: ["c1", "c3"], cashFailedCount: 2, info: "uyarı" });
  });

  it("retry: 200 üstü reddedilir; yalnız bu ofisin paid/collected kayıtları okunur; duplicate başarı sayılır; tutar KDV dahil", async () => {
    const { retryCommissionCash } = await import("./commissions");
    expect(await retryCommissionCash(ids(201), ACC)).toMatchObject({ error: expect.stringContaining("200") });
    setup([comm("c1", "paid", 100, 20), comm("c2", "collected", 200), comm("c3", "calculated", 300), comm("c4", "paid", 999, 0, "t2")]);
    recordCollectionCashResult.mockResolvedValueOnce({ ok: true, duplicate: true }).mockResolvedValueOnce({ ok: true });
    const res = await retryCommissionCash(["c1", "c2", "c3", "c4"], ACC);
    expect(db.hasFilter("commissions", "in", "status", ["paid", "collected"], "select")).toBe(true);
    expect(db.hasFilter("commissions", "eq", "tenant_id", T, "select")).toBe(true);
    expect(res).toMatchObject({ ok: true, recorded: 2, failedCount: 0, failedIds: [] });
    expect(recordCollectionCashResult.mock.calls.map((c) => [(c[1] as { sourceId: string }).sourceId, (c[1] as { amount: number }).amount])).toEqual([
      ["c1", 120],
      ["c2", 200],
    ]);
  });

  it("retry: hâlâ başarısız olanlar failedIds ile döner", async () => {
    setup([comm("c1", "paid", 100), comm("c2", "paid", 200)]);
    recordCollectionCashResult.mockResolvedValueOnce({ ok: false, code: "rpc_error", warning: "x" }).mockResolvedValueOnce({ ok: true });
    const { retryCommissionCash } = await import("./commissions");
    const res = await retryCommissionCash(["c1", "c2"], ACC);
    expect(res).toMatchObject({ ok: false, failedIds: ["c1"], failedCount: 1, recorded: 1 });
  });

  it("tahsil edilmiş komisyonda gerekçesiz paylaşım değişimi reddedilir ve gerekçe istenir", async () => {
    setup([{ ...comm("c1", "collected", 1000), splits: [{ label: "Ofis", rate: 100 }] }]);
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }]);
    expect(res).toMatchObject({ needsReason: true });
    expect(res.ok).toBeUndefined();
    expect((await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }], "kısa")).needsReason).toBe(true);
    expect(db.log.some((q) => q.kind === "update")).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("tahsil edilmiş komisyonda owner/gm dışı rol değiştiremez", async () => {
    requirePermission.mockResolvedValue({ ...ownerGate, role: "accounting" });
    setup([comm("c1", "paid", 1000)]);
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }], "geçerli gerekçe");
    expect(res.error).toContain("ofis sahibi veya genel müdür");
    expect(db.log.some((q) => q.kind === "update")).toBe(false);
  });

  it("tahsil edilmiş komisyonda owner gerekçeyle değiştirir; eski/yeni paylar ve gerekçe denetim kaydına yazılır", async () => {
    const old = [{ label: "Ofis", rate: 100 }];
    setup([{ ...comm("c1", "collected", 1000), splits: old }]);
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100, party: "office" }], "Sözleşmeye göre düzeltildi");
    expect(res.ok).toBe(true);
    expect(db.hasFilter("commissions", "eq", "tenant_id", T, "update")).toBe(true);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "commission.splits_updated",
        oldValue: expect.objectContaining({ splits: old }),
        newValue: expect.objectContaining({ reason: "Sözleşmeye göre düzeltildi" }),
      }),
    );
  });

  it("başka ofisin komisyonu paylaşım için okunamaz (kiracı süzgeci)", async () => {
    setup([comm("x1", "calculated", 1000, 0, "t2")]);
    const { updateCommissionSplits } = await import("./commissions");
    expect((await updateCommissionSplits("x1", [{ label: "Ofis", rate: 100, party: "office" }])).error).toContain("bulunamadı");
    expect(db.log.some((q) => q.kind === "update")).toBe(false);
  });

  it("bekleyen komisyonda gerekçesiz (eski imza) çağrı çalışır ve yine denetim kaydı yazılır", async () => {
    requirePermission.mockResolvedValue({ ...ownerGate, role: "advisor" });
    setup([comm("c1", "calculated", 1000)]);
    const { updateCommissionSplits } = await import("./commissions");
    const res = await updateCommissionSplits("c1", [{ label: "Ofis", rate: 100 }]);
    expect(res.ok).toBe(true);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(db.tables.commissions[0]!.splits).toEqual([{ label: "Ofis", rate: 100, amount: 1000 }]);
  });
});
