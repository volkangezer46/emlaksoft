/**
 * İlan analizi — SAF hesap (DB/ağ/saat YOK; sunucu/istemci güvenli).
 *
 * Girdi: mevcut emsal motoru çıktısı (`estimate_property_value`), varsa EmlakFiyati bölge endeksi, bölge ortalama yayında
 * kalma süresi ve ilan kalite girdileri. Çıktı: fiyat konumu (emsal medyanına göre %), m² fiyatı, hız notu, fiyat revizyon
 * önerisi ve ilan metni/fotoğraf kontrol listesi.
 *
 * DÜRÜSTLÜK KURALLARI (CLAUDE.md "Zeka katmanı"):
 *  - Emsal yoksa (güven "yetersiz", tahmin yok, liste fiyatı yok) sonuç `null`: kontör düşmez, hiçbir rakam uydurulmaz.
 *  - Fiyat revizyon önerisi YALNIZ emsal güveni orta/yüksek ve ilan piyasa üstündeyse verilir; "Tahmin" etiketlidir.
 *  - Eşikler `pricePosition` (comparables.ts) ile AYNI: ±%7 "piyasa seviyesi". Bu dosya server-only içe aktarmaz.
 */

/** Aynı ilan için sonuç önbelleği: bu süre içinde tekrar ücret alınmaz. */
export const ANALYSIS_CACHE_HOURS = 24;
export const ANALYSIS_CACHE_MS = ANALYSIS_CACHE_HOURS * 3_600_000;
/** comparables.ts `pricePosition` bandıyla aynı. */
export const MARKET_BAND_PCT = 7;
export const ANALYSIS_RESULT_VERSION = 1;

export type AnalysisConfidence = "yüksek" | "orta" | "düşük" | "yetersiz";

export type AnalysisEstimate = {
  estimatedValue: number | null;
  lowValue: number | null;
  highValue: number | null;
  medianSqmPrice: number | null;
  compCount: number;
  wonCount: number;
  activeCount: number;
  confidence: AnalysisConfidence;
};

export type AnalysisEfIndex = { ad: string; donem: string; n: number; medianM2: number; guven: string };

export type AnalysisPhoto = { photoCount: number; warned: number; passed: number; warnings: string[] } | null;

export type AnalysisInput = {
  listPrice: number | null;
  sqm: number | null;
  estimate: AnalysisEstimate;
  efIndex: AnalysisEfIndex | null;
  regionAvgDaysListed: number | null;
  daysOnMarket: number | null;
  isRent: boolean;
  quality: {
    title: string | null;
    description: string | null;
    /** rooms/sqm/floor/heating/building_age/facade değerleri (boş = eksik). */
    features: Record<string, unknown> | null;
    hasLocation: boolean;
    hasVirtualTour: boolean;
    photo: AnalysisPhoto;
  };
};

export type ChecklistStatus = "pass" | "warn" | "na";
export type ChecklistItem = { id: string; status: ChecklistStatus; title: string; detail: string };

export type ListingAnalysisResult = {
  version: typeof ANALYSIS_RESULT_VERSION;
  listPrice: number;
  sqm: number | null;
  /** İlanın ₺/m² değeri (m² yoksa null). */
  listSqmPrice: number | null;
  comps: { count: number; won: number; active: number; confidence: Exclude<AnalysisConfidence, "yetersiz">; estimatedValue: number; low: number | null; high: number | null; medianSqmPrice: number | null };
  position: { deviationPct: number; verdict: "piyasa üstü" | "piyasa seviyesinde" | "piyasa altı" };
  /** İlan ₺/m² değerinin emsal medyan ₺/m² değerine göre sapması (yüzde); veri yoksa null. */
  sqmGapPct: number | null;
  efIndex: (AnalysisEfIndex & { gapPct: number | null }) | null;
  market: { regionAvgDaysListed: number | null; daysOnMarket: number | null; note: string | null };
  /** Yalnız emsal güveni orta/yüksek ve piyasa üstüyse; TAHMİNDİR. */
  revision: { suggestedPrice: number; reducePct: number; ceilingPrice: number | null; label: "Tahmin"; note: string } | null;
  revisionNote: string | null;
  checklist: ChecklistItem[];
};

function pctGap(value: number, base: number): number {
  return Math.round(((value - base) / base) * 1000) / 10;
}

/** Önerilen fiyatı okunur basamağa yuvarlar (tahmini rakam kesinmiş gibi görünmesin). */
export function roundNicePrice(v: number, isRent: boolean): number {
  const step = isRent ? (v >= 50_000 ? 500 : v >= 10_000 ? 250 : 100) : v >= 5_000_000 ? 50_000 : v >= 1_000_000 ? 25_000 : v >= 200_000 ? 5_000 : 1_000;
  return Math.round(v / step) * step;
}

