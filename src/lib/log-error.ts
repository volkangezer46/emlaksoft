/**
 * Yapılandırılmış log için hata → { code, message } dönüştürücü.
 *
 * Ham hata nesneleri (PostgREST/Storage/sağlayıcı) loga olduğu gibi
 * yazılmaz: `details`/`hint` gibi alanlar müşteri telefonu/e-postası içerebilir.
 * Yalnız kod ve mesaj alınır; `log.*` bu metinleri ayrıca PII maskeler ve kırpar.
 * Saf, bağımlılıksız; asla hata fırlatmaz.
 */
export type ErrorLogFields = {
  code: string | null;
  message: string | null;
};

function pick(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function errorFields(error: unknown): ErrorLogFields {
  try {
    if (error == null) return { code: null, message: null };
    if (typeof error === "string") return { code: null, message: error || null };
    if (typeof error !== "object") return { code: null, message: pick(error) };
    const e = error as { code?: unknown; statusCode?: unknown; status?: unknown; message?: unknown; name?: unknown };
    const code = pick(e.code) ?? pick(e.statusCode) ?? pick(e.status) ?? (error instanceof Error ? pick(e.name) : null);
    return { code, message: pick(e.message) };
  } catch {
    return { code: null, message: null };
  }
}
