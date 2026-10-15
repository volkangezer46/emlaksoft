/**
 * Boşta çalıştır: ilk boyama/etkileşim işleri bitince (requestIdleCallback; yoksa kısa setTimeout).
 * İstemci tarafı yardımcıdır; dönen fonksiyon bekleyen işi iptal eder.
 *
 * SÖZLEŞME (src/lib/idle-contract.test.ts): varsayılan üst sınır IDLE_DEFAULT_TIMEOUT_MS = 4000 ms DEĞİŞMEZ; panel/ön
 * yükleme gibi ertelenebilir işler bu varsayılanı kullanır. Zamana duyarlı iş (realtime aboneliği: SSR ile ilk katılım
 * arasındaki pencere kısa kalmalı) daha kısa sınırı AÇIK parametreyle ister: `runWhenIdle(fn, { timeoutMs: 800 })`.
 */
export const IDLE_DEFAULT_TIMEOUT_MS = 4_000;
/** requestIdleCallback olmayan tarayıcıda (Safari) gecikme; açık `timeoutMs` daha kısaysa o kullanılır. */
export const IDLE_FALLBACK_DELAY_MS = 1_500;

export type RunWhenIdleOptions = {
  /** Boşta an gelmese de en geç bu kadar ms sonra çalışır (varsayılan IDLE_DEFAULT_TIMEOUT_MS). */
  timeoutMs?: number;
};

export function runWhenIdle(cb: () => void, opts: RunWhenIdleOptions = {}): () => void {
  if (typeof window === "undefined") return () => {};
  const timeout = Math.max(0, opts.timeoutMs ?? IDLE_DEFAULT_TIMEOUT_MS);
  const w = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(cb, Math.min(IDLE_FALLBACK_DELAY_MS, timeout));
  return () => window.clearTimeout(t);
}
