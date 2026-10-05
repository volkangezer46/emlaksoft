/**
 * EmlakFiyati adaptörü — SAF kurallar (ağ yok, sunucu/istemci ortak).
 * Kaynak: EmlakFiyati ekibinin bildirdiği sözleşme. Burada OLMAYAN her şey "doğrulanmadı"dır.
 */

export const EMLAKFIYATI_BASE_URL = "https://emlakfiyati.com";
/** Anahtar öneki (tek tanım yeri). */
export const EMLAKFIYATI_KEY_PREFIX = "ek_live_";
export const EMLAKFIYATI_MAX_CONCURRENCY = 4;
/** Anahtar başına dakikalık varsayılan sınır (bilgi; aşılınca 429 {"hata":"istek siniri asildi"}, Retry-After YOK). */
export const EMLAKFIYATI_RATE_LIMIT_PER_MINUTE = 120;
export const EMLAKFIYATI_PREVIOUS_KEY_DAYS = 7;

/**
 * Adaptörün çağırabileceği yollar (GET). YALNIZ `/api/endeks` için parametre şeması doğrulandı;
 * diğerleri için şema gerekli (bkz. docs/HAFIZA.md). `/api/parsel/rapor` (PDF) KULLANICI ÜRÜNÜNDE KULLANILMAZ: listede YOK.
 * `/api/ilanlar` ham ilan için `listing:read` kapsamı ister (403 = kapsam yok).
 */
export const EMLAKFIYATI_ALLOWED_PATHS = [
  "/api/endeks",
  "/api/ara",
  "/api/grafik/seri",
  "/api/grafik/iller",
  "/api/grafik/genel",
  "/api/dashboard",
  "/api/rayic",
  "/api/resmi-duyurular",
  "/api/parsel/mahalle",
  "/api/parsel",
  "/api/parsel/ornekler",
  "/api/parsel/kademe",
  "/api/konut-kapsama",
  "/api/disa-aktar",
  "/api/ilanlar",
] as const;
export type EmlakFiyatiGetPath = (typeof EMLAKFIYATI_ALLOWED_PATHS)[number];

export type EmlakFiyatiQuery = Readonly<Record<string, string | number | boolean>>;

/** Giden isteklerin başlık beyaz listesi (küçük harf). */
export const EMLAKFIYATI_ALLOWED_HEADERS = [
  "authorization",
  "accept",
  "cache-control",
  "x-ortak-kullanici-ref",
  "idempotency-key",
] as const;

// ---------------------------------------------------------------------------
// Anahtar biçimi
// ---------------------------------------------------------------------------

/** Önek + 16-128 yazdırılabilir ASCII (boşluksuz). Gerçek anahtarın tam biçimi doğrulanmadı: yalnız önek biliniyor. */
const KEY_RE = new RegExp(`^${EMLAKFIYATI_KEY_PREFIX}[\\x21-\\x7E]{16,128}$`);

export function isValidEmlakFiyatiKeyFormat(value: string): boolean {
  return KEY_RE.test(value);
}

