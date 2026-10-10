import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * signUp (actions/auth.ts) kritik akış testi — mock Supabase.
 * Odak: auth kullanıcısı atomik `provision_registration` RPC'sinin DIŞINDA oluşur; RPC başarısız (hata ya da tenantId yok)
 * olursa tek telafi hedefi bu bekleyen auth kullanıcısıdır ve SİLİNMELİDİR (sahipsiz hesap + tekrar kayıt "zaten kayıtlı" kilidi).
 */
const h = vi.hoisted(() => ({
  open: true,
  rateAllowed: true,
  rateKeys: [] as string[],
  rateDenyPrefix: "",
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  rpc: vi.fn(),
  signInWithPassword: vi.fn(),
  attribution: vi.fn(),
  loginEvent: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  wantsDemo: false,
  demoSeed: vi.fn(),
  applyProfile: vi.fn(),
  getUser: vi.fn(),
  refreshSession: vi.fn(),
  profileRow: null as null | { id: string },
  staffRow: null as null | { id: string },
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "vitest-agent" }),
  cookies: async () => ({ set: h.cookieSet, delete: h.cookieDelete }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/platform-mfa", () => ({ isPlatformMfaRequired: () => false }));
vi.mock("@/app/giris/_lib/login-events", () => ({ logLoginEvent: h.loginEvent }));
vi.mock("@/app/imza/_lib/sms", () => ({ sendSignerSms: vi.fn() }));
vi.mock("@/lib/impersonation", () => ({ restoreImpersonationMetadata: vi.fn() }));
vi.mock("@/lib/platform", () => ({
  bootstrapPlatformStaffIfAllowed: vi.fn(),
  isPlatformAllowlistedEmail: (e: string) => e === "patron@emlaksoft.com",
}));
vi.mock("@/lib/messaging/netgsm", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/platform-flags", () => ({ isRegistrationOpen: async () => h.open }));
vi.mock("@/lib/growth/capture", () => ({ recordSignupAttributionFromRequest: h.attribution }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (key: string) => {
    h.rateKeys.push(key);
    return { allowed: h.rateAllowed && !(h.rateDenyPrefix && key.startsWith(h.rateDenyPrefix)) };
  },
  clientIp: async () => "203.0.113.7",
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: h.createUser, deleteUser: h.deleteUser } },
    rpc: h.rpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "profiles" ? h.profileRow : h.staffRow, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: h.signInWithPassword, getUser: h.getUser, refreshSession: h.refreshSession },
  }),
}));
vi.mock("@/lib/sample-registration-seed", () => ({
  DEMO_SEED_FAILED_COOKIE: "demo_seed_failed",
  wantsDemoData: () => h.wantsDemo,
  seedDemoDataForNewTenant: h.demoSeed,
}));
// Sihirbaz profili (konum/marka/odak/davet): provizyondan SONRA, best-effort; burada yalnız çağrı sırası doğrulanır.
vi.mock("@/lib/sample-data/apply-office-profile", () => ({ applyWizardOfficeProfile: h.applyProfile }));
vi.mock("@/lib/two-factor", () => ({
  generateLoginCode: () => "000000",
  LOGIN_CODE_TTL_MS: 300_000,
  TWO_FACTOR_COOKIE: "two_factor",
}));
vi.mock("@/lib/otp-hmac", () => ({ hashOtpForStorage: () => "hash" }));

import { signUp } from "./auth";

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    name: "Ayşe Yılmaz",
    phone: "05321234567",
    email: "ayse@example.com",
    password: "gizli-sifre-123",
    company: "Yılmaz Gayrimenkul",
    agents: "2-10",
    legal_consent: "accepted",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

function googleUser(over: Record<string, unknown> = {}) {
  return {
    id: "google-user-1",
    email: "Ayse.Yilmaz@gmail.com",
    app_metadata: { provider: "google", providers: ["google"] },
    identities: [{ provider: "google" }],
    ...over,
  };
}

