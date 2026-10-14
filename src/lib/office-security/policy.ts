import { ipMatches, parseAllowlist, parseMinutes, type AllowRule } from "@/lib/platform-security/admin-access";

/**
 * DG7 Ofis güvenlik politikası (SAF çekirdek; proxy, sunucu eylemleri ve ayar kayıt defteri ortak kullanır).
 * Ofis sahibi kendi ofisi için belirler (Ayarlar > Güvenlik); depo `tenant_settings` (`office.security.*`).
 *  - İki adımlı doğrulama zorunluluğu (rol bazında): listede olan rolde SMS 2FA'sı kapalı kullanıcı proxy'de
 *    `/giris/iki-adim-kurulum`'a yönlenir (kurmadan /app'e geçemez).
 *  - İzinli IP aralıkları (isteğe bağlı): doluysa listede olmayan IP'den /app oturumu kapatılır.
 *    ACİL KURTARMA: (1) kayıt anında şu anki IP listede değilse açık onay istenir; (2) "sahip muaf" anahtarı
 *    varsayılan AÇIK; (3) platform süper admini Ofis 360 > Yönetim'den politikayı sıfırlar (doğrulayıcı kodu);
 *    (4) sunucu düzeyinde `OFFICE_IP_ALLOWLIST=off` tüm ofislerde IP kısıtını kapatır.
 *  - Boşta kalma (dk) ve en uzun oturum (saat): 0 = kapalı (varsayılan; bugünkü davranış).
 *  - Yeni cihazdan girişte bildirim (kullanıcıya ve ofis sahibine).
 * Politika kapalıyken (hiç kayıt yok) proxy ek iş yapmaz: önbellekte "politika yok" görülür ve dallar atlanır.
 */

export const OFFICE_SECURITY_PREFIX = "office.security.";
export const OFFICE_MFA_ROLES_KEY = "office.security.mfa_roles";
export const OFFICE_IP_ALLOWLIST_KEY = "office.security.ip_allowlist";
export const OFFICE_IP_OWNER_EXEMPT_KEY = "office.security.ip_owner_exempt";
export const OFFICE_IDLE_MINUTES_KEY = "office.security.idle_minutes";
export const OFFICE_MAX_HOURS_KEY = "office.security.session_max_hours";
export const OFFICE_NEW_DEVICE_ALERT_KEY = "office.security.new_device_alert";

export const OFFICE_SECURITY_KEYS = [
  OFFICE_MFA_ROLES_KEY,
  OFFICE_IP_ALLOWLIST_KEY,
  OFFICE_IP_OWNER_EXEMPT_KEY,
  OFFICE_IDLE_MINUTES_KEY,
  OFFICE_MAX_HOURS_KEY,
  OFFICE_NEW_DEVICE_ALERT_KEY,
] as const;

/** /app boşta kalma etkinlik çerezi (imza/biçim yönetim çereziyle aynı: `signIdleCookie`). */
export const APP_IDLE_COOKIE = "es_app_seen";
/** Sunucu düzeyinde acil kapatma: `OFFICE_IP_ALLOWLIST=off` iken hiçbir ofiste IP kısıtı uygulanmaz. */
export const OFFICE_IP_ENV_OVERRIDE = "OFFICE_IP_ALLOWLIST";
/** İki adımlı doğrulama kurulum ekranı (proxy kapısının hedefi; /app dışında, modül kapısı yok). */
export const MFA_SETUP_PATH = "/giris/iki-adim-kurulum";

export const IDLE_MAX_MINUTES = 1440;
export const SESSION_MAX_HOURS_LIMIT = 720;

/** 2FA zorunlu kılınabilen roller (ekran sırası). Salt okunur rol de seçilebilir. */
export const MFA_ROLE_IDS = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"] as const;

export type OfficeSecurityPolicy = {
  mfaRoles: string[];
  ipRules: AllowRule[];
  /** Ofis sahibi IP kısıtından muaf mı (kilitlenmeye karşı; varsayılan açık). */
  ipOwnerExempt: boolean;
  /** 0 = kapalı. */
  idleMinutes: number;
  /** 0 = kapalı. */
  maxHours: number;
  newDeviceAlert: boolean;
};

export const DEFAULT_OFFICE_POLICY: OfficeSecurityPolicy = {
  mfaRoles: [],
  ipRules: [],
  ipOwnerExempt: true,
  idleMinutes: 0,
  maxHours: 0,
  newDeviceAlert: false,
};

