import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F5 + F2 (purge.ts): RPC'den ÖNCE hiçbir silme çalışmaz; RPC hata verirse modül adımı hiç koşmamıştır ve "hiçbir şey
 * silinmedi" doğrudur. v2+ RPC başarıda da modül adımı koşmaz (RPC içeride yapar); yalnız RPC yokken ya da v1 RPC başarıyla
 * döndükten SONRA koşar. ES409 (gerçek çocuk kayıt) engel listesine çevrilir.
 */
const order: string[] = [];
vi.mock("@/lib/sample-data/purge-extras", () => ({
  purgeSampleModuleData: vi.fn(async () => {
    order.push("extras");
    return { deleted: {}, failed: [] };
  }),
}));
vi.mock("@/lib/sample-clear", () => ({
  deleteSampleRecords: vi.fn(async () => {
    order.push("fallback-delete");
    return { deleted: { customers: 1 }, unavailable: [], failed: [], totalDeleted: 1, complete: true };
  }),
}));

const { purgeSampleData, blockersFromDetail, blockersMessage, PURGE_REAL_CHILDREN_CODE } = await import("./purge");
const { blockerHref } = await import("./purge-blockers");
const { purgeSampleModuleData } = await import("@/lib/sample-data/purge-extras");

const admin = { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) };
const sessionWith = (result: { data: unknown; error: unknown }) => ({
  rpc: vi.fn(async () => {
    order.push("rpc");
    return result;
  }),
});

describe("purgeSampleData — ön adım ve hata metni (F5)", () => {
  beforeEach(() => {
    order.length = 0;
    vi.mocked(purgeSampleModuleData).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("RPC hata verirse modül adımı HİÇ koşmamıştır; 'hiçbir şey silinmedi' doğrudur", async () => {
    const session = sessionWith({ data: null, error: { code: "XX000", message: "boom" } });
    const res = await purgeSampleData({ session: session as never, tenantId: "t-1", fallbackAdmin: admin as never });
    expect(order).toEqual(["rpc"]);
    expect(purgeSampleModuleData).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toMatch(/hiçbir şey silinmedi/);
  });

  it("23503 (gerçek kayıt örneğe bağlı) yine ön adımsız; mesaj doğru", async () => {
    const session = sessionWith({ data: null, error: { code: "23503", message: "fk" } });
    const res = await purgeSampleData({ session: session as never, tenantId: "t-1", fallbackAdmin: admin as never });
    expect(order).toEqual(["rpc"]);
    expect(res.ok ? "" : res.error).toMatch(/hiçbir şey silinmedi/);
  });

  it("v2+ RPC başarıda modül adımı koşmaz (RPC kendi transaction'ında yapar)", async () => {
    const session = sessionWith({ data: { deleted: { customers: 3 }, personas_removed: [], personas_kept: [] }, error: null });
    const res = await purgeSampleData({ session: session as never, tenantId: "t-1", fallbackAdmin: admin as never });
    expect(res).toMatchObject({ ok: true, via: "rpc", report: { totalDeleted: 3 } });
    expect(order).toEqual(["rpc"]);
  });

  it("v1 RPC başarıyla dönerse modül adımı ARDINDAN koşar", async () => {
    const session = sessionWith({ data: { deleted: { customers: 3 } }, error: null });
    await purgeSampleData({ session: session as never, tenantId: "t-1", fallbackAdmin: admin as never });
    expect(order).toEqual(["rpc", "extras"]);
  });

  it("RPC yoksa eski yol: modül adımı + tablo tablo silme (RPC denemesinden sonra)", async () => {
    const session = sessionWith({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const res = await purgeSampleData({ session: session as never, tenantId: "t-1", fallbackAdmin: admin as never });
    expect(res).toMatchObject({ ok: true, via: "fallback" });
    expect(order).toEqual(["rpc", "extras", "fallback-delete"]);
  });
});

const P1 = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";

describe("purgeSampleData — ES409 gerçek çocuk kayıt (F2)", () => {
  const detail = JSON.stringify({
    total: 3,
    tables: [
      { table: "offers", parent: "properties", column: "property_id", count: 2 },
      { table: "iys_consents", parent: "customers", column: "customer_id", count: 1 },
    ],
    rows: [
      { table: "offers", id: "o1", parent: "properties", parent_id: P1, parent_label: "Kadıköy 3+1" },
      { table: "offers", id: "o2", parent: "properties", parent_id: P1, parent_label: "Kadıköy 3+1" },
      { table: "iys_consents", id: "i1", parent: "customers", parent_id: C1, parent_label: "Selin Aksoy" },
    ],
  });

  it("ES409 engel listesine çevrilir, silme yok, mesaj kayıtları adıyla sayar", async () => {
    order.length = 0;
    const session = sessionWith({ data: null, error: { code: PURGE_REAL_CHILDREN_CODE, message: "SAMPLE_PURGE_REAL_CHILDREN", details: detail } });
    const res = await purgeSampleData({ session: session as never, tenantId: "t-1", fallbackAdmin: admin as never });
    expect(order).toEqual(["rpc"]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.blockers).toEqual([
      { table: "offers", label: "Teklif", count: 2, parent: "properties", examples: ["Kadıköy 3+1"], firstParentId: P1 },
      { table: "iys_consents", label: "İYS onayı", count: 1, parent: "customers", examples: ["Selin Aksoy"], firstParentId: C1 },
    ]);
    expect(res.error).toBe("Örnek kayıtlara bağlı gerçek kayıtlar var: 2 Teklif (Kadıköy 3+1), 1 İYS onayı (Selin Aksoy). Örnek veriyle birlikte silinmemeleri için önce bunları gerçek bir müşteri/portföye taşıyın ya da kaldırın; hiçbir şey silinmedi.");
  });

  it("bozuk ayrıntı boş liste verir; bilinmeyen tablo adıyla gösterilir", () => {
    expect(blockersFromDetail("{bozuk")).toEqual([]);
    expect(blockersFromDetail(null)).toEqual([]);
    const b = blockersFromDetail({ tables: [{ table: "yeni_modul", parent: "customers", count: 1 }], rows: [] });
    expect(b).toEqual([{ table: "yeni_modul", label: "yeni_modul", count: 1, parent: "customers", examples: [], firstParentId: null }]);
    expect(blockersMessage(b)).toContain("1 yeni_modul");
    expect(blockerHref({ parent: "properties", firstParentId: P1 })).toBe(`/app/portfoyler/${P1}`);
    expect(blockerHref({ parent: "customers", firstParentId: null })).toBe("/app/musteriler");
  });
});
