import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { ok: true, userId: "u1", tenantId: "t1", role: "owner", impersonating: false } as
    | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
    | { ok: false; error: string },
  allowed: true,
  user: { id: "u1", email: "a@example.com", app_metadata: {}, user_metadata: {} } as Record<string, unknown> | null,
  otp: vi.fn(),
  rate: vi.fn(),
}));

vi.mock("@/lib/tenant-guard", () => ({ requireActiveTenant: async () => h.gate }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (...a: unknown[]) => {
    h.rate(...a);
    return { allowed: h.allowed };
  },
}));
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://emlaksoft.vercel.app" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }), signInWithOtp: h.otp },
  }),
}));

import { resendVerificationEmail } from "./email-verification";

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { ok: true, userId: "u1", tenantId: "t1", role: "owner", impersonating: false };
  h.allowed = true;
  h.user = { id: "u1", email: "a@example.com", app_metadata: {}, user_metadata: {} };
  h.otp.mockResolvedValue({ error: null });
});

describe("resendVerificationEmail", () => {
  it("kiracı kapısı reddederse e-posta gitmez", async () => {
    h.gate = { ok: false, error: "Ofis pasif." };
    expect(await resendVerificationEmail()).toEqual({ error: "Ofis pasif." });
    expect(h.otp).not.toHaveBeenCalled();
  });

  it("destek (impersonation) oturumunda gönderilmez", async () => {
    h.gate = { ok: true, userId: "u1", tenantId: "t1", role: "owner", impersonating: true };
    expect((await resendVerificationEmail()).error).toMatch(/Destek oturumunda/);
    expect(h.otp).not.toHaveBeenCalled();
  });

  it("hız sınırı aşılınca gönderilmez; sınır kullanıcı başına ve fail-closed", async () => {
    h.allowed = false;
    expect((await resendVerificationEmail()).error).toMatch(/Çok fazla deneme/);
    expect(h.rate).toHaveBeenCalledWith("verify-email:u1", expect.objectContaining({ limit: 3, failurePolicy: "deny" }));
    expect(h.otp).not.toHaveBeenCalled();
  });

  it("oturum kullanıcısı kapıdaki kullanıcıyla uyuşmuyorsa gönderilmez", async () => {
    h.user = { id: "baska", email: "b@example.com", app_metadata: {}, user_metadata: {} };
    expect((await resendVerificationEmail()).error).toMatch(/Oturum doğrulanamadı/);
    h.user = null;
    expect((await resendVerificationEmail()).error).toMatch(/Oturum doğrulanamadı/);
    expect(h.otp).not.toHaveBeenCalled();
  });

  it("Google ile doğrulanmış hesaba tekrar gönderilmez", async () => {
    h.user = { id: "u1", email: "a@example.com", app_metadata: { provider: "google" }, user_metadata: {} };
    expect(await resendVerificationEmail()).toEqual({ ok: true, message: "E-postanız zaten doğrulanmış." });
    expect(h.otp).not.toHaveBeenCalled();
  });

  it("başarıda yeni hesap AÇMAZ ve geri dönüş adresi sabittir", async () => {
    const r = await resendVerificationEmail();
    expect(r.ok).toBe(true);
    expect(h.otp).toHaveBeenCalledWith({
      email: "a@example.com",
      options: { shouldCreateUser: false, emailRedirectTo: "https://emlaksoft.vercel.app/auth/eposta-dogrula" },
    });
  });

  it("sağlayıcı hatası Türkçe genel mesaja çevrilir, ham metin sızmaz", async () => {
    h.otp.mockResolvedValue({ error: { message: "SMTP relay refused connection" } });
    const r = await resendVerificationEmail();
    expect(r.error).toBe("Doğrulama e-postası gönderilemedi. Biraz sonra tekrar deneyin.");
    expect(r.error).not.toMatch(/SMTP/);
  });
});