function trDays(n: number): string {
  return `${Math.round(n)} gün`;
}

function buildChecklist(q: AnalysisInput["quality"]): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  if (q.photo) {
    const p = q.photo;
    if (p.photoCount === 0) items.push({ id: "photos", status: "warn", title: "Fotoğraflar", detail: "İlanda fotoğraf yok; fotoğrafsız ilan neredeyse hiç ilgi görmez." });
    else if (p.warned > 0) items.push({ id: "photos", status: "warn", title: "Fotoğraflar", detail: `${p.photoCount} fotoğraf, ${p.warned} uyarı: ${p.warnings.slice(0, 2).join(" · ")}` });
    else items.push({ id: "photos", status: "pass", title: "Fotoğraflar", detail: `${p.photoCount} fotoğraf; ölçülebilen kalite kontrolleri geçti.` });
  } else {
    items.push({ id: "photos", status: "na", title: "Fotoğraflar", detail: "Fotoğraf kayıtları okunamadı; kontrol yapılamadı." });
  }

  const title = (q.title ?? "").trim();
  if (!title) items.push({ id: "title", status: "warn", title: "İlan başlığı", detail: "Başlık yok." });
  else if (title.length < 15) items.push({ id: "title", status: "warn", title: "İlan başlığı", detail: `Başlık kısa (${title.length} karakter); konum, oda ve m² ekleyin.` });
  else if (title.length > 60) items.push({ id: "title", status: "warn", title: "İlan başlığı", detail: `Başlık ${title.length} karakter; bazı portallarda 60 karakterden sonrası kesilir (tahmini sınır).` });
  else items.push({ id: "title", status: "pass", title: "İlan başlığı", detail: `${title.length} karakter; uygun uzunlukta.` });

  const desc = (q.description ?? "").trim();
  if (!desc) items.push({ id: "description", status: "warn", title: "İlan açıklaması", detail: "Açıklama yok; vitrin ve portal metni boş kalır." });
  else if (desc.length < 200) items.push({ id: "description", status: "warn", title: "İlan açıklaması", detail: `Açıklama kısa (${desc.length} karakter); en az ~200 karakter önerilir.` });
  else items.push({ id: "description", status: "pass", title: "İlan açıklaması", detail: `${desc.length} karakter.` });

  const f = q.features ?? {};
  const wanted: [string, string][] = [["rooms", "oda"], ["sqm", "m²"], ["floor", "kat"], ["heating", "ısınma"], ["building_age", "bina yaşı"], ["facade", "cephe"]];
  const missing = wanted.filter(([k]) => f[k] == null || String(f[k]).trim() === "").map(([, l]) => l);
  if (missing.length > 0) items.push({ id: "features", status: "warn", title: "Temel özellikler", detail: `Eksik: ${missing.join(", ")}.` });
  else items.push({ id: "features", status: "pass", title: "Temel özellikler", detail: "Oda, m², kat, ısınma, bina yaşı ve cephe dolu." });

  items.push(
    q.hasLocation
      ? { id: "location", status: "pass", title: "Konum", detail: "Adres veya harita konumu kayıtlı." }
      : { id: "location", status: "warn", title: "Konum", detail: "Adres veya harita konumu yok." },
  );
  items.push(
    q.hasVirtualTour
      ? { id: "tour", status: "pass", title: "360° tur / video", detail: "Bağlantı kayıtlı." }
      : { id: "tour", status: "na", title: "360° tur / video", detail: "İsteğe bağlı: tur veya video bağlantısı ilgiyi artırır." },
  );
  return items;
}

/**
 * Analizi hesaplar. Emsal yoksa `null` (kontör düşmez). Kontrol listesi tek başına ücretlendirilmez: fiyat konumu
 * hesaplanamıyorsa tüm analiz "yeterli emsal yok" sayılır.
 */
