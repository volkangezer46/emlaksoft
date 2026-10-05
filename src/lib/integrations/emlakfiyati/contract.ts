/**
 * EmlakFiyati endeks sözleşmesi — SAF (sunucu/istemci ortak, yan etkisiz, ağ yok).
 *
 * Gerçek API (kullanıcı onaylı, canlı yoklanmıştır):
 *   GET https://emlakfiyati.com/api/endeks?path=<il>/<ilce>[/<mahalle>]&tip=<tip>
 *   Authorization: Bearer <EMLAKFIYATI_API_KEY>
 * Yanıt: JSON DİZİ — aylık seri, en yeni dönem ilk. Eşleşme yoksa 200 + boş dizi döner.
 *
 * Kurallar:
 *  - İstek yalnız coğrafi yol ve tip taşır; kişisel veri (müşteri/ilan bilgisi) ASLA gitmez.
 *  - Yanıt zod ile doğrulanır: null'lar tolere edilir, ek alanlar yok sayılır, bozuk satır atlanır.
 *  - Canlı yoklamada geçerli `tip` değerleri yalnız `konut` ve `arsa` çıktı (daire/villa/isyeri/tarla/... boş dizi döner);
 *    bu yüzden ilan türü -> tip eşlemesi bilinçli olarak dardır ve desteklenmeyen tür için "veri yok" üretir.
 *  - Sahte skor/uydurma değer yok: güven ve ağırlık yalnız API'nin `guven`, `n`, `yetersiz_orneklem` alanından türer.
 */
import { z } from "zod";
import { geoKey, geoSlug } from "@/lib/geo/normalize";
import { foldTr } from "@/lib/tr-text";

export const EMLAKFIYATI_SOURCE_NAME = "EmlakFiyati endeksi";
export const EMLAKFIYATI_HOST = "emlakfiyati.com";
export const EMLAKFIYATI_ENDPOINT = `https://${EMLAKFIYATI_HOST}/api/endeks`;

/** Canlı yoklamayla doğrulanmış tip değerleri. */
export const EMLAKFIYATI_TIPS = ["konut", "arsa"] as const;
export type EmlakFiyatiTip = (typeof EMLAKFIYATI_TIPS)[number];

export const EMLAKFIYATI_TIP_LABEL: Record<EmlakFiyatiTip, string> = {
  konut: "Konut",
  arsa: "Arsa",
};

// ---------------------------------------------------------------------------
// İstek
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

/** Gönderilebilecek TEK şey: coğrafi yol + tip (beyaz liste; fazla alan reddedilir). */
export const endeksRequestSchema = z
  .object({
    path: z.string().max(160).regex(PATH_RE),
    tip: z.enum(EMLAKFIYATI_TIPS),
  })
  .strict();

export type EndeksRequest = z.infer<typeof endeksRequestSchema>;

/** Yol seviyesi: 1 il, 2 ilçe, 3 mahalle. */
export function pathLevel(path: string): 1 | 2 | 3 {
  const n = path.split("/").length;
  return n >= 3 ? 3 : n === 2 ? 2 : 1;
}

/** Üst yol: mahalle -> ilçe -> il -> null. */
export function parentPath(path: string): string | null {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : null;
}

/**
 * İl/ilçe/mahalle adlarından ASCII slug yolu üretir (src/lib/geo normalizasyonu).
 * İl yoksa ya da bir slug geçersizse null — çağıran "veri yok" der. İlçe yokken mahalle yok sayılır.
 */
export function buildEndeksPath(input: {
  province?: string | null;
  district?: string | null;
  neighborhood?: string | null;
}): string | null {
  const province = geoSlug(geoKey(input.province, "province"));
  if (!SLUG_RE.test(province)) return null;
  const parts = [province];
  const district = geoSlug(geoKey(input.district, "district"));
  if (SLUG_RE.test(district)) {
    parts.push(district);
    const neighborhood = geoSlug(geoKey(input.neighborhood, "neighborhood"));
    if (SLUG_RE.test(neighborhood)) parts.push(neighborhood);
  }
  return parts.join("/");
}

/** Doğrulanmış tam istek adresi (yalnız https + tek host + path/tip sorgusu). */
export function buildEndeksUrl(request: EndeksRequest): string {
  const safe = endeksRequestSchema.parse(request);
  const url = new URL(EMLAKFIYATI_ENDPOINT);
  url.searchParams.set("path", safe.path);
  url.searchParams.set("tip", safe.tip);
  return url.toString();
}

