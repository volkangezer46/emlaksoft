import type { Instrumentation } from "next";

/**
 * Sunucu hatalarını /admin/hatalar'a (source: "server") yazar.
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