export function computeListingAnalysis(input: AnalysisInput): ListingAnalysisResult | null {
  const { listPrice, sqm, estimate: e } = input;
  if (!listPrice || listPrice <= 0) return null;
  if (e.confidence === "yetersiz" || !e.estimatedValue || e.estimatedValue <= 0 || e.compCount <= 0) return null;

  const deviationPct = pctGap(listPrice, e.estimatedValue);
  const verdict = deviationPct > MARKET_BAND_PCT ? "piyasa üstü" : deviationPct < -MARKET_BAND_PCT ? "piyasa altı" : "piyasa seviyesinde";

  const listSqmPrice = sqm && sqm > 0 ? Math.round(listPrice / sqm) : null;
  const sqmGapPct = listSqmPrice && e.medianSqmPrice && e.medianSqmPrice > 0 ? pctGap(listSqmPrice, e.medianSqmPrice) : null;

  const ef = input.efIndex && input.efIndex.medianM2 > 0
    ? { ...input.efIndex, gapPct: listSqmPrice ? pctGap(listSqmPrice, input.efIndex.medianM2) : null }
    : null;

  const { regionAvgDaysListed: avg, daysOnMarket: dom } = input;
  let note: string | null = null;
  if (avg != null && avg > 0 && dom != null) {
    note = dom > avg * 1.5
      ? `İlan ${trDays(dom)}dir yayında; bölge ortalaması ${trDays(avg)}. Ortalamanın belirgin üzerinde.`
      : `İlan ${trDays(dom)}dir yayında; bölge ortalaması ${trDays(avg)}.`;
  } else if (avg != null && avg > 0) {
    note = `Bölgede ortalama yayında kalma süresi ${trDays(avg)}.`;
  }

  let revision: ListingAnalysisResult["revision"] = null;
  let revisionNote: string | null = null;
  if (verdict === "piyasa üstü") {
    if (e.confidence === "orta" || e.confidence === "yüksek") {
      const suggested = roundNicePrice(e.estimatedValue, input.isRent);
      if (suggested > 0 && suggested < listPrice) {
        revision = {
          suggestedPrice: suggested,
          reducePct: pctGap(suggested, listPrice) * -1,
          ceilingPrice: e.highValue && e.highValue > suggested ? roundNicePrice(e.highValue, input.isRent) : null,
          label: "Tahmin",
          note: "Emsal medyanına göre tahmindir; pazarlık payı için üst banda kadar çıkılabilir. Malikle teyit edin.",
        };
      }
    } else {
      revisionNote = "Emsal sayısı az olduğu için fiyat revizyon önerisi verilmedi.";
    }
  } else if (verdict === "piyasa seviyesinde") {
    revisionNote = "Fiyat emsallerle uyumlu; revizyon önerilmez.";
  } else {
    revisionNote = "Fiyat emsal medyanının altında; düşürmek gerekmez. Malikle teyit edin.";
  }

  return {
    version: ANALYSIS_RESULT_VERSION,
    listPrice,
    sqm: sqm && sqm > 0 ? sqm : null,
    listSqmPrice,
    comps: {
      count: e.compCount,
      won: e.wonCount,
      active: e.activeCount,
      confidence: e.confidence,
      estimatedValue: e.estimatedValue,
      low: e.lowValue,
      high: e.highValue,
      medianSqmPrice: e.medianSqmPrice,
    },
    position: { deviationPct, verdict },
    sqmGapPct,
    efIndex: ef,
    market: { regionAvgDaysListed: avg, daysOnMarket: dom, note },
    revision,
    revisionNote,
    checklist: buildChecklist(input.quality),
  };
}

/** Önbellek anahtarı: girdi değişirse (fiyat/m²/bölge/tür) yeni analiz yapılır. */
export function analysisInputKey(i: {
  listPrice: number | null;
  sqm: number | null;
  districtId: string | null;
  propertyType: string | null;
  transactionType: string | null;
}): string {
  return [i.listPrice ?? 0, i.sqm ?? 0, i.districtId ?? "-", i.propertyType ?? "-", i.transactionType ?? "-"].join("|").slice(0, 200);
}

/** Kayıt `createdAtMs`'de oluştu; `nowMs` anında hâlâ ücretsiz önbellek penceresinde mi? */
export function isAnalysisFresh(createdAtMs: number, nowMs: number): boolean {
  return Number.isFinite(createdAtMs) && nowMs - createdAtMs >= 0 && nowMs - createdAtMs < ANALYSIS_CACHE_MS;
}

/**
 * Kontör rezervasyonu idempotency anahtarı (^[A-Za-z0-9_.:-]{8,128}$). Aynı ilan + aynı girdi + aynı 24 saatlik pencere =
 * aynı anahtar: çift tıklama/yarış tek düşüm yapar (cüzdan RPC'si 'duplicate' döner).
 */
export function analysisIdempotencyKey(propertyId: string, inputKey: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / ANALYSIS_CACHE_MS);
  let h = 5381;
  for (let i = 0; i < inputKey.length; i += 1) h = ((h * 33) ^ inputKey.charCodeAt(i)) >>> 0;
  return `la:${propertyId}:${h.toString(36)}:${bucket}`;
}
