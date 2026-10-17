import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-2/F3: ofis oturumu RPC'leri yalnız service_role'a açık; service istemcisi ANCAK hız/rol kapısı, gerekçe, doğrulayıcı
 * kodu ve dört göz geçtikten SONRA kurulur. Personel kimliği + izin kimliği RPC'ye gider (SQL yeniden denetler, izni
 * aynı transaction'da tüketir); dört göz kapısı ertelenmiş tüketimle (deferConsume) çağrılır.
 */
const calls = vi.hoisted(() => ({ admin: 0, rpc: [] as [string, Record<string, unknown>][] }));
const state = vi.hoisted(() => ({
  gate: { staff: { id: "staff-ops" } } as unknown,
  step: { ok: true } as { ok: boolean; error?: string },
  four: { proceed: true, approvalId: "appr-1" } as unknown,
  rpcResult: { data: [{ user_id: "u1", tenant_id: "t1" }], error: null } as { data: unknown; error: unknown },
}));
const fourEyesSpy = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "85.1.1.1", "user-agent": "Chrome" }) }));
vi.mock("@/lib/platform-guards", () => ({ guardPlatformAction: vi.fn(async () => state.gate) }));
vi.mock("@/lib/platform-security/step-up", () => ({ requireStepUp: vi.fn(async () => state.step) }));
vi.mock("@/lib/platform-security/four-eyes", () => ({
  sensitiveFourEyesGate: fourEyesSpy.mockImplementation(async () => state.four),
}));
vi.mock("@/lib/platform-activity", () => ({ clientIpFrom: (h: Headers) => h.get("x-real-ip") }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    calls.admin += 1;
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.rpc.push([fn, args]);
        return state.rpcResult;
      },
    };
  },
}));

const { closeOfficeSession, closeOfficeUserSessions } = await import("./admin-office-sessions");

const SESSION = "a1111111-1111-4111-8111-111111111111";
const USER = "66666666-6666-4666-8666-666666666666";
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const one = () => form({ session_id: SESSION, user_id: USER, reason: "Kayıp cihaz bildirimi", step_up_code: "123456" });
const all = () => form({ user_id: USER, reason: "Şüpheli giriş bildirildi", step_up_code: "123456" });

describe("admin-office-sessions — service istemcisi yalnız kapılardan sonra", () => {
  beforeEach(() => {
    calls.admin = 0;
    calls.rpc = [];
    fourEyesSpy.mockClear();
    state.gate = { staff: { id: "staff-ops" } };
    state.step = { ok: true };
    state.four = { proceed: true, approvalId: "appr-1" };
    state.rpcResult = { data: [{ user_id: "u1", tenant_id: "t1" }], error: null };
  });

  it("rol/hız kapısı reddederse service istemcisi kurulmaz", async () => {
    state.gate = { error: "Yetkiniz yok." };
    expect(await closeOfficeSession(one())).toEqual({ error: "Yetkiniz yok." });
    expect(calls.admin).toBe(0);
  });

  it("gerekçe kısa ya da doğrulayıcı kodu yanlışsa service istemcisi kurulmaz", async () => {
    expect((await closeOfficeSession(form({ session_id: SESSION, reason: "kısa" }))).error).toMatch(/Gerekçe/);
    state.step = { ok: false, error: "Kod hatalı." };
    expect(await closeOfficeUserSessions(all())).toEqual({ error: "Kod hatalı." });
    expect(calls.admin).toBe(0);
  });

  it("dört göz talebi açıldıysa (onay bekliyor) service istemcisi kurulmaz", async () => {
    state.four = { proceed: false, queued: true, notice: "İkinci onaya gönderildi." };
    expect(await closeOfficeSession(one())).toEqual({ notice: "İkinci onaya gönderildi." });
    expect(calls.admin).toBe(0);
  });

  it("tüm kapılar geçince: deferConsume ile kapı, ardından service RPC'si personel + izin kimliğiyle", async () => {
    expect(await closeOfficeSession(one())).toEqual({ ok: true, count: 1 });
    expect(fourEyesSpy.mock.calls[0]![0]).toMatchObject({ kind: "session_revoke", entityType: "auth_session", entityId: SESSION, deferConsume: true });
    expect(calls.admin).toBe(1);
    expect(calls.rpc).toEqual([
      ["platform_revoke_office_session", { p_session_id: SESSION, p_actor_staff_id: "staff-ops", p_reason: "Kayıp cihaz bildirimi", p_approval_id: "appr-1", p_ip: "85.1.1.1", p_user_agent: "Chrome" }],
    ]);
  });

  it("kullanıcının tüm oturumları: aynı sıra; RPC hatası Türkçe mesaja çevrilir (izin SQL'de geri alınır)", async () => {
    state.four = { proceed: true, approvalId: null };
    state.rpcResult = { data: 3, error: null };
    expect(await closeOfficeUserSessions(all())).toEqual({ ok: true, count: 3 });
    expect(calls.rpc[0]![1]).toMatchObject({ p_user_id: USER, p_actor_staff_id: "staff-ops", p_approval_id: null });
    state.rpcResult = { data: null, error: { code: "ES403", message: "x" } };
    expect((await closeOfficeUserSessions(all())).error).toMatch(/onay izni/);
  });
});
