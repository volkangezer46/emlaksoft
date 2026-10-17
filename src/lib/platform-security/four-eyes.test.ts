import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F10: dört göz izni başarısız eylemde YANMAZ.
 *  - Eylemin SQL sarmalayıcısı varsa (`deferConsume`) kapı izni yalnız DOĞRULAR (`platform_peek_approval`), tüketmez;
 *    tüketim + eylem + denetim satırı SQL'de tek transaction'dır (pglite: office-sessions-service-only-sql-exec.test.ts).
 *  - Sarmalayıcısı olmayan eylem hata verirse `releaseConsumedApproval` izni geri bırakır (`platform_release_approval`).
 */
const rpc = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => [] as { action: string }[]);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => ({}) }) }));
vi.mock("@/lib/settings/read", () => ({ getSettings: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]))) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: vi.fn(async (a: { action: string }) => void audit.push(a)) }));
vi.mock("@/lib/platform-notify", () => ({ notifyPlatformStaff: vi.fn(async () => undefined) }));

const { releaseConsumedApproval, sensitiveFourEyesGate } = await import("./four-eyes");

const APPROVAL = "00000000-0000-4000-8000-0000000000aa";
const base = { kind: "session_revoke" as const, staffId: "staff-ops", entityType: "profile", entityId: "user-1", binding: { id: "user-1" }, summary: "Tüm oturumları kapat · gerekçe" };

describe("sensitiveFourEyesGate — ertelenmiş tüketim", () => {
  beforeEach(() => {
    rpc.mockReset();
    audit.length = 0;
  });

  it("deferConsume: izin peek ile doğrulanır, TÜKETİLMEZ ve 'consumed' denetimi yazılmaz", async () => {
    rpc.mockResolvedValueOnce({ data: APPROVAL, error: null });
    const r = await sensitiveFourEyesGate({ ...base, deferConsume: true });
    expect(r).toEqual({ proceed: true, approvalId: APPROVAL });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe("platform_peek_approval");
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_kind: "session_revoke", p_entity_type: "profile", p_entity_id: "user-1", p_staff_id: "staff-ops", p_payload: { id: "user-1" } });
    expect(rpc.mock.calls.some((c) => c[0] === "platform_consume_approval")).toBe(false);
    expect(audit).toEqual([]);
  });

  it("varsayılan (sarmalayıcısız) yol eskisi gibi tüketir ve denetler", async () => {
    rpc.mockResolvedValueOnce({ data: APPROVAL, error: null });
    const r = await sensitiveFourEyesGate(base);
    expect(r).toEqual({ proceed: true, approvalId: APPROVAL });
    expect(rpc.mock.calls[0]![0]).toBe("platform_consume_approval");
    expect(audit.map((a) => a.action)).toEqual(["platform.approval.consumed"]);
  });

  it("peek fonksiyonu yoksa işlem YÜRÜMEZ (sessizce tek imza yok)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } });
    const r = await sensitiveFourEyesGate({ ...base, deferConsume: true });
    expect(r).toMatchObject({ proceed: false });
  });
});

describe("releaseConsumedApproval — başarısız eylem izni yakmaz", () => {
  beforeEach(() => {
    rpc.mockReset();
    audit.length = 0;
  });

  it("tüketilen izin geri bırakılır (executed → approved) ve denetlenir", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await releaseConsumedApproval(APPROVAL, "staff-ops", "Örnek veriler yüklenemedi.");
    expect(rpc).toHaveBeenCalledWith("platform_release_approval", { p_id: APPROVAL, p_staff_id: "staff-ops", p_error: "Örnek veriler yüklenemedi." });
    expect(audit.map((a) => a.action)).toEqual(["platform.approval.released"]);
  });

  it("izin yoksa (dört göz kapalı) hiçbir çağrı yapılmaz", async () => {
    await releaseConsumedApproval(null, "staff-ops", "x");
    expect(rpc).not.toHaveBeenCalled();
  });
});
