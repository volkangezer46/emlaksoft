import { PLATFORM_SETTING_KEYS, parseSettingBool } from "@/lib/platform-setting-keys";
import { resolveSupabaseAdminKey } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import {
  DEFAULT_MAINTENANCE_SCOPE,
  MAINTENANCE_SCOPE_SETTING_KEY,
  parseMaintenanceScope,
  type MaintenanceScopeSetting,
} from "@/lib/platform-security/maintenance-scope";

export { isMaintenanceExemptPath } from "@/lib/platform-security/maintenance-scope";

/** Güvenlik anahtarları (AP1): demo girişi, personel MFA, MFA geçiş süresi. Ham metin; çözümleme platform-security/*. */
export const SECURITY_SETTING_KEYS = {
  demoLogin: "platform.demo_login",
  mfaEnforced: "platform.mfa_enforced",
  mfaGraceUntil: "platform.mfa_grace_until",
} as const;

/**
 * Bakım modu / kayıt kapısı / güvenlik anahtarları (demo girişi, personel MFA) için HAFİF, kısa TTL bellek önbellekli
 * okuyucu (proxy/middleware ve sunucu bileşenleri).
 * - Tek PostgREST isteği (7 anahtar); createAdminClient kullanmaz.
 * - Güvenli varsayılan: okuma hatasında SİTE AÇIK kalır (bakım kapalı, kayıt açık).
 *   Güvenlik anahtarlarında okuma hatası = "satır yok" (env davranışı); SQL kapıları MFA'yı ayrıca DB'den uygular.
 * - Önbellek örnek (instance) başınadır; ayar değişikliği en geç TTL kadar sonra görünür (yazan eylem
 *   `resetPlatformFlagsCache` ile kendi örneğini hemen tazeler).
 */
export type EdgeFlags = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  registrationOpen: boolean;
  /** Bakım kapsamı + zaman penceresi (yoksa "app"). */
  maintenanceScope: MaintenanceScopeSetting;
  /** 'platform.demo_login' ham JSON (yoksa null → env davranışı). */
  demoLoginRaw: string | null;
  /** 'platform.mfa_enforced' ham değer (yoksa null). */
  mfaEnforcedRaw: string | null;
  /** 'platform.mfa_grace_until' ISO (yoksa null). */
  mfaGraceUntil: string | null;
};

export const SAFE_FLAGS: EdgeFlags = {
  maintenanceMode: false,
  maintenanceMessage: "",
  registrationOpen: true,
  maintenanceScope: DEFAULT_MAINTENANCE_SCOPE,
  demoLoginRaw: null,
  mfaEnforcedRaw: null,
  mfaGraceUntil: null,
};

export const FLAGS_OK_TTL_MS = 30_000;
export const FLAGS_FAIL_TTL_MS = 10_000;
const FETCH_TIMEOUT_MS = 1_500;

let memo: { at: number; ttl: number; value: EdgeFlags } | null = null;

export function resetPlatformFlagsCache() {
  memo = null;
}

type Deps = {
  nowMs?: number;
  fetchImpl?: typeof fetch;
  url?: string;
  key?: string;
};

export function parseFlagRows(rows: unknown): EdgeFlags {
  const map = new Map<string, string>();
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (r && typeof r === "object" && typeof (r as { key?: unknown }).key === "string") {
        const v = (r as { value?: unknown }).value;
        map.set((r as { key: string }).key, typeof v === "string" ? v : "");
      }
    }
  }
  const rawOrNull = (k: string) => {
    const v = (map.get(k) ?? "").trim();
    return v ? v : null;
  };
  return {
    maintenanceMode: parseSettingBool(map.get(PLATFORM_SETTING_KEYS.maintenanceMode), false),
    maintenanceMessage: (map.get(PLATFORM_SETTING_KEYS.maintenanceMessage) ?? "").trim(),
    registrationOpen: parseSettingBool(map.get(PLATFORM_SETTING_KEYS.registrationOpen), true),
    maintenanceScope: parseMaintenanceScope(map.get(MAINTENANCE_SCOPE_SETTING_KEY)),
    demoLoginRaw: rawOrNull(SECURITY_SETTING_KEYS.demoLogin),
    mfaEnforcedRaw: rawOrNull(SECURITY_SETTING_KEYS.mfaEnforced),
    mfaGraceUntil: rawOrNull(SECURITY_SETTING_KEYS.mfaGraceUntil),
  };
}

export async function readPlatformFlagsCached(deps: Deps = {}): Promise<EdgeFlags> {
  const nowMs = deps.nowMs ?? now();
  if (memo && nowMs - memo.at < memo.ttl) return memo.value;

  const url = deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = deps.key ?? resolveSupabaseAdminKey();
  if (!url || !key) {
    memo = { at: nowMs, ttl: FLAGS_FAIL_TTL_MS, value: SAFE_FLAGS };
    return SAFE_FLAGS;
  }

  // Noktalı anahtarlar PostgREST `in` listesinde çift tırnakla verilir.
  const keys = [
    PLATFORM_SETTING_KEYS.maintenanceMode,
    PLATFORM_SETTING_KEYS.maintenanceMessage,
    PLATFORM_SETTING_KEYS.registrationOpen,
    MAINTENANCE_SCOPE_SETTING_KEY,
    SECURITY_SETTING_KEYS.demoLogin,
    SECURITY_SETTING_KEYS.mfaEnforced,
    SECURITY_SETTING_KEYS.mfaGraceUntil,
  ]
    .map((k) => `"${k}"`)
    .join(",");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await (deps.fetchImpl ?? fetch)(
      `${url.replace(/\/$/, "")}/rest/v1/platform_settings?select=key,value&key=in.(${keys})`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`platform_settings ${res.status}`);
    const value = parseFlagRows(await res.json());
    memo = { at: nowMs, ttl: FLAGS_OK_TTL_MS, value };
    return value;
  } catch {
    // Güvenli varsayılan: site açık kalır; kısa süre sonra yeniden denenir.
    memo = { at: nowMs, ttl: FLAGS_FAIL_TTL_MS, value: SAFE_FLAGS };
    return SAFE_FLAGS;
  } finally {
    clearTimeout(timer);
  }
}