// ---------------------------------------------------------------------------
// İlan türü -> EmlakFiyati tipi
// ---------------------------------------------------------------------------

const KONUT_TYPES = new Set([
  "daire",
  "villa",
  "mustakil ev",
  "mustakil",
  "rezidans",
  "residence",
  "yazlik",
  "dubleks",
  "konut",
]);
const ARSA_TYPES = new Set(["arsa"]);

/**
 * Tanımlardaki portföy türünü (property_type) EmlakFiyati tipine çevirir.
 * Desteklenmeyen tür (işyeri, dükkan, ofis, depo, bina, tarla...) için null -> "veri yok".
 * Kiralık ilanlar için endeks anlamsızdır (seri satış m² fiyatıdır): null.
 */
export function mapPropertyTypeToTip(
  propertyType: string | null | undefined,
  transactionType?: string | null,
): EmlakFiyatiTip | null {
  if (transactionType && isRentTransaction(transactionType)) return null;
  const key = foldTr(propertyType).replace(/\s+/g, " ").trim();
  if (!key) return null;
  if (KONUT_TYPES.has(key)) return "konut";
  if (ARSA_TYPES.has(key)) return "arsa";
  return null;
}

export function isRentTransaction(value: string | null | undefined): boolean {
  const key = foldTr(value);
  return key === "rent" || key === "kiralik" || key === "kira";
}

// ---------------------------------------------------------------------------
// Yanıt
// ---------------------------------------------------------------------------

const num = z.number().finite();
const nullableNum = num.nullish().transform((v) => v ?? null);

export const endeksRowSchema = z.object({
  path: z.string().max(200),
  ad: z.string().max(200),
  level: z.number().int().min(1).max(3),
  tip: z.string().max(40),
  donem: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  n: z.number().int().min(0),
  medyan_tl_m2: num.positive(),
  p25: nullableNum,
  p75: nullableNum,
  ort_m2: nullableNum,
  medyan_fiyat: nullableNum,
  aylik_degisim: nullableNum,
  yillik_degisim: nullableNum,
  kalibre_tl_m2: nullableNum,
  // Bilinmeyen güven değeri "low" sayılır (iyimser varsayım yok).
  guven: z.enum(["low", "medium", "high"]).catch("low"),
  yetersiz_orneklem: z.boolean().catch(false),
});

export type EndeksRow = z.infer<typeof endeksRowSchema>;

export type EndeksParseResult =
  | { ok: true; rows: EndeksRow[] }
  | { ok: false };

/**
 * Ham yanıtı doğrular. Dizi değilse ya da (boş değilken) hiçbir satır geçerli değilse ok:false.
 * Boş dizi geçerlidir (= bu yol/tip için veri yok). Satırlar en yeni dönem ilk sıralanır.
 */
export function parseEndeksResponse(raw: unknown): EndeksParseResult {
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.length > 600) return { ok: false };
  const rows: EndeksRow[] = [];
  for (const item of raw) {
    const parsed = endeksRowSchema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
  }
  if (raw.length > 0 && rows.length === 0) return { ok: false };
  rows.sort((a, b) => (a.donem < b.donem ? 1 : a.donem > b.donem ? -1 : 0));
  return { ok: true, rows };
}

// ---------------------------------------------------------------------------
// Özet (UI + değerleme ortak)
// ---------------------------------------------------------------------------

export type EndeksGuven = "low" | "medium" | "high";

export type EndeksTrendPoint = { donem: string; medianM2: number; n: number };

export type EndeksSummary = {
  path: string;
  ad: string;
  level: 1 | 2 | 3;
  tip: EmlakFiyatiTip;
  /** En yeni dönem (YYYY-MM-DD, ayın 1'i). */
  donem: string;
  n: number;
  /** Değerlemede kullanılan m² fiyatı: kalibre varsa o, yoksa medyan. */
  medianM2: number;
  p25: number | null;
  p75: number | null;
  medianPrice: number | null;
  monthlyChange: number | null;
  yearlyChange: number | null;
  guven: EndeksGuven;
  insufficient: boolean;
  /** Eskiden yeniye, en çok son 12 dönem. */
  trend: EndeksTrendPoint[];
};

export const EMLAKFIYATI_TREND_MONTHS = 12;

