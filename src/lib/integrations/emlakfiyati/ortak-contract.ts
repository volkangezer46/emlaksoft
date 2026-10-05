/**
 * EmlakFiyati ORTAK API v1 — SAF sözleşme (ağ yok, sunucu/istemci güvenli; docs/integrations/EMLAKFIYATI_ORTAK_API_V1.md).
 * Girdi doğrulama, TOLERANSLI yanıt ayrıştırma (bilinmeyen alan yok sayılır), K10 sunumu, hata sınıfı ve geri çekilme.
 * Burada OLMAYAN her şey "doğrulanmadı"dır: iç yapı (tahmin, fiyat_yayin, emsaller) motor çıktısıdır ve genel gezilir.
 */
import { z } from "zod";

/** Değerleme/PDF için istemci zaman aşımı: sözleşme "en az 90 sn" der. */
export const EMLAKFIYATI_ORTAK_TIMEOUT_MS = 95_000;
export const EMLAKFIYATI_ORTAK_BODY_MAX_BYTES = 64 * 1024;
export const EMLAKFIYATI_ORTAK_PDF_MAX_BYTES = 15 * 1024 * 1024;
export const EMLAKFIYATI_ORTAK_JSON_MAX_BYTES = 512 * 1024;
export const EMLAKFIYATI_ORTAK_MAX_VALUATION_CONCURRENCY = 4;
export const EMLAKFIYATI_ORTAK_MAX_PDF_CONCURRENCY = 2;

// ---------------------------------------------------------------------------
// Girdi
// ---------------------------------------------------------------------------

const LONG_DIGITS_RE = /\d{11,}/;
const PHONE_LIKE_RE = /(?:^|\D)0?5\d{9}(?:\D|$)/;

/** Serbest metinde kişisel veri riski: `@`, 11+ rakam (TC/telefon) ve 05XXXXXXXXX benzeri örüntü. */
export function freeTextHasPersonalData(value: string): boolean {
  if (/@/.test(value)) return true;
  const compact = value.replace(/[\s.\-+()]/g, "");
  return LONG_DIGITS_RE.test(compact) || PHONE_LIKE_RE.test(compact);
}

export const ORTAK_FREE_TEXT_WARNING =
  "Bu alana ad, telefon, e-posta, TC kimlik numarası veya adres yazmayın; yalnızca site/apartman/blok adı girin.";

const freeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !freeTextHasPersonalData(v), { message: ORTAK_FREE_TEXT_WARNING });

const optionalCount = (min: number, max: number) => z.number().int().min(min).max(max).optional();

export const ortakKonutOzellikleriSchema = z
  .object({
    konutTipi: z.enum(["daire", "mustakil", "bina"]).default("daire"),
    /** Konutta ALAN bilgisi şarttır. */
    konutM2: z.number().positive().max(100_000),
    odaSayi: optionalCount(0, 50),
    binaYasi: optionalCount(0, 300),
    kat: z.number().int().min(-5).max(200).optional(),
    katToplam: optionalCount(1, 200),
    /** Üç durumlu: bilinmiyorsa undefined (gövdeye HİÇ konmaz). */
    site: z.boolean().optional(),
    asansor: z.boolean().optional(),
    otopark: z.boolean().optional(),
    siteAdi: freeText(100).optional(),
    apartmanAdi: freeText(100).optional(),
    blok: freeText(40).optional(),
    acikHavuz: z.boolean().optional(),
    kapaliHavuz: z.boolean().optional(),
    guvenlik: z.boolean().optional(),
    sporAlani: z.boolean().optional(),
    akilliEv: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kat !== undefined && v.katToplam !== undefined && v.kat > v.katToplam) {
      ctx.addIssue({ code: "custom", path: ["kat"], message: "Bulunduğu kat, toplam kat sayısından büyük olamaz." });
    }
  });
export type OrtakKonutOzellikleri = z.infer<typeof ortakKonutOzellikleriSchema>;

export const ortakValuationInputSchema = z
  .object({
    mahalleId: z.number().int().positive(),
    ada: z.string().trim().regex(/^\d{1,12}$/, "Ada yalnızca rakam olmalı (1-12 hane)."),
    parsel: z.string().trim().regex(/^[0-9/-]{1,20}$/, "Parsel rakam, / ve - içerebilir (en çok 20 karakter)."),
    tip: z.enum(["arsa", "konut"]).default("arsa"),
    konut: ortakKonutOzellikleriSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tip === "konut" && !v.konut) {
      ctx.addIssue({ code: "custom", path: ["konut"], message: "Konut değerlemesi için alan (m²) bilgisi zorunludur." });
    }
  });
