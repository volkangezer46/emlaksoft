/**
 * Evrak toplama linki (F4) — saf, yan etkisiz yardımcılar (sunucu + istemci ortak).
 *
 * Güvenlik kararları:
 *  - Ham token saklanmaz; veritabanında yalnız SHA-256 özeti durur (bkz. server.ts).
 *  - Link SÜRELİ, dosya sayısı SINIRLI ve iptal edilebilir; "Gönder" ile tek kullanımlık kapanır.
 *  - Kimlik belgesi OCR'a GÖNDERİLMEZ; OCR yalnız tapu / yetki belgesi türlerinde önerilir
 *    ve sonuç kullanıcı onayına kadar kaydedilmez.
 *  - SMS gönderilmez: link panelde kopyalanır.
 */

export const DOC_TYPES = [
  "identity",
  "title_deed",
  "power_of_attorney",
  "authorization_contract",
  "tax_document",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  identity: "Kimlik belgesi",
  title_deed: "Tapu belgesi",
  power_of_attorney: "Vekâletname",
  authorization_contract: "Yetki sözleşmesi",
  tax_document: "Vergi levhası / ticari belge",
  other: "Diğer belge",
};

/** OCR önerisi yalnız bu türlerde sunulur; kimlik ve diğerleri HİÇBİR ZAMAN OCR'a gitmez. */
export const OCR_ALLOWED_TYPES: readonly DocType[] = ["title_deed", "authorization_contract"];
/** Vision modeli yalnız görsel okur; PDF OCR'ı bu sürümde yoktur. */
export const OCR_ALLOWED_MIME: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

export const EXPIRY_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_FILES_LIMIT = 20;
export const DEFAULT_MAX_FILES = 10;

export const REQUEST_STATUSES = ["active", "completed", "revoked"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const DOC_REQUEST_STATUS_LABELS: Record<RequestStatus | "expired" | "full", string> = {
  active: "Açık",
  completed: "Tamamlandı",
  revoked: "İptal edildi",
  expired: "Süresi doldu",
  full: "Dosya sınırı doldu",
};

/**
 * ESKİ yer tutucu — CANLIDA GÖSTERİLMEZ (yalnız geriye dönük import uyumu).
 * Evrak sayfası bunun yerine KVKK_PLATFORM_NOTICE_TEXT + KVKK_PLATFORM_NOTICE_HREF gösterir.
 * AVUKAT ONAYI GEREKİR: ofise özgü aydınlatma metni modeli henüz yok; eklenince burası ofis metnine yönlenir.
 */
export const KVKK_PLACEHOLDER_TEXT =
  "[KVKK aydınlatma metni yer tutucusu] Yüklediğiniz belgeler yalnızca ilgili emlak ofisi tarafından, işlemin yürütülmesi amacıyla işlenir. Güncel aydınlatma metni ofisiniz tarafından hazırlanıp buraya eklenmelidir.";

/** Ofise özgü aydınlatma yoksa gösterilen nötr yönlendirme (hukuki metin değil; yalnız bağlantıya yönlendirir). */
export const KVKK_PLATFORM_NOTICE_TEXT =
  "Yüklediğiniz belgelerin kişisel veri olarak nasıl işlendiği, genel platform aydınlatma metninde açıklanır.";
export const KVKK_PLATFORM_NOTICE_HREF = "/kvkk-aydinlatma";

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
}

export function isOcrEligible(docType: string, mime: string): boolean {
  return (OCR_ALLOWED_TYPES as readonly string[]).includes(docType) && OCR_ALLOWED_MIME.includes(mime);
}

/** Token biçimi: 32 bayt → 43 karakter base64url. Biçim dışı değer veritabanına hiç gitmez. */
export function isWellFormedToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

export type RequestStateInput = {
  status: string;
  expires_at: string;
  file_count: number;
  max_files: number;
};
export type RequestState = "ok" | "expired" | "revoked" | "completed" | "full";

/** Linkin yükleme kabul edip etmediği; sıra: iptal > tamamlandı > süre > doluluk. */
export function evaluateRequestState(r: RequestStateInput, nowMs: number): RequestState {
  if (r.status === "revoked") return "revoked";
  if (r.status === "completed") return "completed";
  const exp = Date.parse(r.expires_at);
  if (!Number.isFinite(exp) || exp <= nowMs) return "expired";
  if (r.file_count >= r.max_files) return "full";
  return "ok";
}

/** Panel listesinde gösterilecek tek durum etiketi anahtarı. */
export function displayStatus(r: RequestStateInput, nowMs: number): RequestStatus | "expired" | "full" {
  const s = evaluateRequestState(r, nowMs);
  return s === "ok" ? "active" : s;
}

export type CreateRequestInput = {
  title: string;
  types: DocType[];
  expiryDays: number;
  maxFiles: number;
  customerId: string | null;
  propertyId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCreateRequestForm(
  fd: FormData,
): { ok: true; value: CreateRequestInput } | { ok: false; error: string } {
  const title = String(fd.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!title) return { ok: false, error: "Talebe kısa bir başlık yazın (örn. Daire 12 evrakları)." };
  const types = [...new Set(fd.getAll("types").map((t) => String(t)))].filter(isDocType);
  if (types.length === 0) return { ok: false, error: "En az bir evrak türü seçin." };

  const expiryRaw = String(fd.get("expiry_days") ?? "").trim();
  const expiryDays = expiryRaw ? Number(expiryRaw) : DEFAULT_EXPIRY_DAYS;
  if (!(EXPIRY_DAY_OPTIONS as readonly number[]).includes(expiryDays)) {
    return { ok: false, error: "Geçerlilik süresi listeden seçilmeli." };
  }
  const maxRaw = String(fd.get("max_files") ?? "").trim();
  const maxFiles = maxRaw ? Number(maxRaw) : DEFAULT_MAX_FILES;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_FILES_LIMIT) {
    return { ok: false, error: `Dosya sınırı 1 ile ${MAX_FILES_LIMIT} arasında olmalı.` };
  }
  const customerId = String(fd.get("customer_id") ?? "").trim();
  const propertyId = String(fd.get("property_id") ?? "").trim();
  if (customerId && !UUID_RE.test(customerId)) return { ok: false, error: "Müşteri geçersiz." };
  if (propertyId && !UUID_RE.test(propertyId)) return { ok: false, error: "Portföy geçersiz." };
  if (!customerId && !propertyId) return { ok: false, error: "Bir müşteri veya portföy seçin." };

  return {
    ok: true,
    value: { title, types, expiryDays, maxFiles, customerId: customerId || null, propertyId: propertyId || null },
  };
}

/** Hangi istenen türler için henüz doğrulanmış dosya yok (eksik evrak listesi). */
export function missingTypes(requested: readonly string[], verifiedTypes: readonly string[]): DocType[] {
  const have = new Set(verifiedTypes);
  return requested.filter((t): t is DocType => isDocType(t) && !have.has(t));
}
