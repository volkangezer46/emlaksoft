import { log } from "@/lib/log";

/**
 * Server action hata mesajları — TEK KAYNAK.
 *
 * Kural: kullanıcıya ham veritabanı / sağlayıcı hata metni (`error.message`) GÖSTERİLMEZ; o metin
 * PII maskelenerek loglanır. Kullanıcı NE OLDUĞUNU ve NE YAPACAĞINI söyleyen Türkçe bir cümle görür:
 *
 *   actionErrorMessage(error, "Müşteri kaydedilemedi")
 *   // 23505 → "Müşteri kaydedilemedi: aynı bilgilerle bir kayıt zaten var; listede arayıp mevcut kaydı güncelleyin."
 *   // ağ    → "Müşteri kaydedilemedi: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin."
 *
 * Kütüphane katmanı kullanıcıya gösterilebilir (önceden yazılmış, güvenli) bir mesaj fırlatmak
 * istiyorsa `ActionUserError` kullanır; yalnız onun metni olduğu gibi geçer.
 *
 * Sözleşme: `src/lib/action-errors-contract.test.ts` (action'lar ham `error.message` döndürmez,
 * çıplak "…edilemedi." mesajı yazılmaz).
 */

/** Metni kullanıcıya olduğu gibi gösterilebilen hata (önceden yazılmış, PII/teknik ayrıntı içermez). */
export class ActionUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionUserError";
  }
}

export type ActionErrorKind =
  | "duplicate"
  | "linked"
  | "permission"
  | "not_found"
  | "invalid"
  | "missing_field"
  | "weak_password"
  | "session"
  | "conflict"
  | "timeout"
  | "network"
  | "rate_limit"
  | "schema"
  | "unknown";

/** Hata türü → kullanıcıya NE YAPACAĞINI söyleyen ek (özne cümlesinden sonra gelir). */
export const ACTION_ERROR_HINTS: Record<ActionErrorKind, string> = {
  duplicate: "aynı bilgilerle bir kayıt zaten var; listede arayıp mevcut kaydı güncelleyin.",
  linked: "bağlı başka bir kayıt engel oluyor ya da seçilen bağlı kayıt artık yok; sayfayı yenileyip seçimleri kontrol edin.",
  permission: "bu işlem için yetkiniz yok; ofis yöneticinizden izin isteyin.",
  not_found: "kayıt bulunamadı, silinmiş olabilir; sayfayı yenileyip tekrar deneyin.",
  invalid: "girilen değerlerden biri geçersiz; alanları kontrol edip tekrar deneyin.",
  missing_field: "zorunlu bir alan boş kaldı; işaretli alanları doldurup tekrar deneyin.",
  weak_password: "parola yeterince güçlü değil; en az 8 karakterli, harf ve rakam içeren bir parola seçin.",
  session: "oturumunuzun süresi dolmuş olabilir; sayfayı yenileyin, sürerse çıkış yapıp yeniden giriş yapın.",
  conflict: "kayıt aynı anda başka biri tarafından değiştirildi; sayfayı yenileyip tekrar deneyin.",
  timeout: "işlem zaman aşımına uğradı; birkaç saniye sonra tekrar deneyin.",
  network: "bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin.",
  rate_limit: "çok sık deneme yapıldı; bir dakika bekleyip tekrar deneyin.",
  schema: "bu özellik için sistem güncellemesi bekleniyor; destek ekibine bildirin.",
  unknown: "beklenmeyen bir sorun oluştu; birkaç saniye sonra tekrar deneyin, sürerse destek ekibine yazın.",
};

type ErrorLike = { code?: unknown; message?: unknown; status?: unknown; name?: unknown; details?: unknown; hint?: unknown };

const CODE_KIND: Record<string, ActionErrorKind> = {
  // PostgreSQL
  "23505": "duplicate",
  "23503": "linked",
  "23502": "missing_field",
  "23514": "invalid",
  "22P02": "invalid",
  "22001": "invalid",
  "22003": "invalid",
  "22007": "invalid",
  "22008": "invalid",
  "22023": "invalid",
  "42501": "permission",
  "40001": "conflict",
  "40P01": "conflict",
  "57014": "timeout",
  "53300": "network",
  "08000": "network",
  "08003": "network",
  "08006": "network",
  "42P01": "schema",
  "42703": "schema",
  "42883": "schema",
  // PostgREST
  PGRST116: "not_found",
  PGRST202: "schema",
  PGRST204: "schema",
  PGRST205: "schema",
  PGRST301: "session",
  PGRST302: "session",
  PGRST303: "session",
  // Supabase Auth
  email_exists: "duplicate",
  user_already_exists: "duplicate",
  phone_exists: "duplicate",
  weak_password: "weak_password",
  same_password: "invalid",
  validation_failed: "invalid",
  email_address_invalid: "invalid",
  user_not_found: "not_found",
  session_not_found: "session",
  session_expired: "session",
  bad_jwt: "session",
  no_authorization: "session",
  not_admin: "permission",
  over_request_rate_limit: "rate_limit",
  over_email_send_rate_limit: "rate_limit",
  over_sms_send_rate_limit: "rate_limit",
  request_timeout: "timeout",
};

