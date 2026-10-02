import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIpFromHeaders, opaqueRateLimitPart } from "@/lib/public-request-security";
import { logError } from "@/lib/error-log";

export type RateLimitFailurePolicy = "allow" | "deny";

export type RateLimitOptions = {
  limit: number;
  windowSec: number;
  /**
   * Güvenlik/maliyet kritik işlemler `deny` kullanır. Düşük riskli, salt-okunur
   * uçlar geriye uyumluluk için varsayılan `allow` davranışını koruyabilir.
   */
  failurePolicy?: RateLimitFailurePolicy;
};

export type RateLimitResult = {
  allowed: boolean;
  degraded?: boolean;
};

let lastInfrastructureLogAt = 0;

export function rateLimitFailureResult(
  failurePolicy: RateLimitFailurePolicy = "allow",
): RateLimitResult {
  return { allowed: failurePolicy === "allow", degraded: true };
}

async function recordInfrastructureFailure(message: string) {
  console.error("checkRateLimit", message);
  const now = Date.now();
  if (now - lastInfrastructureLogAt < 60_000) return;
  lastInfrastructureLogAt = now;
  await logError({
    source: "server",
    message: `Rate limit altyapısı kullanılamıyor: ${message}`,
    path: "rate-limit",
  });
}

/**
 * DB-tabanlı sabit-pencere hız sınırlayıcı. Public / auth'suz uç noktaları
 * (demo formu, token portal) spam ve kötüye kullanıma karşı korur.
 *
 * `check_rate_limit` RPC atomik sayar. RPC yoksa (migration uygulanmadıysa)
 * veya hata olursa çağıranın açık failure policy seçimi uygulanır.
 */
export async function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: `v1:${opaqueRateLimitPart(key)}`,
      p_limit: opts.limit,
      p_window_sec: opts.windowSec,
    });
    if (error) {
      await recordInfrastructureFailure(error.message);
      return rateLimitFailureResult(opts.failurePolicy);
    }
    return { allowed: data === true };
  } catch (e) {
    await recordInfrastructureFailure(e instanceof Error ? e.message : String(e));
    return rateLimitFailureResult(opts.failurePolicy);
  }
}

/** İstek IP'sini header'lardan çözer (proxy zinciri dahil). */
export async function clientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}
