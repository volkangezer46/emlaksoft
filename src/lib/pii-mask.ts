/**
 * Hata/log metinleri için hafif, saf PII maskeleme.
 *
 * Ham sağlayıcı (Supabase/iyzico/OpenAI) hata mesajları e-posta, telefon, TC
 * kimlik no veya IBAN içerebilir; hata kaydına ve loglara yazılmadan önce
 * maskelenir. AI için olan tam redaktör `src/lib/ai/redact.ts`tir; bu modül
 * yalnızca log yolunda (bağımlılıksız) kullanılır.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN_RE = /\bTR\d{2}(?: ?\d{4}){5} ?\d{2}\b/gi;
// 13-19 haneli (boşluk/tire ayraçlı olabilir) kart benzeri diziler
const CARD_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const TC_RE = /(?<!\d)[1-9]\d{10}(?!\d)/g;
// 05xx xxx xx xx, +90 5xx ..., 5xxxxxxxxx
const PHONE_RE = /(?<!\d)(?:\+\d{1,3}[ -]?)?(?:0[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g;

export function maskPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[E_POSTA]")
    .replace(IBAN_RE, "[IBAN]")
    .replace(CARD_RE, "[KART]")
    .replace(TC_RE, "[TC_KIMLIK]")
    .replace(PHONE_RE, "[TELEFON]");
}

/** Maskele sonra kırp: kırpma bir deseni ikiye bölüp sızdırmasın. */
export function sanitizeLogText(value: unknown, max: number): string {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  return maskPii(raw).trim().slice(0, max);
}

/** Tenant kimliğinin yalnız ilk 8 karakteri (log korelasyonu için yeterli). */
export function shortTenantId(id: string | null | undefined): string | null {
  return id ? id.slice(0, 8) : null;
}
