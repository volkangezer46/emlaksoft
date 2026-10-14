import { DAY_MS } from "@/lib/clock";

/**
 * ÜRÜN GERİ BİLDİRİMİ — saf kurallar (DG8): özellik istek panosu durumları/görünürlüğü ve NPS sıklık sınırı + puanı.
 * Depo `./store.ts` (yalnız sunucu), eylemler `app/actions/product-feedback.ts` (ofis) ve `platform-feedback.ts` (admin).
 */

// ---------------------------------------------------------------------------
// Özellik istek panosu
// ---------------------------------------------------------------------------

export const REQUEST_STATUSES = ["yeni", "degerlendiriliyor", "planlandi", "yapiliyor", "yayinda", "reddedildi"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  yeni: "İnceleniyor",
  degerlendiriliyor: "Oylamada",
  planlandi: "Planlandı",
  yapiliyor: "Yapılıyor",
  yayinda: "Yayında",
  reddedildi: "Şimdilik planda yok",
};

/** Tüm ofislerin gördüğü durumlar; "yeni" ve "reddedildi" yalnız öneren ofise görünür (moderasyon). */
export const PUBLIC_REQUEST_STATUSES: readonly RequestStatus[] = ["degerlendiriliyor", "planlandi", "yapiliyor", "yayinda"];
/** Oy verilebilen durumlar (yayındaki ya da kapanmış öneriye oy anlamsız). */
export const VOTABLE_REQUEST_STATUSES: readonly RequestStatus[] = ["yeni", "degerlendiriliyor", "planlandi", "yapiliyor"];

export function isRequestStatus(v: unknown): v is RequestStatus {
  return typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);
}

/** Öneri bu ofise görünür mü: herkese açık durumdaysa ya da ofisin kendi önerisiyse. */
export function requestVisibleTo(row: { status: string; tenant_id: string }, tenantId: string): boolean {
  return (PUBLIC_REQUEST_STATUSES as readonly string[]).includes(row.status) || row.tenant_id === tenantId;
}

/** Ofis bu öneriye oy verebilir/geri alabilir mi (görünür + oylanabilir durumda). */
export function canVoteOn(row: { status: string; tenant_id: string }, tenantId: string): boolean {
  return requestVisibleTo(row, tenantId) && (VOTABLE_REQUEST_STATUSES as readonly string[]).includes(row.status);
}

export function validateRequestInput(title: string, body: string): string | null {
  const t = title.trim();
  if (t.length < 5) return "Başlık en az 5 karakter olmalı.";
  if (t.length > 120) return "Başlık en fazla 120 karakter olabilir.";
  if (body.trim().length > 2000) return "Açıklama en fazla 2000 karakter olabilir.";
  return null;
}

// ---------------------------------------------------------------------------
// NPS
// ---------------------------------------------------------------------------

export const NPS_DEFAULT_QUESTION = "EmlakSoft'u bir meslektaşınıza tavsiye etme olasılığınız nedir?";

/**
 * Sıklık sınırı: kullanıcıya son gösterimden bu yana en az `intervalDays` gün geçtiyse yeniden sorulabilir.
 * Gösterim = anketin ekrana gelmesi (yanıtlasa da kapatsa da sayılır). Aynı kural DB'de `platform_nps_mark_shown`
 * içinde kullanıcı kilidiyle tekrar uygulanır (iki sekme aynı anda iki gösterim yazamaz).
 */
export function npsEligible(lastShownAt: string | null | undefined, nowMs: number, intervalDays: number): boolean {
  if (!lastShownAt) return true;
  const last = new Date(lastShownAt).getTime();
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= Math.max(1, intervalDays) * DAY_MS;
}

/** Gösterilmiş ama yanıtlanmamış/kapatılmamış anket bu süre boyunca AYNI anket olarak açık kalır (yeni soru sayılmaz). */
export const NPS_PENDING_MS = 24 * 3_600_000;

export type NpsShownRow = { survey_id: string; shown_at: string; score: number | null; dismissed_at: string | null };

/**
 * Bekleyen gösterim: son gösterim yanıtsız, kapatılmamış ve 24 saatten yeni. Sayfa yenilense ya da kabuk tazelense
 * de kullanıcı yarım kalan anketi görmeye devam eder; sıklık sınırına yeni gösterim yazılmaz.
 */
export function npsPending(row: NpsShownRow | null | undefined, nowMs: number): boolean {
  if (!row || row.score !== null || row.dismissed_at) return false;
  const shown = new Date(row.shown_at).getTime();
  return Number.isFinite(shown) && nowMs - shown < NPS_PENDING_MS;
}

export type NpsCategory = "promoter" | "passive" | "detractor";

export function npsCategory(score: number): NpsCategory {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export const NPS_CATEGORY_LABEL: Record<NpsCategory, string> = { promoter: "Destekçi (9-10)", passive: "Pasif (7-8)", detractor: "Eleştiren (0-6)" };

export type NpsSummary = { responses: number; promoters: number; passives: number; detractors: number; nps: number | null; distribution: number[] };

/** NPS = destekçi % − eleştiren % (−100..100, tam sayıya yuvarlı). Yanıt yoksa null (sahte skor yok). */
export function summarizeNps(scores: readonly number[]): NpsSummary {
  const distribution = Array.from({ length: 11 }, () => 0);
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of scores) {
    if (!Number.isInteger(s) || s < 0 || s > 10) continue;
    distribution[s]! += 1;
    const c = npsCategory(s);
    if (c === "promoter") promoters++;
    else if (c === "passive") passives++;
    else detractors++;
  }
  const responses = promoters + passives + detractors;
  const nps = responses ? Math.round(((promoters - detractors) / responses) * 100) : null;
  return { responses, promoters, passives, detractors, nps, distribution };
}
