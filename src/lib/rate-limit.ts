import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DB-tabanlı sabit-pencere hız sınırlayıcı. Public / auth'suz uç noktaları
 * (demo formu, token portal) spam ve kötüye kullanıma karşı korur.
 *
 * `check_rate_limit` RPC atomik sayar. RPC yoksa (migration uygulanmadıysa)
 * veya hata olursa "fail-open" davranır — meşru kullanıcıyı bloklamaz.
 */
export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<{ allowed: boolean }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_key: key,
      p_limit: opts.limit,
      p_window_sec: opts.windowSec,
    });
    if (error) {
      console.error("checkRateLimit rpc", error.message);
      return { allowed: true }; // fail-open
    }
    return { allowed: data === true };
  } catch (e) {
    console.error("checkRateLimit", e);
    return { allowed: true };
  }
}

/** İstek IP'sini header'lardan çözer (proxy zinciri dahil). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
