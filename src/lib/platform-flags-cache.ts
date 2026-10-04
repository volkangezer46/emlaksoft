import { PLATFORM_SETTING_KEYS, parseSettingBool } from "@/lib/platform-setting-keys";
import { resolveSupabaseAdminKey } from "@/lib/supabase/admin";

/**
 * Bakım modu / kayıt kapısı için HAFİF, kısa TTL bellek önbellekli okuyucu (proxy/middleware).
 * - Tek PostgREST isteği (3 anahtar); createAdminClient kullanmaz.
 * - Güvenli varsayılan: okuma hatasında SİTE AÇIK kalır (bakım kapalı, kayıt açık).
 * - Önbellek örnek (instance) başınadır; ayar değişikliği en geç TTL kadar sonra görünür.
 */
export type EdgeFlags = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  registrationOpen: boolean;
};

export const SAFE_FLAGS: EdgeFlags = {
  maintenanceMode: false,
  maintenanceMessage: "",
  registrationOpen: true,
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
  return {
    maintenanceMode: parseSettingBool(map.get(PLATFORM_SETTING_KEYS.maintenanceMode), false),
    maintenanceMessage: (map.get(PLATFORM_SETTING_KEYS.maintenanceMessage) ?? "").trim(),
    registrationOpen: parseSettingBool(map.get(PLATFORM_SETTING_KEYS.registrationOpen), true),
  };
}

export async function readPlatformFlagsCached(deps: Deps = {}): Promise<EdgeFlags> {
  const nowMs = deps.nowMs ?? Date.now();
  if (memo && nowMs - memo.at < memo.ttl) return memo.value;

  const url = deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = deps.key ?? resolveSupabaseAdminKey();
  if (!url || !key) {
    memo = { at: nowMs, ttl: FLAGS_FAIL_TTL_MS, value: SAFE_FLAGS };
    return SAFE_FLAGS;
  }

  const keys = [
    PLATFORM_SETTING_KEYS.maintenanceMode,
    PLATFORM_SETTING_KEYS.maintenanceMessage,
    PLATFORM_SETTING_KEYS.registrationOpen,
  ].join(",");
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

/** Bakım sayfası gösterilmeyen yollar: süper admin, giriş (MFA dahil), sağlık, cron, API, statik. */
export function isMaintenanceExemptPath(path: string): boolean {
  if (path === "/bakim") return true;
  const prefixes = ["/admin", "/giris", "/api", "/_next"];
  if (prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  if (path === "/favicon.ico" || path === "/robots.txt" || path === "/sitemap.xml") return true;
  // Dosya uzantılı yollar (statik varlıklar)
  return /\.[a-zA-Z0-9]{1,8}$/.test(path);
}
