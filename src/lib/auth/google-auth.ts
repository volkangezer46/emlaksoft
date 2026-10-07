/**
 * Google ile giriş / kayıt — SAF kurallar (istemci + sunucu ortak; ağ/DB yok, vitest ile sınanır).
 *
 * Akış: düğme (`GoogleAuthButton`) → Supabase OAuth (PKCE) → `/auth/callback` (kod değişimi) →
 * `resolveOAuthLanding` kararı: mevcut ofis kullanıcısı `/app`, profili olmayan yeni kullanıcı
 * `/kayit/tamamla`, platform personeli / demo / pasif hesap reddedilir. Proxy de profilsiz Google
 * kullanıcısını `/kayit/tamamla`'ya yollar (`needsOAuthOnboarding`; döngüsüz).
 * Runbook: docs/runbooks/GOOGLE_GIRIS.md.
 */
import { DEMO_PERSONAS } from "@/lib/demo-personas";

/** Düğmeler yalnız sahip sağlayıcıyı Supabase'de açıp bayrağı verdiyse görünür (kırık düğme yok). */
export function isGoogleAuthEnabled(value: string | undefined = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED): boolean {
  return value === "true";
}

export const GOOGLE_ONBOARDING_PATH = "/kayit/tamamla";
export const GOOGLE_CALLBACK_PATH = "/auth/callback";

/**
 * Yalnız uygulama içi göreli yol kabul edilir (açık yönlendirme yok): "/" ile başlar, "//" veya "/\"
 * değildir, kontrol karakteri içermez, başka origin'e çözülmez ve callback'in kendisine dönmez.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/app"): string {
  const v = (raw ?? "").trim();
  if (!v || v.length > 512) return fallback;
  if (!/^\/(?![/\\])/.test(v)) return fallback;
  // Kontrol karakterleri (sekme/yeni satır vb.) ve ters bölü: tarayıcılar "/\evil.com"u farklı çözebilir.
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return fallback;
  }
  try {
    const base = "http://emlaksoft.invalid";
    const u = new URL(v, base);
    if (u.origin !== base) return fallback;
    if (u.pathname === GOOGLE_CALLBACK_PATH || u.pathname.startsWith(`${GOOGLE_CALLBACK_PATH}/`)) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

/** Demo hesapları (hızlı giriş kişilikleri ve demo alan adı) Google ile ofis açamaz. */
export function isDemoIdentityEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  if (e.endsWith("@demo.emlaksoft.test") || e.endsWith(".emlaksoft.test")) return true;
  return DEMO_PERSONAS.some((p) => p.email.toLowerCase() === e);
}

type IdentityLike = { provider?: string | null };
type UserLike = {
  app_metadata?: Record<string, unknown> | null;
  identities?: IdentityLike[] | null;
};

/** Kullanıcının bağlı sağlayıcıları (Supabase `app_metadata.providers` + kimlik listesi). */
export function userProviders(user: UserLike | null | undefined): string[] {
  const out = new Set<string>();
  const meta = user?.app_metadata ?? {};
  if (typeof meta.provider === "string") out.add(meta.provider);
  if (Array.isArray(meta.providers)) for (const p of meta.providers) if (typeof p === "string") out.add(p);
  for (const i of user?.identities ?? []) if (i?.provider) out.add(i.provider);
  return [...out];
}

export function hasGoogleIdentity(user: UserLike | null | undefined): boolean {
  return userProviders(user).includes("google");
}

/**
 * Google bağlantısı kaldırılabilir mi: en az bir BAŞKA giriş yöntemi (ör. e-posta/şifre) kalmalı.
 * Supabase de son kimliğin kaldırılmasını reddeder; bu kontrol kullanıcıya anlaşılır neden verir.
 */
export function canUnlinkGoogle(identities: IdentityLike[] | null | undefined): { ok: boolean; reason?: string } {
  const list = identities ?? [];
  if (!list.some((i) => i.provider === "google")) return { ok: false, reason: "Bağlı bir Google hesabı yok." };
  if (!list.some((i) => i.provider && i.provider !== "google")) {
    return {
      ok: false,
      reason:
        "Google tek giriş yönteminiz. Kaldırmadan önce giriş sayfasındaki \"Şifremi unuttum\" ile e-posta adresinize şifre belirleyin.",
    };
  }
  return { ok: true };
}

/** Giriş sayfasında `?hata=` ile gösterilen Google hata kodları. */
export type GoogleErrorCode =
  | "google"
  | "google-iptal"
  | "google-eposta"
  | "google-bagli"
  | "google-personel"
  | "google-demo"
  | "google-pasif"
  | "google-kayit-kapali"
  | "google-kapali";

export const GOOGLE_ERROR_MESSAGES: Record<GoogleErrorCode, string> = {
  google: "Google ile giriş tamamlanamadı. Lütfen tekrar deneyin ya da e-posta ve şifrenizle giriş yapın.",
  "google-iptal": "Google ile giriş iptal edildi. Dilediğiniz zaman tekrar deneyebilirsiniz.",
  "google-eposta":
    "Bu e-posta ile hesabınız var; şifrenizle giriş yapıp Hesabım sayfasından Google'ı bağlayın.",
  "google-bagli": "Bu Google hesabı başka bir EmlakSoft hesabına bağlı. O hesapla giriş yapın ya da farklı bir Google hesabı seçin.",
  "google-personel": "EmlakSoft personel hesapları Google ile giriş yapamaz; e-posta, şifre ve doğrulama ile giriş yapın.",
  "google-demo": "Demo hesapları Google ile kullanılamaz.",
  "google-pasif": "Hesabınız pasif veya ofis kimliği geçersiz. Ofis yöneticinize başvurun.",
  "google-kayit-kapali": "Yeni ofis kayıtları şu an kapalı. Mevcut hesabınız varsa e-posta ve şifrenizle giriş yapın.",
  "google-kapali": "Google ile giriş şu an kullanılamıyor.",
};