export const EMLAKFIYATI_LEVEL_LABEL: Record<1 | 2 | 3, string> = {
  1: "İl",
  2: "İlçe",
  3: "Mahalle",
};

export const EMLAKFIYATI_GUVEN_LABEL: Record<EndeksGuven, string> = {
  low: "düşük",
  medium: "orta",
  high: "yüksek",
};

/** Satırlardan (en yeni ilk) özet çıkarır; satır yoksa null. */
export function summarizeEndeks(rows: readonly EndeksRow[], tip: EmlakFiyatiTip): EndeksSummary | null {
  const latest = rows[0];
  if (!latest) return null;
  const trend = rows
    .slice(0, EMLAKFIYATI_TREND_MONTHS)
    .map((r) => ({ donem: r.donem, medianM2: r.kalibre_tl_m2 ?? r.medyan_tl_m2, n: r.n }))
    .reverse();
  return {
    path: latest.path,
    ad: latest.ad,
    level: latest.level as 1 | 2 | 3,
    tip,
    donem: latest.donem,
    n: latest.n,
    medianM2: latest.kalibre_tl_m2 ?? latest.medyan_tl_m2,
    p25: latest.p25,
    p75: latest.p75,
    medianPrice: latest.medyan_fiyat,
    monthlyChange: latest.aylik_degisim,
    yearlyChange: latest.yillik_degisim,
    guven: latest.guven,
    insufficient: latest.yetersiz_orneklem,
    trend,
  };
}

/** "2026-10-01" -> "Ekim 2026" (saf, tarih nesnesi yok). */
export function formatDonem(donem: string): string {
  const [y, m] = donem.split("-");
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const name = months[Number(m) - 1];
  return name && y ? `${name} ${y}` : donem;
}

// ---------------------------------------------------------------------------
// Değerleme kaynağı
// ---------------------------------------------------------------------------

/** Yetersiz örneklemde ağırlık bu değeri aşmaz. */
export const EMLAKFIYATI_INSUFFICIENT_WEIGHT = 0.08;

/** Ağırlık yalnız API'nin güven/örneklem alanından türer; ofis emsal motoru (0,15-0,5) yine öne çıkar. */
export function endeksWeight(summary: Pick<EndeksSummary, "guven" | "insufficient">): number {
  if (summary.insufficient) return EMLAKFIYATI_INSUFFICIENT_WEIGHT;
  return summary.guven === "high" ? 0.4 : summary.guven === "medium" ? 0.3 : 0.15;
}

/** Kanıt skoru için kademe: yetersiz örneklem kanıt sayılmaz. */
export function endeksEvidenceLevel(
  summary: Pick<EndeksSummary, "guven" | "insufficient"> | null,
): "none" | EndeksGuven {
  if (!summary || summary.insufficient) return "none";
  return summary.guven;
}

export type EndeksValuationSource = {
  name: string;
  weight: number;
  value: number;
  note: string;
};

/** Endeks özetini mevcut ValuationSource biçimine eşler: değer = medyan TL/m² x m². */
export function toEndeksValuationSource(summary: EndeksSummary, sqm: number): EndeksValuationSource | null {
  if (!Number.isFinite(sqm) || sqm <= 0) return null;
  const value = Math.round(summary.medianM2 * sqm);
  if (!Number.isFinite(value) || value <= 0) return null;
  const parts = [
    `${summary.ad} ${EMLAKFIYATI_LEVEL_LABEL[summary.level].toLocaleLowerCase("tr-TR")} · ${EMLAKFIYATI_TIP_LABEL[summary.tip].toLocaleLowerCase("tr-TR")} medyan ${Math.round(summary.medianM2).toLocaleString("tr-TR")} ₺/m²`,
    `${formatDonem(summary.donem)} dönemi`,
    `${summary.n} ilan · güven: ${EMLAKFIYATI_GUVEN_LABEL[summary.guven]}`,
  ];
  if (summary.insufficient) parts.push("örneklem yetersiz, ağırlık düşük");
  if (summary.yearlyChange != null) parts.push(`yıllık değişim %${summary.yearlyChange}`);
  else if (summary.monthlyChange != null) parts.push(`aylık değişim %${summary.monthlyChange}`);
  return { name: EMLAKFIYATI_SOURCE_NAME, weight: endeksWeight(summary), value, note: parts.join(" · ") };
}
