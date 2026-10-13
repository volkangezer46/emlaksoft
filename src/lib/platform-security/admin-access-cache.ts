import { resolveSupabaseAdminKey } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import {
  ADMIN_IP_ALLOWLIST_KEY,
  DEFAULT_IDLE_MINUTES,
  DEFAULT_MAX_HOURS,
  SESSION_MAX_HOURS_KEY,
  SESSION_IDLE_MINUTES_KEY,
  parseAllowlist,
  parseMinutes,
  type AdminAccessPolicy,
} from "./admin-access";

/**
 * Proxy için yönetim erişim politikası okuyucusu (yalnız /admin ve /api/admin isteklerinde çağrılır).
 * `platform-flags-cache.ts` deseni: tek PostgREST isteği (3 anahtar), örnek başına 30 sn bellek önbelleği.
 * Okuma hatasında SON BAŞARILI değer kullanılır (izin listesi bir DB kesintisinde kendiliğinden açılmaz); hiç başarılı
 * okuma yoksa kısıtsız (panel zaten DB'siz çalışmaz).
 */
const OK_TTL_MS = 30_000;
const FAIL_TTL_MS = 10_000;
const FETCH_TIMEOUT_MS = 1_500;
const OPEN: AdminAccessPolicy = { rules: [], idleMinutes: DEFAULT_IDLE_MINUTES, maxHours: DEFAULT_MAX_HOURS };

let memo: { at: number; ttl: number; value: AdminAccessPolicy } | null = null;
let lastGood: AdminAccessPolicy | null = null;

export function resetAdminAccessCache() {
  memo = null;
}

export function policyFromRows(rows: unknown): AdminAccessPolicy {
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
    rules: parseAllowlist(map.get(ADMIN_IP_ALLOWLIST_KEY)).rules,
    idleMinutes: parseMinutes(map.get(SESSION_IDLE_MINUTES_KEY), DEFAULT_IDLE_MINUTES, 0, 1440),
    maxHours: parseMinutes(map.get(SESSION_MAX_HOURS_KEY), DEFAULT_MAX_HOURS, 0, 168),
  };
}

export async function readAdminAccessPolicyCached(deps: { nowMs?: number; fetchImpl?: typeof fetch; url?: string; key?: string } = {}): Promise<AdminAccessPolicy> {
  const nowMs = deps.nowMs ?? now();
  if (memo && nowMs - memo.at < memo.ttl) return memo.value;
  const url = deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = deps.key ?? resolveSupabaseAdminKey();
  const fallback = lastGood ?? OPEN;
  if (!url || !key) {
    memo = { at: nowMs, ttl: FAIL_TTL_MS, value: fallback };
    return fallback;
  }
  const keys = [ADMIN_IP_ALLOWLIST_KEY, SESSION_IDLE_MINUTES_KEY, SESSION_MAX_HOURS_KEY].map((k) => `"${k}"`).join(",");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await (deps.fetchImpl ?? fetch)(
      `${url.replace(/\/$/, "")}/rest/v1/platform_settings?select=key,value&key=in.(${keys})`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`platform_settings ${res.status}`);
    const value = policyFromRows(await res.json());
    lastGood = value;
    memo = { at: nowMs, ttl: OK_TTL_MS, value };
    return value;
  } catch {
    memo = { at: nowMs, ttl: FAIL_TTL_MS, value: fallback };
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
