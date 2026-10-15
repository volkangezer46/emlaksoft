/**
 * Giriş kısıtlayıcı — SAF karar katmanı (DB yok; testli). Uygulayıcı: `login-throttle.ts`.
 *
 * İki kova:
 *  - HESAP (e-posta): ilk 4 hata serbest, sonra her hatada bekleme ikiye katlanır (2 sn → 5 dk tavan). Hesap
 *    KİLİTLENMEZ: saldırgan kurbanın girişini kalıcı engelleyemez, yalnız deneme hızı saatte birkaç taneye iner.
 *  - IP: ilk 9 hata serbest, sonra artan bekleme; 1 saatte 60 hatada pencere sonuna kadar engel (parola püskürtme).
 * Pencere son hatadan itibaren uzar (hesap 15 dk, IP 1 sa); başarılı giriş hesap kovasını sıfırlar.
 */

export type ThrottleScope = "account" | "ip";

export type ThrottleBucketState = { failures: number; lastFailureAtMs: number };

export const ACCOUNT_WINDOW_SEC = 15 * 60;
export const IP_WINDOW_SEC = 60 * 60;
export const ACCOUNT_FREE_FAILURES = 4;
export const IP_FREE_FAILURES = 9;
export const IP_BLOCK_FAILURES = 60;
export const MAX_DELAY_SEC = 5 * 60;

/** `failures` hatadan sonra bir sonraki denemeden önce beklenecek süre (sn). */
export function delayAfterFailures(failures: number, freeFailures: number): number {
  if (!Number.isFinite(failures) || failures <= freeFailures) return 0;
  const exponent = Math.min(failures - freeFailures, 20);
  return Math.min(2 ** exponent, MAX_DELAY_SEC);
}

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; scope: ThrottleScope; retryAfterSec: number };

/** Kovaların durumuna göre bu denemeye izin var mı? En uzun bekleme kazanır. */
export function throttleDecision(
  state: { account?: ThrottleBucketState | null; ip?: ThrottleBucketState | null },
  nowMs: number,
): ThrottleDecision {
  let worst: { scope: ThrottleScope; retryAfterSec: number } | null = null;
  const consider = (scope: ThrottleScope, bucket: ThrottleBucketState | null | undefined, free: number) => {
    if (!bucket) return;
    let waitSec = 0;
    if (scope === "ip" && bucket.failures >= IP_BLOCK_FAILURES) {
      waitSec = Math.ceil((bucket.lastFailureAtMs + IP_WINDOW_SEC * 1000 - nowMs) / 1000);
    } else {
      const delay = delayAfterFailures(bucket.failures, free);
      waitSec = Math.ceil((bucket.lastFailureAtMs + delay * 1000 - nowMs) / 1000);
    }
    if (waitSec > 0 && (!worst || waitSec > worst.retryAfterSec)) worst = { scope, retryAfterSec: waitSec };
  };
  consider("account", state.account, ACCOUNT_FREE_FAILURES);
  consider("ip", state.ip, IP_FREE_FAILURES);
  return worst ? { allowed: false, ...(worst as { scope: ThrottleScope; retryAfterSec: number }) } : { allowed: true };
}

/** "45 saniye" / "3 dakika" — resmi, kısa bekleme ifadesi. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} saniye`;
  return `${Math.ceil(seconds / 60)} dakika`;
}

export function throttleMessage(decision: Extract<ThrottleDecision, { allowed: false }>): string {
  return decision.scope === "ip"
    ? `Bu ağdan çok sayıda başarısız giriş denemesi yapıldı. Lütfen ${formatWait(decision.retryAfterSec)} sonra tekrar deneyin.`
    : `Güvenliğiniz için bu hesaba girişler kısa süre yavaşlatıldı. Lütfen ${formatWait(decision.retryAfterSec)} sonra tekrar deneyin ya da şifrenizi sıfırlayın.`;
}