/** /kayit/tamamla formu: hesap adımı Google oturumundan; e-posta/şifre alanı YOK. */
function googleForm(over: Record<string, string> = {}) {
  const f = form({ auth_mode: "google", ...over });
  f.delete("email");
  f.delete("password");
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.open = true;
  h.rateAllowed = true;
  h.rateKeys = [];
  h.rateDenyPrefix = "";
  h.wantsDemo = false;
  h.createUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  h.deleteUser.mockResolvedValue({ error: null });
  h.rpc.mockResolvedValue({ data: { tenantId: "tenant-1" }, error: null });
  h.signInWithPassword.mockResolvedValue({ error: null });
  h.attribution.mockResolvedValue(undefined);
  h.demoSeed.mockResolvedValue({ ok: true });
  h.applyProfile.mockResolvedValue({ warnings: [], invited: 0 });
  h.profileRow = null;
  h.staffRow = null;
  h.getUser.mockResolvedValue({ data: { user: googleUser() } });
  h.refreshSession.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = "true";
});

describe("signUp — ön kapılar (hiçbir kaynak oluşmaz)", () => {
  it("kayıt kapalıysa auth kullanıcısı oluşturulmaz", async () => {
    h.open = false;
    const r = await signUp({}, form());
    expect(r.error).toBeTruthy();
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("eksik alan, kısa şifre, yasal onay yok, hız sınırı, geçersiz e-posta/telefon", async () => {
    expect(await signUp({}, form({ name: "" }))).toMatchObject({ field: "name" });
    expect(await signUp({}, form({ phone: "" }))).toMatchObject({ field: "phone" });
    expect((await signUp({}, form({ password: "kisa" }))).error).toMatch(/8 karakter/);
    expect((await signUp({}, form({ email: "gecersiz" }))).error).toBeTruthy();
    expect((await signUp({}, form({ phone: "123" }))).error).toBeTruthy();
    h.rateAllowed = false;
    expect((await signUp({}, form())).error).toMatch(/Çok fazla/);
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("signUp — e-posta ve global hız sınırı", () => {
  it("IP + normalize e-posta + global anahtarlarıyla sınırlar; hiçbiri reddederse hesap oluşmaz", async () => {
    await signUp({}, form({ email: "  Ayse@Example.COM " })).catch(() => {}); // başarıda /app'e yönlenir
    expect(h.rateKeys).toEqual(["signup:203.0.113.7", "signup:email:ayse@example.com", "signup:global"]);
    for (const prefix of ["signup:email:", "signup:global"]) {
      h.createUser.mockClear();
      h.rateDenyPrefix = prefix;
      const res = await signUp({}, form());
      expect(res.error).toMatch(/Çok fazla|yoğun/);
      expect(h.createUser).not.toHaveBeenCalled();
    }
  });
});

describe("signUp — auth kullanıcısı oluşturma hatası", () => {
  it("'already' hatası: 'Bu e-posta zaten kayıtlı.'; RPC ve telafi çağrılmaz", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { message: "User already registered" } });
    const r = await signUp({}, form());
    expect(r.error).toBe("Bu e-posta zaten kayıtlı.");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("diğer hatalar: genel mesaj (iç hata sızmaz)", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { message: "db exploded: secret detail" } });
    const r = await signUp({}, form());
    expect(r.error).toMatch(/^Hesap oluşturulamadı: /);
    expect(r.error).not.toContain("secret detail");
  });
});

describe("signUp — provision_registration başarısızsa TELAFİ (auth kullanıcısı silinir)", () => {
  it("RPC hata döndürürse deleteUser(created.id) çağrılır, atıf/oturum açma ÇALIŞMAZ", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "slug collision" } });
    const r = await signUp({}, form());
    expect(h.deleteUser).toHaveBeenCalledTimes(1);
    expect(h.deleteUser).toHaveBeenCalledWith("user-1");
    expect(r.error).toMatch(/güvenli şekilde oluşturulamadı/);
    expect(h.attribution).not.toHaveBeenCalled();
    expect(h.applyProfile).not.toHaveBeenCalled();
    expect(h.demoSeed).not.toHaveBeenCalled();
    expect(h.signInWithPassword).not.toHaveBeenCalled();
    expect(h.loginEvent).not.toHaveBeenCalled();
  });

  it("RPC hatasız ama tenantId yok/geçersiz tipte: yine silinir (kısmi başarı kabul edilmez)", async () => {
    for (const data of [null, {}, { tenantId: 42 }, ["x"]]) {
      h.deleteUser.mockClear();
      h.rpc.mockResolvedValue({ data, error: null });
      const r = await signUp({}, form());
      expect(r.error, JSON.stringify(data)).toMatch(/güvenli şekilde oluşturulamadı/);
      expect(h.deleteUser, JSON.stringify(data)).toHaveBeenCalledWith("user-1");
    }
  });

  it("silme (telafi) de başarısız olsa bile fırlatmaz; kullanıcıya aynı güvenli mesaj döner", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    h.deleteUser.mockResolvedValue({ error: { message: "auth down" } });
    const r = await signUp({}, form());
    expect(r.error).toMatch(/güvenli şekilde oluşturulamadı/);
    expect(h.deleteUser).toHaveBeenCalledTimes(1);
  });
});

