import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Güvenlik eylemleri: kendini kilitleme koruması (MFA), demo süre/tavan kuralları, doğrulayıcı sıfırlama.
 * Kapı, ayar yazımı, denetim ve Supabase Auth yönetim API'si taklit edilir.
 */
const h = vi.hoisted(() => ({
  staff: { id: "11111111-1111-4111-8111-111111111111", email: "sa@emlaksoft.test", role: "super_admin" },
  factors: [] as { id: string; factor_type: string; status: string; created_at: string }[],
  ceiling: { tenant: true, platform: true },
  setSetting: vi.fn(async () => true),
  log: vi.fn(async () => {}),
  deleteFactor: vi.fn(async () => ({ error: null })),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, updateTag: () => {} }));
vi.mock("@/lib/platform-guards", () => ({ guardPlatformAction: async () => ({ staff: h.staff }) }));
vi.mock("@/lib/platform", () => ({ requirePlatformModule: async () => h.staff }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: h.log }));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async () => null,
  setPlatformSetting: h.setSetting,
}));
vi.mock("@/lib/settings/read", () => ({ SETTINGS_PLATFORM_TAG: "settings:platform" }));
vi.mock("@/lib/settings/write", () => ({ applyPlatformWrites: async () => ({ ok: true }), writeSetting: async () => ({ ok: true }) }));
vi.mock("@/lib/demo-environment", () => ({
  isDemoLoginEnabled: () => h.ceiling.tenant,
  isPlatformDemoPersonaAllowed: () => h.ceiling.platform,
}));
vi.mock("@/lib/supabase/admin", () => ({
  resolveSupabaseAdminKey: () => "k",
  createAdminClient: () => ({
    auth: {
      admin: {
        mfa: {
          listFactors: async () => ({ data: { factors: h.factors }, error: null }),
          deleteFactor: h.deleteFactor,
        },
      },
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: { email: "hedef@emlaksoft.test" }, error: null }),
      };
      return chain;
    },
  }),
}));

import { resetStaffMfa, setDemoLoginMode, setMfaEnforcement } from "./platform-security";

const REASON = "planlı güvenlik sıkılaştırması";
const verified = { id: "f1", factor_type: "totp", status: "verified", created_at: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  h.factors = [];
  h.ceiling = { tenant: true, platform: true };
});

describe("setMfaEnforcement", () => {
  it("kendi doğrulanmış TOTP'si olmayan süper admin MFA'yı AÇAMAZ (kendini kilitleme koruması)", async () => {
    h.factors = [{ ...verified, status: "unverified" }];
    const res = await setMfaEnforcement({ on: true, graceDays: 7, reason: REASON });
    expect(res.error).toContain("Önce Hesabım > Güvenlik");
    expect(h.setSetting).not.toHaveBeenCalled();
  });

  it("TOTP kuruluyken açılır: mfa_enforced='on' + 7 günlük geçiş yazılır ve denetime önce/sonra düşer", async () => {
    h.factors = [verified];
    const res = await setMfaEnforcement({ on: true, graceDays: 7, reason: REASON });
    expect(res).toEqual({ ok: true });
    const calls = h.setSetting.mock.calls as unknown as [string, string | null][];
    expect(calls.map((c) => c[0])).toEqual(["platform.mfa_enforced", "platform.mfa_grace_until"]);
    expect(calls[0][1]).toBe("on");
    expect(typeof calls[1][1]).toBe("string");
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ action: "security.mfa_enforcement", meta: expect.objectContaining({ before: null, after: "on" }) }));
  });

  it("kapatmak doğrulayıcı istemez; kısa gerekçe reddedilir", async () => {
    expect((await setMfaEnforcement({ on: false, graceDays: 0, reason: "kısa" })).error).toContain("Gerekçe");
    expect(await setMfaEnforcement({ on: false, graceDays: 0, reason: REASON })).toEqual({ ok: true });
  });
});

describe("setDemoLoginMode", () => {
  it("24 saatten uzun platform demosu reddedilir; süre zorunludur", async () => {
    expect((await setDemoLoginMode({ mode: "tenant_platform", hours: 25, reason: REASON })).error).toContain("24 saat");
    expect((await setDemoLoginMode({ mode: "tenant_platform", reason: REASON })).error).toContain("süre");
    expect(h.setSetting).not.toHaveBeenCalled();
  });

  it("env tavanı kapalı mod seçilemez ('Sunucu bunu kapatmış')", async () => {
    h.ceiling = { tenant: true, platform: false };
    const res = await setDemoLoginMode({ mode: "tenant_platform", hours: 2, reason: REASON });
    expect(res.error).toContain("Sunucu bunu kapatmış");
    expect(res.error).toContain("PRODUCTION_PLATFORM_DEMO_OPT_IN");
  });

  it("geçerli süreli platform demosu yazılır; 'default' satırı temizler", async () => {
    expect(await setDemoLoginMode({ mode: "tenant_platform", hours: 4, reason: REASON })).toEqual({ ok: true });
    const written = JSON.parse((h.setSetting.mock.calls[0] as unknown as [string, string])[1]);
    expect(written).toMatchObject({ mode: "tenant_platform", reason: REASON, by: "sa@emlaksoft.test" });
    expect(typeof written.until).toBe("string");
    h.setSetting.mockClear();
    expect(await setDemoLoginMode({ mode: "default", reason: REASON })).toEqual({ ok: true });
    // önceki değer null (mock) = yeni değer null → yazım yok (gürültü satırı yazılmaz)
    expect(h.setSetting).not.toHaveBeenCalled();
  });
});

describe("resetStaffMfa", () => {
  it("kişi kendi doğrulayıcısını sıfırlayamaz", async () => {
    const res = await resetStaffMfa({ staffId: h.staff.id, reason: REASON });
    expect(res.error).toContain("Kendi doğrulayıcınızı");
    expect(h.deleteFactor).not.toHaveBeenCalled();
  });

  it("başkasının doğrulayıcıları silinir ve 'personel.mfa_reset' denetime düşer", async () => {
    h.factors = [verified];
    const target = "22222222-2222-4222-8222-222222222222";
    expect(await resetStaffMfa({ staffId: target, reason: REASON })).toEqual({ ok: true });
    expect(h.deleteFactor).toHaveBeenCalledWith({ id: "f1", userId: target });
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ action: "personel.mfa_reset", entityId: target }));
  });
});
