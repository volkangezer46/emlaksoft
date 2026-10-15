import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { opaqueRateLimitPart } from "@/lib/public-request-security";
import { now } from "@/lib/clock";
import {
  ACCOUNT_WINDOW_SEC,
  IP_WINDOW_SEC,
  throttleDecision,
  type ThrottleBucketState,
  type ThrottleDecision,
} from "./login-throttle-core";

/**
 * Giriş kısıtlayıcı uygulayıcısı (hesap + IP kovaları, `auth_login_throttle` RPC'leri; migration 20261018090000).
 * Anahtarlar opak (sha256): DB'de e-posta ya da IP ham tutulmaz. RPC yoksa / hata verirse kısıtlayıcı devre dışı kalır
 * (fail-open): çağıran zaten `check_rate_limit` sabit pencere sınırını (fail-closed) ayrıca uygular.
 */

type Row = { bucket: string; failures: number; last_failure_at: string };

export function loginThrottleKeys(email: string, ip: string) {
  return {
    account: `v1:${opaqueRateLimitPart(`login:acct:${email.trim().toLowerCase()}`)}`,
    ip: `v1:${opaqueRateLimitPart(`login:ip:${ip}`)}`,
  };
}

function toState(rows: Row[] | null | undefined, key: string): ThrottleBucketState | null {
  const row = rows?.find((r) => r.bucket === key);
  if (!row) return null;
  const at = Date.parse(row.last_failure_at);
  return Number.isFinite(at) ? { failures: Number(row.failures) || 0, lastFailureAtMs: at } : null;
}

/** Denemeden ÖNCE: bekleme süresi dolmadıysa reddedilir (GoTrue'ya hiç gidilmez). */
export async function checkLoginThrottle(email: string, ip: string): Promise<ThrottleDecision> {
  const keys = loginThrottleKeys(email, ip);
  try {
    const { data, error } = await createAdminClient().rpc("auth_login_throttle_peek", { p_keys: [keys.account, keys.ip] });
    if (error) return { allowed: true };
    const rows = data as Row[] | null;
    return throttleDecision({ account: toState(rows, keys.account), ip: toState(rows, keys.ip) }, now());
  } catch {
    return { allowed: true };
  }
}

/** Başarısız denemeden SONRA: iki kova artar; bir sonraki deneme için bekleme kararı döner. */
export async function recordLoginFailure(email: string, ip: string): Promise<ThrottleDecision> {
  const keys = loginThrottleKeys(email, ip);
  try {
    const { data, error } = await createAdminClient().rpc("auth_login_throttle_fail", {
      p_keys: [keys.account, keys.ip],
      p_windows: [ACCOUNT_WINDOW_SEC, IP_WINDOW_SEC],
    });
    if (error) return { allowed: true };
    const rows = data as Row[] | null;
    return throttleDecision({ account: toState(rows, keys.account), ip: toState(rows, keys.ip) }, now());
  } catch {
    return { allowed: true };
  }
}

/** Başarılı girişte hesap kovası sıfırlanır (IP kovası kalır: aynı ağdan başka hesaplara püskürtme sayılmaya devam eder). */
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  try {
    await createAdminClient().rpc("auth_login_throttle_clear", { p_key: loginThrottleKeys(email, ip).account });
  } catch {
    // en iyi çaba
  }
}