export type OrtakValuationInput = z.input<typeof ortakValuationInputSchema>;
export type OrtakValuationParsed = z.output<typeof ortakValuationInputSchema>;

/** Doğrulanmış girdiden istek gövdesi (snake_case). Bilinmeyen boolean'lar HİÇ gönderilmez. Gövde 64 KB üstüyse null. */
export function buildOrtakValuationBody(input: OrtakValuationParsed): string | null {
  const body: Record<string, unknown> = { mahalle_id: input.mahalleId, ada: input.ada, parsel: input.parsel, tip: input.tip };
  if (input.tip === "konut" && input.konut) {
    const k = input.konut;
    const o: Record<string, unknown> = { konut_tipi: k.konutTipi, konut_m2: k.konutM2 };
    const put = (key: string, v: unknown) => {
      if (v !== undefined && v !== "") o[key] = v;
    };
    put("oda_sayi", k.odaSayi);
    put("bina_yasi", k.binaYasi);
    put("kat", k.kat);
    put("kat_toplam", k.katToplam);
    put("site", k.site);
    put("asansor", k.asansor);
    put("otopark", k.otopark);
    put("site_adi", k.siteAdi);
    put("apartman_adi", k.apartmanAdi);
    put("blok", k.blok);
    // Yalnız "true" olanlar gönderilir.
    if (k.acikHavuz === true) o.acik_havuz = true;
    if (k.kapaliHavuz === true) o.kapali_havuz = true;
    if (k.guvenlik === true) o.guvenlik = true;
    if (k.sporAlani === true) o.spor_alani = true;
    if (k.akilliEv === true) o.akilli_ev = true;
    body.konut_ozellikleri = o;
  }
  const text = JSON.stringify(body);
  return new TextEncoder().encode(text).byteLength > EMLAKFIYATI_ORTAK_BODY_MAX_BYTES ? null : text;
}

const REPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isOrtakReportId(value: string): boolean {
  return REPORT_ID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Hata sınıfı + geri çekilme
// ---------------------------------------------------------------------------

export type OrtakErrorKind =
  | "disabled" // bayrak/yoklama/anahtar yok
  | "auth" // 401: alarm, yeniden deneme YOK
  | "bad_request" // 400
  | "forbidden" // 403 (kod: kapsam_yok | ortak_bagi_yok | ortak_pasif ...)
  | "not_found" // 404 rapor_yok
  | "busy" // 409 istek_isleniyor (tükendi)
  | "too_large" // 413
  | "invalid_input" // 422
  | "rate_limited" // 429
  | "unavailable" // 503
  | "pdf_failed" // 502 pdf_uretilemedi
  | "server" // diğer 5xx
  | "network" // ağ
  | "timeout" // istemci zaman aşımı
  | "invalid_response"
  | "too_many_local"; // yerel eşzamanlılık sınırı

export function classifyOrtakStatus(status: number, code: string | null): OrtakErrorKind {
  if (status === 400) return "bad_request";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return code === "istek_isleniyor" || code === null ? "busy" : "invalid_input";
  if (status === 413) return "too_large";
  if (status === 422) return "invalid_input";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  if (status === 502 && code === "pdf_uretilemedi") return "pdf_failed";
  if (status >= 500) return "server";
  return "invalid_response";
}

/** Hata gövdesinden makine kodu: önce `kod`, yoksa `error.code`. Yalnız güvenli biçim döner (metin ASLA taşınmaz). */
export function extractOrtakErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { kod?: unknown; error?: { code?: unknown } | null };
  const raw = typeof b.kod === "string" ? b.kod : typeof b.error?.code === "string" ? b.error.code : null;
  return raw && /^[a-z0-9_]{1,64}$/.test(raw) ? raw : null;
}

export function parseRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,5}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

export function sanitizeRequestId(value: string | null | undefined): string | null {
  return value && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;
}

const RETRY_CAP_MS = 60_000;
const PDF_RETRY_DELAYS_MS = [10_000, 30_000] as const;
const SERVER_RETRY_DELAYS_MS = [10_000, 30_000] as const;
const NETWORK_RETRY_DELAYS_MS = [2_000, 5_000] as const;
const BUSY_DELAY_MS = 2_000;
const BUSY_MAX_RETRIES = 5;
const RATE_MAX_RETRIES = 2;

/** 429/503: Retry-After VARSA ona uyar (en çok 60 sn); yoksa 5 sn'den ikiye katlar (en çok 60 sn) + 0-1 sn jitter. */
export function rateBackoffMs(retryIndex: number, retryAfterSec: number | null, random: () => number): number {
  const jitter = Math.round(Math.min(1, Math.max(0, random())) * 1000);
  if (retryAfterSec !== null) return Math.min(retryAfterSec * 1000, RETRY_CAP_MS) + jitter;
  return Math.min(5_000 * 2 ** Math.max(0, retryIndex), RETRY_CAP_MS) + jitter;
}

