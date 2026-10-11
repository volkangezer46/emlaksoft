import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * confirmRentNotice (GUVENLIK-3): bildirim ÖNCE sahiplenilir ("pending -> confirmed", decideDemandUpdate deseni), tahsilat
 * ANCAK sahiplenen çağrıda kaydedilir; tahsilat başarısızsa sahiplik geri bırakılır; geri bırakma da başarısızsa kod loglanır.
 */
const gate = vi.fn();
const record = vi.fn();
const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
let claimResult: { data: unknown; error: unknown };
let rollbackResult: { error: unknown };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => gate(...a) }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => ({ ok: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/geo/reader", () => ({ getDistricts: async () => [] }));
vi.mock("@/app/actions/rental-finance", () => ({ recordRentPayment: (...a: unknown[]) => record(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const entry = { patch, filters: [] as [string, unknown][] };
        updates.push(entry);
        const chain: Record<string, unknown> = {};
        chain.eq = (k: string, v: unknown) => (entry.filters.push([k, v]), chain);
        chain.select = () => chain;
        chain.maybeSingle = async () => claimResult;
        // select() çağrılmayan güncelleme (geri bırakma) doğrudan await edilir.
        chain.then = (resolve: (v: unknown) => unknown) => resolve(rollbackResult);
        return chain;
      },
    }),
  }),
}));

const ID = "0a1b2c3d-0000-4000-8000-000000000001";
const NOTICE = { id: ID, rental_id: "0a1b2c3d-0000-4000-8000-000000000002", charge_id: "0a1b2c3d-0000-4000-8000-000000000003", amount: 1500, reference: "Ekim kirası" };

beforeEach(() => {
  updates.length = 0;
  gate.mockReset();
  record.mockReset();
  gate.mockResolvedValue({ ok: true, userId: "u1", tenantId: "t1", role: "owner", impersonating: false });
  claimResult = { data: NOTICE, error: null };
  rollbackResult = { error: null };
  record.mockResolvedValue({ ok: true });
});

describe("confirmRentNotice", () => {
  it("önce bekleyen bildirimi sahiplenir, sonra tahsilatı kaydeder", async () => {
    const { confirmRentNotice } = await import("./portal-requests-review");
    const r = await confirmRentNotice({ noticeId: ID });
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.patch).toMatchObject({ status: "confirmed", decided_by: "u1" });
    expect(updates[0]!.filters).toEqual(expect.arrayContaining([["id", ID], ["tenant_id", "t1"], ["status", "pending"]]));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ chargeId: NOTICE.charge_id, rentalId: NOTICE.rental_id, amount: 1500, method: "bank_transfer" }));
  });

  it("zaten karara bağlanmışsa (sahiplenemedi) tahsilat KAYDEDİLMEZ", async () => {
    claimResult = { data: null, error: null };
    const { confirmRentNotice } = await import("./portal-requests-review");
    const r = await confirmRentNotice({ noticeId: ID });
    expect(r).toEqual({ error: "Bu bildirim zaten karara bağlanmış." });
    expect(record).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
  });

  it("tahsilat başarısızsa sahiplik pending'e geri bırakılır ve hata döner", async () => {
    record.mockResolvedValue({ ok: false, error: "Fazla ödeme." });
    const { confirmRentNotice } = await import("./portal-requests-review");
    const r = await confirmRentNotice({ noticeId: ID });
    expect(r).toEqual({ error: "Fazla ödeme." });
    expect(updates).toHaveLength(2);
    expect(updates[1]!.patch).toEqual({ status: "pending", decided_by: null, decided_at: null });
    expect(updates[1]!.filters).toEqual(expect.arrayContaining([["id", ID], ["tenant_id", "t1"], ["status", "confirmed"]]));
  });

  it("geri bırakma da başarısızsa kod loglanır (hata yine kullanıcıya döner)", async () => {
    record.mockResolvedValue({ ok: false, error: "Tahsilat kaydedilemedi." });
    rollbackResult = { error: { code: "XX000" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { confirmRentNotice } = await import("./portal-requests-review");
    const r = await confirmRentNotice({ noticeId: ID });
    expect(r.error).toBe("Tahsilat kaydedilemedi.");
    expect(spy).toHaveBeenCalledWith("confirmRentNotice rollback", expect.objectContaining({ code: "XX000" }));
    spy.mockRestore();
  });
});