/** Maskeli gösterim: önek + son 4. Tam anahtar ASLA üretilmez. */
export function maskEmlakFiyatiKey(value: string | null | undefined): string | null {
  if (!value || value.length < EMLAKFIYATI_KEY_PREFIX.length + 8) return null;
  return `${EMLAKFIYATI_KEY_PREFIX}****...${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// İstek beyaz listesi (kişisel veri çıkışını kilitler)
// ---------------------------------------------------------------------------

const QUERY_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const EMAIL_LIKE_RE = /@/;
const LONG_DIGITS_RE = /\d{11,}/; // TC kimlik / telefon benzeri; ada-parsel/koordinat bunun altında kalır

export class EmlakFiyatiPolicyError extends Error {
  constructor(readonly reason: "path" | "query" | "header" | "pii") {
    super("EmlakFiyati istek politikası ihlali.");
    this.name = "EmlakFiyatiPolicyError";
  }
}

export function isAllowedPath(path: string): path is EmlakFiyatiGetPath {
  return (EMLAKFIYATI_ALLOWED_PATHS as readonly string[]).includes(path);
}

/** Sorguyu doğrular; anahtar sırasıyla normalize edilmiş (önbellek anahtarı için kararlı) `URLSearchParams` döner. */
export function validateQuery(query: EmlakFiyatiQuery | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!query) return params;
  for (const name of Object.keys(query).sort()) {
    if (!QUERY_KEY_RE.test(name)) throw new EmlakFiyatiPolicyError("query");
    const raw = query[name];
    if (typeof raw === "number" && !Number.isFinite(raw)) throw new EmlakFiyatiPolicyError("query");
    const value = String(raw);
    if (value.length > 200) throw new EmlakFiyatiPolicyError("query");
    if (EMAIL_LIKE_RE.test(value) || LONG_DIGITS_RE.test(value.replace(/[\s.\-+()]/g, ""))) {
      throw new EmlakFiyatiPolicyError("pii");
    }
    params.set(name, value);
  }
  return params;
}

/** Adaptörden çıkan HER istek buradan geçer: https + tek origin + yol listesi + başlık listesi. */
export function assertAllowedOutbound(url: string, headers: Record<string, string>): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EmlakFiyatiPolicyError("path");
  }
  if (parsed.origin !== EMLAKFIYATI_BASE_URL || parsed.username || parsed.password || parsed.hash) {
    throw new EmlakFiyatiPolicyError("path");
  }
  if (!isAllowedPath(parsed.pathname)) throw new EmlakFiyatiPolicyError("path");
  for (const name of Object.keys(headers)) {
    if (!(EMLAKFIYATI_ALLOWED_HEADERS as readonly string[]).includes(name.toLowerCase())) {
      throw new EmlakFiyatiPolicyError("header");
    }
  }
}

// ---------------------------------------------------------------------------
// Hata sınıfı + geri çekilme
// ---------------------------------------------------------------------------

export type EmlakFiyatiErrorKind =
  | "disabled" // anahtar yok / politika
  | "auth" // 401: anahtar geçersiz/iptal
  | "forbidden" // 403: kapsam yok
  | "not_found" // 404
  | "rate_limited" // 429
  | "server" // 5xx
  | "network" // ağ/zaman aşımı
  | "invalid_response";

export function classifyStatus(status: number): EmlakFiyatiErrorKind | "ok" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "invalid_response";
}

/** Üstel geri çekilme + jitter: min(cap, base*2^attempt) * (0.5 + random*0.5). attempt 0'dan başlar. */
export function backoffDelayMs(attempt: number, random: () => number, baseMs = 500, capMs = 8_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp * (0.5 + Math.min(1, Math.max(0, random())) * 0.5));
}

/** 429 sonrası ardışık sayaca göre genel soğuma (Retry-After yok): 5 sn, 10, 20 ... en çok 5 dk (jitter'lı). */
export function cooldownMs(consecutive: number, random: () => number): number {
  return backoffDelayMs(Math.max(0, consecutive - 1), random, 5_000, 5 * 60_000);
}

// ---------------------------------------------------------------------------
// Ortak uçlar (ÇALIŞMIYOR: uçlar henüz yok) — başlık yardımcıları
// ---------------------------------------------------------------------------

const ORTAK_REF_RE = /^[A-Za-z0-9_.:-]{8,64}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `X-Ortak-Kullanici-Ref` biçimi: 8-64 karakter, [A-Za-z0-9_.:-]. Takma olup olmadığını DENETLEMEZ (bkz. makeOrtakUserRef). */
export function isValidOrtakUserRef(value: string): boolean {
  return ORTAK_REF_RE.test(value) && !/^\d+$/.test(value);
}

/** Ham girdi yalnız Emlaksoft'un iç kullanıcı UUID'si olabilir (e-posta/telefon/TC/ad REDDEDİLİR). */
export function isAcceptableOrtakRefInput(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Her istek için tekil `Idempotency-Key` (rastgele; tekrar denemede AYNI değeri çağıran yeniden kullanır). */
export function makeIdempotencyKey(): string {
  return `idem_${globalThis.crypto.randomUUID()}`;
}

export type OrtakHeaders = { userRef: string; idempotencyKey: string };

export function buildEmlakFiyatiHeaders(apiKey: string, ortak?: OrtakHeaders): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Cache-Control": "no-store",
  };
  if (ortak) {
    if (!isValidOrtakUserRef(ortak.userRef)) throw new EmlakFiyatiPolicyError("header");
    if (!IDEMPOTENCY_RE.test(ortak.idempotencyKey)) throw new EmlakFiyatiPolicyError("header");
    headers["X-Ortak-Kullanici-Ref"] = ortak.userRef;
    headers["Idempotency-Key"] = ortak.idempotencyKey;
  }
  return headers;
}