describe("signUp — başarılı akış", () => {
  it("RPC doğru parametrelerle çağrılır, atıf kaydedilir, oturum açılır, /app'e yönlenir; telafi YOK", async () => {
    await expect(signUp({}, form())).rejects.toMatchObject({ to: "/app" });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = h.rpc.mock.calls[0]!;
    expect(fn).toBe("provision_registration");
    expect(args).toMatchObject({
      p_user_id: "user-1",
      p_company: "Yılmaz Gayrimenkul",
      p_full_name: "Ayşe Yılmaz",
      p_phone: "05321234567",
      p_ip_address: "203.0.113.7",
    });
    expect(h.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ayse@example.com", email_confirm: true, app_metadata: { role: "owner", account_active: true } }),
    );
    expect(h.attribution).toHaveBeenCalledWith("tenant-1", expect.any(FormData));
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.signInWithPassword).toHaveBeenCalledWith({ email: "ayse@example.com", password: "gizli-sifre-123" });
    expect(h.loginEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", tenantId: "tenant-1", result: "success" }));
  });

  it("yeni 4 alanlı kayıt: ofis adı ve onay kutusu gelmese de '<Ad Soyad> Emlak' ile kurulur", async () => {
    const f = form();
    f.delete("company");
    f.delete("legal_consent");
    await expect(signUp({}, f)).rejects.toMatchObject({ to: "/app" });
    const [, args] = h.rpc.mock.calls[0]!;
    expect(args).toMatchObject({ p_company: "Ayşe Yılmaz Emlak", p_terms_version: "kullanim-sartlari-2026-07-31" });
  });

  it("kayıt başarılı, oturum açma başarısız: hesap SİLİNMEZ, kullanıcıya giriş sayfası yönlendirmesi döner", async () => {
    h.signInWithPassword.mockResolvedValue({ error: { message: "x" } });
    const r = await signUp({}, form());
    expect(r.error).toMatch(/Giriş sayfasından/);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("demo veri yüklenemezse kayıt YİNE başarılı; yeniden-dene çerezi yazılır", async () => {
    h.wantsDemo = true;
    h.demoSeed.mockResolvedValue({ ok: false });
    await expect(signUp({}, form())).rejects.toMatchObject({ to: "/app" });
    expect(h.cookieSet).toHaveBeenCalledWith("demo_seed_failed", "1", expect.objectContaining({ httpOnly: true }));
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("sihirbaz profili provizyondan sonra uygulanır; odak seçimi demo paketini belirler; profil hatası kaydı kesmez", async () => {
    h.wantsDemo = true;
    h.applyProfile.mockRejectedValue(new Error("storage down"));
    const f = form({ office_type: "franchise", brand_color: "#0F7B6C" });
    f.append("focus", "ticari");
    await expect(signUp({}, f)).rejects.toMatchObject({ to: "/app" });
    expect(h.applyProfile).toHaveBeenCalledTimes(1);
    const [, , payload] = h.applyProfile.mock.calls[0]!;
    expect(payload).toMatchObject({
      tenantId: "tenant-1",
      ownerId: "user-1",
      profile: expect.objectContaining({ officeType: "franchise", brandColor: "#0f7b6c", focus: ["ticari"], pack: "ticari" }),
    });
    // Demo seti odaktan türeyen paketle ve profil uygulamasından SONRA yüklenir.
    expect(h.demoSeed).toHaveBeenCalledWith(expect.anything(), "tenant-1", "user-1", "ticari");
    expect(h.applyProfile.mock.invocationCallOrder[0]!).toBeLessThan(h.demoSeed.mock.invocationCallOrder[0]!);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });
});

describe("signUp — Google ile tamamlama (auth_mode=google)", () => {
  it("auth kullanıcısı OLUŞTURULMAZ; aynı çekirdek oturumdaki kullanıcıyla çalışır, claim'ler yenilenir, /app", async () => {
    await expect(signUp({}, googleForm())).rejects.toMatchObject({ to: "/app" });
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.signInWithPassword).not.toHaveBeenCalled();
    const [fn, args] = h.rpc.mock.calls[0]!;
    expect(fn).toBe("provision_registration");
    expect(args).toMatchObject({ p_user_id: "google-user-1", p_full_name: "Ayşe Yılmaz", p_phone: "05321234567" });
    // Rıza: e-posta yoluyla aynı sürümler.
    expect(args).toMatchObject({ p_terms_version: "kullanim-sartlari-2026-07-31", p_kvkk_version: "kvkk-aydinlatma-2026-07-31" });
    expect(h.attribution).toHaveBeenCalledWith("tenant-1", expect.any(FormData));
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
    expect(h.loginEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "google-user-1", tenantId: "tenant-1", result: "success" }));
  });

  it("telefon zorunlu ve TR cep olmalı", async () => {
    expect(await signUp({}, googleForm({ phone: "" }))).toMatchObject({ field: "phone" });
    expect(await signUp({}, googleForm({ phone: "+4915123456789" }))).toMatchObject({ field: "phone" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("kayıt kapalı, bayrak kapalı, oturum yok veya Google kimliği yoksa hiçbir şey oluşmaz", async () => {
    h.open = false;
    expect((await signUp({}, googleForm())).error).toBeTruthy();
    h.open = true;
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = "false";
    expect((await signUp({}, googleForm())).error).toMatch(/kullanılamıyor/);
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = "true";
    h.getUser.mockResolvedValue({ data: { user: null } });
    expect((await signUp({}, googleForm())).error).toMatch(/Google oturumunuz/);
    h.getUser.mockResolvedValue({ data: { user: googleUser({ app_metadata: { provider: "email" }, identities: [{ provider: "email" }] }) } });
    expect((await signUp({}, googleForm())).error).toMatch(/Google oturumunuz/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("demo hesabı ve platform personeli Google ile ofis açamaz", async () => {
    h.getUser.mockResolvedValue({ data: { user: googleUser({ email: "sahip@demo.emlaksoft.test" }) } });
    expect((await signUp({}, googleForm())).error).toMatch(/yeni ofis açılamaz/);
    h.getUser.mockResolvedValue({ data: { user: googleUser({ email: "patron@emlaksoft.com" }) } });
    expect((await signUp({}, googleForm())).error).toMatch(/yeni ofis açılamaz/);
    h.getUser.mockResolvedValue({ data: { user: googleUser() } });
    h.staffRow = { id: "google-user-1" };
    expect((await signUp({}, googleForm())).error).toMatch(/yeni ofis açılamaz/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("zaten provizyonlu kullanıcı (profil var ya da claim var) yeniden ofis açmaz → /app", async () => {
    h.profileRow = { id: "google-user-1" };
    await expect(signUp({}, googleForm())).rejects.toMatchObject({ to: "/app" });
    h.profileRow = null;
    h.getUser.mockResolvedValue({ data: { user: googleUser({ app_metadata: { provider: "google", tenant_id: "t-9" } }) } });
    await expect(signUp({}, googleForm())).rejects.toMatchObject({ to: "/app" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("provizyon başarısızsa Google kullanıcısı SİLİNMEZ (yeniden dener)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await signUp({}, googleForm());
    expect(r.error).toMatch(/güvenli şekilde oluşturulamadı/);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.refreshSession).not.toHaveBeenCalled();
  });

  it("claim yenileme başarısızsa anlaşılır mesaj döner", async () => {
    h.refreshSession.mockResolvedValue({ error: { message: "x" } });
    const r = await signUp({}, googleForm());
    expect(r.error).toMatch(/yeniden giriş/);
  });
});