/** Rol listesi (virgül/boşluk ayrımlı); bilinmeyen rol atılır, sıra MFA_ROLE_IDS'e göre, tekrarsız. */
export function parseRoleList(raw: string | null | undefined): string[] {
  const set = new Set(
    String(raw ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return MFA_ROLE_IDS.filter((r) => set.has(r));
}

/** Kayıt doğrulaması (kayıt defteri crossRule): bilinmeyen rol varsa hata metni. */
export function validateRoleList(raw: string): string | null {
  const tokens = String(raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = tokens.filter((t) => !(MFA_ROLE_IDS as readonly string[]).includes(t));
  return bad.length ? `Bilinmeyen rol: ${bad.slice(0, 3).join(", ")}` : null;
}

/** jsonb değeri (metin, sayı ya da bool) → ham metin. */
function rawText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function parseBool(raw: string | null, def: boolean): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "on" || v === "true" || v === "1") return true;
  if (v === "off" || v === "false" || v === "0") return false;
  return def;
}

/** Bir ofisin `tenant_settings` satırları (key, value) → politika. Bozuk değer = varsayılan (asla fırlatmaz). */
export function policyFromSettingRows(rows: readonly { key: string; value: unknown }[]): OfficeSecurityPolicy {
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.key, rawText(r.value));
  return {
    mfaRoles: parseRoleList(map.get(OFFICE_MFA_ROLES_KEY)),
    ipRules: parseAllowlist(map.get(OFFICE_IP_ALLOWLIST_KEY)).rules,
    ipOwnerExempt: parseBool(map.get(OFFICE_IP_OWNER_EXEMPT_KEY) ?? null, DEFAULT_OFFICE_POLICY.ipOwnerExempt),
    idleMinutes: parseMinutes(map.get(OFFICE_IDLE_MINUTES_KEY), 0, 0, IDLE_MAX_MINUTES),
    maxHours: parseMinutes(map.get(OFFICE_MAX_HOURS_KEY), 0, 0, SESSION_MAX_HOURS_LIMIT),
    newDeviceAlert: parseBool(map.get(OFFICE_NEW_DEVICE_ALERT_KEY) ?? null, DEFAULT_OFFICE_POLICY.newDeviceAlert),
  };
}

/** Proxy'de denetlenecek bir kural var mı (yoksa proxy hiçbir dala girmez). */
export function policyNeedsProxy(p: OfficeSecurityPolicy | null | undefined): p is OfficeSecurityPolicy {
  return Boolean(p && (p.mfaRoles.length > 0 || p.ipRules.length > 0 || p.idleMinutes > 0 || p.maxHours > 0));
}

/** IP izni: kural yok / acil kapatma / muaf sahip = serbest; aksi halde listede olmalı. */
export function officeIpAllowed(
  p: Pick<OfficeSecurityPolicy, "ipRules" | "ipOwnerExempt">,
  role: string | null | undefined,
  ip: string | null,
  envOverride?: string,
): boolean {
  if ((envOverride ?? "").trim().toLowerCase() === "off") return true;
  if (p.ipRules.length === 0) return true;
  if (role === "owner" && p.ipOwnerExempt) return true;
  return ipMatches(p.ipRules, ip);
}

/** Rol 2FA zorunlu listesinde ve kullanıcının SMS 2FA'sı kapalı → kurulum ekranına. */
export function mfaSetupRequired(p: Pick<OfficeSecurityPolicy, "mfaRoles">, role: string | null | undefined, twoFactorOn: boolean): boolean {
  return !twoFactorOn && !!role && p.mfaRoles.includes(role);
}

export type OfficeSessionEndReason = "office_ip" | "office_idle" | "office_session";

/** Giriş sayfası bildirimi (`/giris?reason=`); bilinmeyen neden = null. */
export function officeSecurityLoginNotice(reason: string | null | undefined): string | null {
  switch (reason) {
    case "office_ip":
      return "Ofisinizin güvenlik politikası bu ağdan (IP adresinden) girişe izin vermiyor. Ofis ağından bağlanın ya da ofis sahibinizle görüşün.";
    case "office_idle":
      return "Uzun süre işlem yapılmadığı için oturumunuz ofis güvenlik politikası gereği kapatıldı. Yeniden giriş yapın.";
    case "office_session":
      return "Oturum süreniz ofis güvenlik politikası gereği doldu. Yeniden giriş yapın.";
    default:
      return null;
  }
}
