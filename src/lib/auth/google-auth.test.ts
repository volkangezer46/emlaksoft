import { describe, expect, it } from "vitest";
import {
  canUnlinkGoogle,
  googleErrorMessage,
  hasGoogleIdentity,
  isDemoIdentityEmail,
  isGoogleAuthEnabled,
  needsOAuthOnboarding,
  oauthErrorCode,
  parseOAuthFlow,
  resolveOAuthLanding,
  safeNextPath,
  type OAuthLandingInput,
} from "./google-auth";

const base: OAuthLandingInput = {
  flow: "login",
  next: "/app",
  email: "ayse@ornek.com",
  claimTenantId: null,
  claimRole: null,
  isPlatformStaff: false,
  profile: null,
  registrationOpen: true,
};
const activeProfile = { tenant_id: "t1", role: "owner", is_active: true, two_factor_sms: false };

describe("isGoogleAuthEnabled", () => {
  it("yalnız tam 'true' değerinde açık", () => {
    expect(isGoogleAuthEnabled("true")).toBe(true);
    for (const v of [undefined, "", "1", "TRUE", "yes", "false"]) expect(isGoogleAuthEnabled(v)).toBe(false);
  });
});

describe("safeNextPath (açık yönlendirme yok)", () => {
  it("uygulama içi göreli yolları korur", () => {
    expect(safeNextPath("/app/musteriler?durum=yeni")).toBe("/app/musteriler?durum=yeni");
    expect(safeNextPath("/app/hesabim#google")).toBe("/app/hesabim#google");
  });
  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "app",
    "/app\n/evil",
    "/a\\b",
    "/auth/callback?next=//evil.com",
    "",
    null,
    undefined,
  ])("%s → varsayılan", (raw) => {
    expect(safeNextPath(raw as string | null | undefined)).toBe("/app");
  });
  it("aşırı uzun yol reddedilir", () => {
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBe("/app");
  });
});

describe("oauthErrorCode", () => {
  it("hata yoksa null", () => {
    expect(oauthErrorCode({})).toBeNull();
  });
  it("iptal, bağlı kimlik, var olan e-posta, kapalı sağlayıcı", () => {
    expect(oauthErrorCode({ error: "access_denied" })).toBe("google-iptal");
    expect(oauthErrorCode({ error: "server_error", errorCode: "identity_already_exists" })).toBe("google-bagli");
    expect(oauthErrorCode({ error: "server_error", errorCode: "email_exists" })).toBe("google-eposta");
    expect(oauthErrorCode({ error: "invalid_request", errorDescription: "Unsupported provider: provider is not enabled" })).toBe(
      "google-kapali",
    );
    expect(oauthErrorCode({ error: "server_error", errorDescription: "boom" })).toBe("google");
  });
  it("her kodun Türkçe mesajı var; bilinmeyen kod mesajsız", () => {
    for (const c of ["google", "google-iptal", "google-eposta", "google-bagli", "google-personel", "google-demo", "google-pasif", "google-kayit-kapali", "google-kapali"]) {
      expect(googleErrorMessage(c)).toBeTruthy();
    }
    expect(googleErrorMessage("x")).toBeNull();
    expect(googleErrorMessage("google-eposta")).toContain("şifrenizle giriş yapıp");
  });
});