export function googleErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(GOOGLE_ERROR_MESSAGES, code)
    ? GOOGLE_ERROR_MESSAGES[code as GoogleErrorCode]
    : null;
}

/**
 * Supabase'in callback'e döndürdüğü hata parametrelerini (`error`, `error_code`, `error_description`)
 * uygulama koduna çevirir. Hata yoksa null.
 */
export function oauthErrorCode(params: {
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}): GoogleErrorCode | null {
  const error = (params.error ?? "").toLowerCase();
  const code = (params.errorCode ?? "").toLowerCase();
  const desc = (params.errorDescription ?? "").toLowerCase();
  if (!error && !code && !desc) return null;
  if (error === "access_denied" && !code) return "google-iptal";
  if (code === "identity_already_exists" || desc.includes("already linked")) return "google-bagli";
  if (
    code === "email_exists" ||
    code === "user_already_exists" ||
    desc.includes("already registered") ||
    desc.includes("already exists") ||
    desc.includes("multiple accounts")
  ) {
    return "google-eposta";
  }
  if (code === "provider_disabled" || desc.includes("provider is not enabled")) return "google-kapali";
  if (error === "access_denied") return "google-iptal";
  return "google";
}

export type OAuthFlow = "login" | "link";

export function parseOAuthFlow(raw: string | null | undefined): OAuthFlow {
  return raw === "link" ? "link" : "login";
}

export type OAuthLandingInput = {
  flow: OAuthFlow;
  /** Doğrulanmış `next` (safeNextPath'ten geçmiş). */
  next: string;
  email: string | null;
  /** JWT `app_metadata.tenant_id` (provizyon tetikleyicisi yazar). */
  claimTenantId: string | null;
  claimRole: string | null;
  /** Aktif platform personeli kaydı ya da PLATFORM_ADMIN_EMAILS ön-izni. */
  isPlatformStaff: boolean;
  profile: { tenant_id: string | null; role: string | null; is_active: boolean | null; two_factor_sms: boolean | null } | null;
  registrationOpen: boolean;
};

export type OAuthLanding =
  | { kind: "redirect"; path: string; event: "success" | "2fa_pending" | null }
  | { kind: "reject"; code: GoogleErrorCode };

/**
 * Callback sonrası nereye gidileceği (tek karar noktası). Proxy'deki 2FA / askıya alma / kimlik
 * kapıları `/app` isteğinde aynen çalışır; bu karar yalnız ilk yönü seçer.
 */
export function resolveOAuthLanding(input: OAuthLandingInput): OAuthLanding {
  const next = safeNextPath(input.next, "/app");

  if (input.flow === "link") {
    // Hesabım'dan bağlama: oturum zaten vardı; aynı sayfaya sonuçla dönülür.
    const target = next.startsWith("/app") ? next : "/app/hesabim";
    return { kind: "redirect", path: withParam(target, "google", "baglandi"), event: null };
  }

  // Platform personeli Google ile giremez (şifre + MFA zorunlu yol; destek oturumu kurtarma signIn'de).
  if (input.isPlatformStaff) return { kind: "reject", code: "google-personel" };
  if (isDemoIdentityEmail(input.email)) return { kind: "reject", code: "google-demo" };

  if (input.profile) {
    if (
      !input.profile.is_active ||
      !input.profile.tenant_id ||
      input.profile.tenant_id !== input.claimTenantId ||
      input.profile.role !== input.claimRole
    ) {
      return { kind: "reject", code: "google-pasif" };
    }
    const target = next === GOOGLE_ONBOARDING_PATH || next.startsWith("/kayit") ? "/app" : next;
    if (input.profile.two_factor_sms) {
      return {
        kind: "redirect",
        path: `/giris/dogrulama?next=${encodeURIComponent(target)}&kaynak=google`,
        event: "2fa_pending",
      };
    }
    return { kind: "redirect", path: target, event: "success" };
  }

  // Profil RLS ile görünmüyor ama ofis claim'i var (ör. askıdaki ofis): karar proxy'nin (/app/askida vb.).
  if (input.claimTenantId) return { kind: "redirect", path: "/app", event: "success" };

  // Google ile ilk kez gelen: ofis kurulumuna. Kayıt kapalıysa yeni ofis yok.
  if (!input.registrationOpen) return { kind: "reject", code: "google-kayit-kapali" };
  return { kind: "redirect", path: GOOGLE_ONBOARDING_PATH, event: null };
}

/**
 * Proxy kapısı: `/app` isteğinde profili, ofis claim'i ve personel kaydı olmayan Google kullanıcısı
 * oturumu kapatılmadan kurulum tamamlamaya yönlendirilir (yarım kalan kurulum bir sonraki girişte devam).
 */
export function needsOAuthOnboarding(input: {
  hasProfile: boolean;
  profileError: boolean;
  isPlatformStaff: boolean;
  claimTenantId: string | null;
  impersonating: boolean;
  providers: string[];
}): boolean {
  return (
    !input.hasProfile &&
    !input.profileError &&
    !input.isPlatformStaff &&
    !input.claimTenantId &&
    !input.impersonating &&
    input.providers.includes("google")
  );
}

function withParam(path: string, key: string, value: string): string {
  const u = new URL(path, "http://emlaksoft.invalid");
  u.searchParams.set(key, value);
  return `${u.pathname}${u.search}${u.hash}`;
}
