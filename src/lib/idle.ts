/**
 * Boşta çalıştır: ilk boyama/etkileşim işleri bitince (requestIdleCallback; yoksa 1500 ms
 * setTimeout). İstemci tarafı yardımcıdır; dönen fonksiyon bekleyen işi iptal eder.
 */
export function runWhenIdle(cb: () => void, timeoutMs = 1500): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(cb, timeoutMs);
  return () => window.clearTimeout(t);
}