export type OrtakRetryInput = {
  kind: OrtakErrorKind;
  /** Bu hata için daha önce yapılan yeniden deneme sayısı (0 = ilk hata). */
  retryIndex: number;
  retryAfterSec: number | null;
  random: () => number;
};

/** Beklenecek ms; null = yeniden deneme YOK. 401/403/404/422/413/400 asla denenmez. */
export function ortakRetryDelayMs(i: OrtakRetryInput): number | null {
  switch (i.kind) {
    case "busy":
      return i.retryIndex < BUSY_MAX_RETRIES ? BUSY_DELAY_MS : null;
    case "rate_limited":
    case "unavailable":
      return i.retryIndex < RATE_MAX_RETRIES ? rateBackoffMs(i.retryIndex, i.retryAfterSec, i.random) : null;
    case "pdf_failed":
      return i.retryIndex < PDF_RETRY_DELAYS_MS.length ? PDF_RETRY_DELAYS_MS[i.retryIndex]! : null;
    case "server":
      return i.retryIndex < SERVER_RETRY_DELAYS_MS.length ? SERVER_RETRY_DELAYS_MS[i.retryIndex]! : null;
    case "network":
      return i.retryIndex < NETWORK_RETRY_DELAYS_MS.length ? NETWORK_RETRY_DELAYS_MS[i.retryIndex]! : null;
    case "timeout":
      return i.retryIndex < 1 ? NETWORK_RETRY_DELAYS_MS[0] : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Yanıt şemaları (TOLERANSLI)
// ---------------------------------------------------------------------------

const looseObject = z.record(z.string(), z.unknown());

export const ortakValuationResponseSchema = z
  .object({
    sonuc_durumu: z.enum(["deger", "yetersiz"]),
    ucretlendirilir: z.boolean().optional(),
    rapor_id: z.string().optional().nullable(),
    rapor_url: z.string().optional().nullable(),
    pdf_url: z.string().optional().nullable(),
    rapor_gecerlilik: z
      .object({ gun: z.number().nullable().optional(), expires_at: z.string().nullable().optional() })
      .passthrough()
      .nullish(),
    tip: z.string().nullish(),
    parsel: looseObject.nullish(),
    tahmin: z.unknown().optional(),
    fiyat_yayin: z.unknown().optional(),
    emsaller: z.unknown().optional(),
    konut_ozellikleri: z.unknown().optional(),
    harita: z.unknown().optional(),
    tespit: z.unknown().optional(),
    mesaj: z.string().nullish(),
    nedenler: z.array(z.string()).nullish(),
  })
  .passthrough();

/** Rapor detayında `sonuc_durumu` olmayabilir: yalnız rapor gövdesi aranır. */
export const ortakReportResponseSchema = ortakValuationResponseSchema.partial({ sonuc_durumu: true });

export const ortakUsageResponseSchema = z
  .object({
    ortak: z.object({ kod: z.string().nullish(), ad: z.string().nullish() }).passthrough().nullish(),
    tarife: z
      .object({ sorgu_tl: z.number().nullish(), pdf_tl: z.number().nullish(), surum: z.string().nullish() })
      .passthrough()
      .nullish(),
    sinirlar: z
      .object({
        istek_dakika: z.number().nullish(),
        pdf_dakika: z.number().nullish(),
        esz_pdf: z.number().nullish(),
        esz_degerleme: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
    gun_sayisi: z.number().nullish(),
    toplam: looseObject.nullish(),
    gunluk: z.array(looseObject).nullish(),
  })
  .passthrough();

export type OrtakUsageSummary = {
  ortakAd: string | null;
  tarifeSurum: string | null;
  sinirlar: { istekDakika: number | null; pdfDakika: number | null; eszPdf: number | null; eszDegerleme: number | null };
  toplam: { degerleme: number | null; pdf: number | null; istek: number | null };
};

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function summarizeOrtakUsage(data: unknown): OrtakUsageSummary | null {
  const p = ortakUsageResponseSchema.safeParse(data);
  if (!p.success) return null;
  const d = p.data;
  return {
    ortakAd: d.ortak?.ad ?? null,
    tarifeSurum: d.tarife?.surum ?? null,
    sinirlar: {
      istekDakika: numOrNull(d.sinirlar?.istek_dakika),
      pdfDakika: numOrNull(d.sinirlar?.pdf_dakika),
      eszPdf: numOrNull(d.sinirlar?.esz_pdf),
      eszDegerleme: numOrNull(d.sinirlar?.esz_degerleme),
    },
    toplam: {
      degerleme: numOrNull(d.toplam?.degerleme),
      pdf: numOrNull(d.toplam?.pdf),
      istek: numOrNull(d.toplam?.istek),
    },
  };
}

// ---------------------------------------------------------------------------
// K10 normalizasyonu
// ---------------------------------------------------------------------------

export type OrtakValuationOk = {
  durum: "deger";
  /** true → kontörü KESİNLEŞTİR. */
  ucretlendirilir: boolean;
  raporId: string | null;
  expiresAt: string | null;
  gecerlilikGun: number | null;
  tip: "arsa" | "konut" | null;
  parsel: Record<string, unknown> | null;
  guvenSinifi: string | null;
  /** `fiyat_yayin.guven_sinifi == "dusuk"`: kesin TL ve birim fiyat YOK (null); yalnız `guvenSunumu` gösterilir. */
  dusukGuven: boolean;
  guvenSunumu: unknown;
  tahmin: unknown;
  fiyatYayin: unknown;
  emsaller: unknown;
  konutOzellikleri: unknown;
};
export type OrtakValuationInsufficient = {
  durum: "yetersiz";
  ucretlendirilir: false;
  mesaj: string | null;
  nedenler: string[];
};
export type OrtakValuationResult = OrtakValuationOk | OrtakValuationInsufficient;

const MONEY_KEY_RE = /(?:tl|fiyat|tutar|deger|bedel|birim|m2|ucret)/i;

/** Düşük güvende savunma: sunucu K10'u uygulamalı; yine de para benzeri sayısal yaprakları null'lar (guven_sunumu hariç). */
export function maskMoneyLeaves(node: unknown, depth = 0): unknown {
  if (depth > 6) return node;
  if (Array.isArray(node)) return node.map((n) => maskMoneyLeaves(n, depth + 1));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "guven_sunumu" || k === "guven_sinifi") out[k] = v;
      else if (typeof v === "number" && MONEY_KEY_RE.test(k)) out[k] = null;
      else out[k] = maskMoneyLeaves(v, depth + 1);
    }
    return out;
  }
  return node;
}

function guvenOf(fiyatYayin: unknown): { sinifi: string | null; sunumu: unknown } {
  if (!fiyatYayin || typeof fiyatYayin !== "object") return { sinifi: null, sunumu: null };
  const f = fiyatYayin as Record<string, unknown>;
  return { sinifi: typeof f.guven_sinifi === "string" ? f.guven_sinifi : null, sunumu: f.guven_sunumu ?? null };
}

export type OrtakParse = { ok: true; value: OrtakValuationResult } | { ok: false };

/** POST /degerleme (ve rapor detayı) yanıtı. `sonuc_durumu` yoksa (rapor detayı) "deger" varsayılır. */
export function parseOrtakValuation(data: unknown): OrtakParse {
  const p = ortakReportResponseSchema.safeParse(data);
  if (!p.success) return { ok: false };
  const d = p.data;
  if (d.sonuc_durumu === "yetersiz") {
    return {
      ok: true,
      value: { durum: "yetersiz", ucretlendirilir: false, mesaj: d.mesaj ?? null, nedenler: d.nedenler ?? [] },
    };
  }
  const g = guvenOf(d.fiyat_yayin);
  const dusuk = g.sinifi === "dusuk";
  const tip = d.tip === "arsa" || d.tip === "konut" ? d.tip : null;
  return {
    ok: true,
    value: {
      durum: "deger",
      ucretlendirilir: d.ucretlendirilir === true,
      raporId: d.rapor_id && isOrtakReportId(d.rapor_id) ? d.rapor_id : null,
      expiresAt: d.rapor_gecerlilik?.expires_at ?? null,
      gecerlilikGun: numOrNull(d.rapor_gecerlilik?.gun),
      tip,
      parsel: (d.parsel as Record<string, unknown> | null | undefined) ?? null,
      guvenSinifi: g.sinifi,
      dusukGuven: dusuk,
      guvenSunumu: g.sunumu,
      tahmin: dusuk ? maskMoneyLeaves(d.tahmin) : (d.tahmin ?? null),
      fiyatYayin: dusuk ? maskMoneyLeaves(d.fiyat_yayin) : (d.fiyat_yayin ?? null),
      emsaller: d.emsaller ?? null,
      konutOzellikleri: d.konut_ozellikleri ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Takma kullanıcı kimliği
// ---------------------------------------------------------------------------

/** `X-Ortak-Kullanici-Ref` son doğrulaması (8-64, [A-Za-z0-9_.:-], en az bir rakam, e-posta/telefon/TC/ad görünümü yok). */
export function isPseudonymousUserRef(value: string): boolean {
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(value) || !/\d/.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
}
