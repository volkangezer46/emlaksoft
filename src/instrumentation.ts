import type { Instrumentation } from "next";

/**
 * Standalone sunucu (`node server.js`, Hetzner/Coolify) next.config'i yeniden yüklemez;
 * üretim env kapısı (demo bayrakları, zorunlu sırlar, release migration) açılışta burada da uygulanır.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnvironment } = await import("@/lib/deployment-env");
  assertProductionEnvironment(process.env);
}

/**
 * Sunucu hatalarını /admin/sistem?sekme=hatalar listesine (source: "server") yazar.
 * Yalnız Node runtime: logError service_role + Node bağımlılıkları kullanır.
 * Hiçbir koşulda fırlatmaz.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const [{ buildServerErrorEntry }, { logError }] = await Promise.all([
      import("@/lib/server-error-report"),
      import("@/lib/error-log"),
    ]);
    const entry = buildServerErrorEntry(err, request?.path);
    if (!entry) return;
    await logError({ source: "server", ...entry });
  } catch {
    /* hata kaydı asıl hatayı gölgelememeli */
  }
};