describe("resolveOAuthLanding", () => {
  it("mevcut ofis kullanıcısı → next (varsayılan /app)", () => {
    const r = resolveOAuthLanding({ ...base, claimTenantId: "t1", claimRole: "owner", profile: activeProfile });
    expect(r).toEqual({ kind: "redirect", path: "/app", event: "success" });
    const r2 = resolveOAuthLanding({ ...base, next: "/app/portfoy", claimTenantId: "t1", claimRole: "owner", profile: activeProfile });
    expect(r2).toMatchObject({ path: "/app/portfoy" });
  });
  it("2FA açık kullanıcı doğrulama sayfasına (kod otomatik gönderilir)", () => {
    const r = resolveOAuthLanding({
      ...base,
      claimTenantId: "t1",
      claimRole: "owner",
      profile: { ...activeProfile, two_factor_sms: true },
    });
    expect(r).toEqual({ kind: "redirect", path: "/giris/dogrulama?next=%2Fapp&kaynak=google", event: "2fa_pending" });
  });
  it("pasif profil veya claim uyuşmazlığı reddedilir", () => {
    expect(resolveOAuthLanding({ ...base, claimTenantId: "t1", claimRole: "owner", profile: { ...activeProfile, is_active: false } })).toEqual({
      kind: "reject",
      code: "google-pasif",
    });
    expect(resolveOAuthLanding({ ...base, claimTenantId: "t2", claimRole: "owner", profile: activeProfile })).toEqual({
      kind: "reject",
      code: "google-pasif",
    });
  });
  it("profili olmayan yeni kullanıcı → /kayit/tamamla", () => {
    expect(resolveOAuthLanding(base)).toEqual({ kind: "redirect", path: "/kayit/tamamla", event: null });
  });
  it("kayıt kapalıysa yeni kullanıcı reddedilir, mevcut kullanıcı girer", () => {
    expect(resolveOAuthLanding({ ...base, registrationOpen: false })).toEqual({ kind: "reject", code: "google-kayit-kapali" });
    expect(
      resolveOAuthLanding({ ...base, registrationOpen: false, claimTenantId: "t1", claimRole: "owner", profile: activeProfile }),
    ).toMatchObject({ kind: "redirect", path: "/app" });
  });
  it("platform personeli ve demo hesapları reddedilir", () => {
    expect(resolveOAuthLanding({ ...base, isPlatformStaff: true })).toEqual({ kind: "reject", code: "google-personel" });
    expect(resolveOAuthLanding({ ...base, email: "sahip@demo.emlaksoft.test" })).toEqual({ kind: "reject", code: "google-demo" });
  });
  it("claim var ama profil görünmüyor → /app (askı kapısı proxy'de)", () => {
    expect(resolveOAuthLanding({ ...base, claimTenantId: "t1", claimRole: "owner" })).toMatchObject({ path: "/app" });
  });
  it("kurulum yolu next olarak gelirse mevcut kullanıcı /app'e gider", () => {
    expect(
      resolveOAuthLanding({ ...base, next: "/kayit/tamamla", claimTenantId: "t1", claimRole: "owner", profile: activeProfile }),
    ).toMatchObject({ path: "/app" });
  });
  it("bağlama akışı Hesabım'a sonuçla döner; dış yol kabul edilmez", () => {
    expect(resolveOAuthLanding({ ...base, flow: "link", next: "/app/hesabim" })).toEqual({
      kind: "redirect",
      path: "/app/hesabim?google=baglandi",
      event: null,
    });
    expect(resolveOAuthLanding({ ...base, flow: "link", next: "//evil.com" })).toMatchObject({ path: "/app?google=baglandi" });
    expect(resolveOAuthLanding({ ...base, flow: "link", next: "/fiyatlar" })).toMatchObject({ path: "/app/hesabim?google=baglandi" });
  });
  it("parseOAuthFlow yalnız 'link' tanır", () => {
    expect(parseOAuthFlow("link")).toBe("link");
    expect(parseOAuthFlow("x")).toBe("login");
    expect(parseOAuthFlow(null)).toBe("login");
  });
});

describe("needsOAuthOnboarding (proxy, döngüsüz)", () => {
  const pending = { hasProfile: false, profileError: false, isPlatformStaff: false, claimTenantId: null, impersonating: false, providers: ["google"] };
  it("profilsiz Google kullanıcısı kuruluma", () => {
    expect(needsOAuthOnboarding(pending)).toBe(true);
  });
  it.each([
    { hasProfile: true },
    { profileError: true },
    { isPlatformStaff: true },
    { claimTenantId: "t1" },
    { impersonating: true },
    { providers: ["email"] },
  ])("%o → hayır", (patch) => {
    expect(needsOAuthOnboarding({ ...pending, ...patch })).toBe(false);
  });
});

describe("kimlik yardımcıları", () => {
  it("hasGoogleIdentity app_metadata ve kimlik listesinden okur", () => {
    expect(hasGoogleIdentity({ app_metadata: { provider: "email", providers: ["email", "google"] } })).toBe(true);
    expect(hasGoogleIdentity({ identities: [{ provider: "google" }] })).toBe(true);
    expect(hasGoogleIdentity({ app_metadata: { provider: "email" } })).toBe(false);
    expect(hasGoogleIdentity(null)).toBe(false);
  });
  it("canUnlinkGoogle: en az bir başka giriş yöntemi kalmalı", () => {
    expect(canUnlinkGoogle([{ provider: "email" }, { provider: "google" }]).ok).toBe(true);
    expect(canUnlinkGoogle([{ provider: "google" }]).ok).toBe(false);
    expect(canUnlinkGoogle([{ provider: "email" }]).ok).toBe(false);
    expect(canUnlinkGoogle(null).ok).toBe(false);
  });
  it("isDemoIdentityEmail", () => {
    expect(isDemoIdentityEmail("admin@demo.emlaksoft.test")).toBe(true);
    expect(isDemoIdentityEmail("SAHIP@DEMO.EMLAKSOFT.TEST")).toBe(true);
    expect(isDemoIdentityEmail("ayse@gmail.com")).toBe(false);
    expect(isDemoIdentityEmail("")).toBe(false);
  });
});