function asErrorLike(err: unknown): ErrorLike | null {
  if (err == null) return null;
  if (typeof err === "string") return { message: err };
  if (typeof err === "object") return err as ErrorLike;
  return { message: String(err) };
}

/** Supabase / PostgREST / Auth / fetch hatasını türüne ayırır (saf). */
export function classifyActionError(err: unknown): ActionErrorKind {
  const e = asErrorLike(err);
  if (!e) return "unknown";
  const code = e.code == null ? "" : String(e.code);
  if (code && CODE_KIND[code]) return CODE_KIND[code];
  const status = typeof e.status === "number" ? e.status : Number(e.status) || 0;
  const message = typeof e.message === "string" ? e.message : "";
  const name = typeof e.name === "string" ? e.name : "";

  if (/row-level security|permission denied|insufficient privilege/i.test(message)) return "permission";
  if (/duplicate key|already (exists|registered)/i.test(message)) return "duplicate";
  if (/violates foreign key/i.test(message)) return "linked";
  if (/JWT expired|invalid JWT|jwt/i.test(message) && status !== 403) return "session";
  if (name === "AbortError" || name === "TimeoutError" || /time(d)? ?out|ETIMEDOUT|statement timeout/i.test(message)) return "timeout";
  if (/fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|Failed to fetch/i.test(message)) return "network";
  if (/rate limit|too many requests/i.test(message)) return "rate_limit";
  if (/schema cache|does not exist|could not find the (function|table)/i.test(message)) return "schema";

  if (status === 401) return "session";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "network";
  return "unknown";
}

/** "Kayıt kaydedilemedi. Lütfen tekrar deneyin." → "Kayıt kaydedilemedi" (özne cümlesi). */
export function actionErrorSubject(subject: string): string {
  return subject
    .trim()
    .replace(/\s*Lütfen (daha sonra )?tekrar deneyin\.?$/i, "")
    .replace(/[.!\s]+$/u, "");
}

/**
 * Kullanıcıya gösterilecek hata mesajı. `err` null olabilir (ör. dönen satır yok); o zaman genel
 * "tekrar deneyin / destek" eki kullanılır. Ham hata metni yalnız loglanır.
 *
 * @param overrides Belirli bir tür için ekranın bağlamına özel ek (ör. `{ duplicate: "bu adla bir takım zaten var." }`).
 */
export function actionErrorMessage(
  err: unknown,
  subject: string,
  overrides?: Partial<Record<ActionErrorKind, string>>,
): string {
  if (err instanceof ActionUserError) return err.message;
  const kind = classifyActionError(err);
  if (err != null) {
    const e = asErrorLike(err);
    log.error("action_error", {
      subject: actionErrorSubject(subject),
      kind,
      code: e?.code == null ? null : String(e.code),
      status: typeof e?.status === "number" ? e.status : null,
      message: typeof e?.message === "string" ? e.message : null,
    });
  }
  const hint = overrides?.[kind] ?? ACTION_ERROR_HINTS[kind];
  return `${actionErrorSubject(subject)}: ${hint}`;
}

/** Oturum kullanıcısı doğrulanamadığında (getUser boş / başka kullanıcı) tek mesaj. */
export const SESSION_EXPIRED_MESSAGE = `Oturum doğrulanamadı: ${ACTION_ERROR_HINTS.session}`;

/**
 * SQL fonksiyonunun `raise exception '...'` ile KULLANICI İÇİN yazdığı mesaj (varsayılan kod P0001);
 * yoksa null. Postgres'in kendi teknik metinleri (RLS, kısıt ihlali, İngilizce) geçmez.
 *
 *   sqlRaiseMessage(error) ?? actionErrorMessage(error, "Anonimleştirme yapılamadı")
 */
export function sqlRaiseMessage(err: unknown, codes: readonly string[] = ["P0001"]): string | null {
  const e = asErrorLike(err);
  if (!e || !codes.includes(String(e.code ?? ""))) return null;
  const msg = typeof e.message === "string" ? e.message.trim() : "";
  if (!msg || msg.length > 300) return null;
  if (/row-level security|permission denied|violates|duplicate key|syntax error|does not exist|function |relation /i.test(msg)) return null;
  return msg;
}
