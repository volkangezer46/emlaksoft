import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Portal istekleri v2 server action sözleşmesi: token/tür/uuid biçimi (RPC'ye gitmeden), IP oran sınırı, RPC yükü eşlemesi;
 * danışman kararlarında yetki kapısı (portal doğrudan yazmaz, onay yetkisiz yapılamaz).
 */
const rpc = vi.fn();
const rate = vi.fn();
const gate = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rate(...a), clientIp: async () => "1.2.3.4" }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => gate(...a) }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => ({ ok: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/geo/reader", () => ({ getDistricts: async () => [] }));
vi.mock("@/app/actions/rental-finance", () => ({ recordRentPayment: async () => ({ ok: true }) }));

const TOKEN = "a".repeat(64);
const ID = "0a1b2c3d-0000-4000-8000-000000000001";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("submitPortalRequest (v2 türleri)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rate.mockReset();
    rate.mockResolvedValue({ allowed: true });
    rpc.mockResolvedValue({ data: { ok: true, code: "ok" }, error: null });
  });

  it("geçersiz token / tür / kimlik RPC'ye gitmeden reddedilir", async () => {
    const { submitPortalRequest } = await import("./customer-portal-requests");
    expect((await submitPortalRequest(form({ token: "kisa", kind: "visit", ref_id: ID }))).ok).toBe(false);
    expect((await submitPortalRequest(form({ token: TOKEN, kind: "hack", ref_id: ID }))).ok).toBe(false);
    expect((await submitPortalRequest(form({ token: TOKEN, kind: "rent_paid", ref_id: "x" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("IP oran sınırı aşılırsa RPC çağrılmaz", async () => {
    rate.mockResolvedValue({ allowed: false });
    const { submitPortalRequest } = await import("./customer-portal-requests");
    const r = await submitPortalRequest(form({ token: TOKEN, kind: "visit", ref_id: ID }));
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gösterim talebi, arayış güncelleme ve Ödedim doğru RPC yüküyle gider", async () => {
    const { submitPortalRequest } = await import("./customer-portal-requests");
    await submitPortalRequest(form({ token: TOKEN, kind: "visit", ref_id: ID, preferred: "Cumartesi" }));
    expect(rpc).toHaveBeenLastCalledWith("portal_customer_request", { p_token: TOKEN, p_kind: "visit", p_payload: expect.objectContaining({ property_id: ID, preferred: "Cumartesi" }) });

    await submitPortalRequest(form({ token: TOKEN, kind: "demand_update", ref_id: ID, budget_max: "8.500.000", rooms: "3+1", area: "Kadıköy" }));
    expect(rpc).toHaveBeenLastCalledWith("portal_customer_request", {
      p_token: TOKEN,
      p_kind: "demand_update",
      p_payload: expect.objectContaining({ demand_id: ID, budget_min: null, budget_max: 8500000, rooms: "3+1", area: "Kadıköy" }),
    });

    await submitPortalRequest(form({ token: TOKEN, kind: "rent_paid", ref_id: ID, reference: "Dekont 4471" }));
    expect(rpc).toHaveBeenLastCalledWith("portal_customer_request", { p_token: TOKEN, p_kind: "rent_paid", p_payload: expect.objectContaining({ charge_id: ID, reference: "Dekont 4471" }) });
  });

  it("RPC kodları kullanıcı mesajına çevrilir (geçersiz bağlantı / boş güncelleme)", async () => {
    const { submitPortalRequest } = await import("./customer-portal-requests");
    rpc.mockResolvedValue({ data: { ok: false, code: "invalid_link" }, error: null });
    expect((await submitPortalRequest(form({ token: TOKEN, kind: "visit", ref_id: ID }))).message).toMatch(/geçersiz/i);
    rpc.mockResolvedValue({ data: { ok: false, code: "nothing_to_update" }, error: null });
    const r = await submitPortalRequest(form({ token: TOKEN, kind: "demand_update", ref_id: ID }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/en az bir alan/);
  });
});

describe("danışman kararları yetki kapısı", () => {
  beforeEach(() => gate.mockReset());

  it("yetkisiz kullanıcı arayış isteğini onaylayamaz, Ödedim'i teyit/reddedemez", async () => {
    gate.mockResolvedValue({ ok: false, error: "Bu işlem için yetkiniz yok." });
    const { decideDemandUpdate, confirmRentNotice, rejectRentNotice } = await import("./portal-requests-review");
    expect(await decideDemandUpdate(ID, "approve")).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(await confirmRentNotice({ noticeId: ID })).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(await rejectRentNotice(ID)).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(gate).toHaveBeenCalledWith("customers", "edit");
    expect(gate).toHaveBeenCalledWith("rentals", "edit");
  });

  it("geçersiz kimlik yetki sonrası da reddedilir", async () => {
    gate.mockResolvedValue({ ok: true, userId: "u", tenantId: "t", role: "owner", impersonating: false });
    const { decideDemandUpdate, rejectRentNotice } = await import("./portal-requests-review");
    expect((await decideDemandUpdate("x", "approve")).error).toBeTruthy();
    expect((await rejectRentNotice("x")).error).toBeTruthy();
  });
});
