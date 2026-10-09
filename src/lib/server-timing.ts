import { formatServerTiming, serverTimingEnabled } from "./server-timing-core";

/**
 * Sunucu tarafı süre ölçümü (kabuk ve ana ekran). Next 16'da Server Component yanıt başlığı yazamaz, bu yüzden
 * gerçek `Server-Timing` başlığı yerine AYNI biçimde tek satır log yazılır: `[server-timing] app-shell;dur=84.2`.
 * Vercel/sunucu loglarından süreler okunur. Yalnız `EMLAKSOFT_SERVER_TIMING=1` iken çalışır (varsayılan kapalı,
 * maliyet sıfır). Ad sabit dizgedir; kullanıcı/kayıt bilgisi yazılmaz. Yalnız sunucu modülleri (layout/sayfa/yükleyici) çağırır.
 */
export async function measure<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  if (!serverTimingEnabled()) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.info(`[server-timing] ${formatServerTiming(name, performance.now() - t0)}`);
  }
}

/** `Promise.all` ile aynı, tek bölüm adıyla ölçülür (`await measureAll("ad", [a, b])`). Sorgular çağrıdan önce başlamıştır. */
export function measureAll<const T extends readonly unknown[]>(
  name: string,
  values: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  return measure(name, () => Promise.all(values));
}
