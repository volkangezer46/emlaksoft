import { sanitizeLogText } from "@/lib/pii-mask";

/** onRequestError → hata kaydı girdisi (saf; test edilebilir). */
export function buildServerErrorEntry(
  err: unknown,
  path: string | null | undefined,
): { message: string; stack: string | null; digest: string | null; path: string | null } | null {
  const e = err as { message?: unknown; stack?: unknown; digest?: unknown } | null;
  const message = sanitizeLogText(e?.message ?? err ?? "", 500);
  if (!message) return null;
  const stack = sanitizeLogText(e?.stack ?? "", 4000) || null;
  const digest = typeof e?.digest === "string" && e.digest ? sanitizeLogText(e.digest, 160) : null;
  const cleanPath = typeof path === "string" ? (path.split(/[?#]/, 1)[0] || "/").slice(0, 300) : null;
  return { message, stack, digest, path: cleanPath };
}
