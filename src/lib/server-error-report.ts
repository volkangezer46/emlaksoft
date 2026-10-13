import { sanitizeLogText } from "@/lib/pii-mask";

/**
 * İstemci bağlantıyı kapatınca (sayfadan ayrılma, iptal edilen önceden yükleme/akış) oluşan, hata OLMAYAN durumlar.
 * Kaydedilirse /admin/hatalar gerçek hataları gömüyordu (2026-10-13: yüzlerce "destination stream closed early").
 */
const CLIENT_ABORT = /destination stream closed early|^aborted$|The operation was aborted|ECONNRESET|socket hang up|Response body object should not be disturbed or locked/i;

/** Next hata özeti (digest) bir karmadır, kişisel veri taşımaz; maskeleyiciye verilirse 10 haneli olanlar "[TELEFON]" oluyordu. */
function safeDigest(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.replace(/[^A-Za-z0-9@_.:-]/g, "").slice(0, 160);
  return d || null;
}

/** onRequestError → hata kaydı girdisi (saf; test edilebilir). İstemci kaynaklı iptaller null döner (kaydedilmez). */
export function buildServerErrorEntry(
  err: unknown,
  path: string | null | undefined,
): { message: string; stack: string | null; digest: string | null; path: string | null } | null {
  const e = err as { message?: unknown; stack?: unknown; digest?: unknown } | null;
  const message = sanitizeLogText(e?.message ?? err ?? "", 500);
  if (!message || CLIENT_ABORT.test(message) || (e as { name?: unknown } | null)?.name === "AbortError") return null;
  const stack = sanitizeLogText(e?.stack ?? "", 4000) || null;
  const digest = safeDigest(e?.digest);
  const cleanPath = typeof path === "string" ? (path.split(/[?#]/, 1)[0] || "/").slice(0, 300) : null;
  return { message, stack, digest, path: cleanPath };
}
