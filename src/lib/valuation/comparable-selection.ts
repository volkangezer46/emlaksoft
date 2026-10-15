/**
 * PF-02 — Danışmanın emsal seçimi (dahil et / çıkar, elle emsal) ve değerlemenin yeniden hesabı. SAF modül.
 *
 * Kayıt yeri: `valuations.sources` içindeki `__emsal_dokumu` elemanı (motorun o günkü emsal anlık görüntüsü). Seçim
 * aynı elemana `selection` olarak, ilk düzenlemeden önceki motor sonucu `engine_snapshot` olarak yazılır; "Motorun
 * seçimine dön" bu anlık görüntüyü geri yükler (aylar sonra yeniden hesaplanan farklı bir küme değil).
 *
 * Dürüstlük kuralları:
 *  - Hesap, SQL `estimate_property_value` ile AYNI: düzeltilmiş ₺/m² medyanı × hedef m², kazanılmış anlaşma iki kez
 *    sayılır, alt/üst = 1. ve 3. çeyrek; güven = emsal sayısı + yayılım (≥8 emsal, ≥2 kapanış, yayılım ≤%35 → yüksek).
 *  - Elle girilen emsal "Danışman girdisi" olarak etiketlenir, düzeltme uygulanmaz ve güveni ASLA "yüksek"e taşımaz.
 *  - Tüm emsaller çıkarılırsa emsal kaynağı düşer (güven "yetersiz"); başka fiyat kaynağı yoksa rakam üretilmez.
 *  - Portföyün kalıcı fiyat sağlığı (`properties.price_health`) bu seçimden ETKİLENMEZ; o yalnız motorun emsalleriyle.
 */
import type { ComparableDetail } from "@/lib/comparables";
import {
  COMPARABLE_SOURCE_LABEL,
  combinePriceSources,
  comparableSourceWeight,
  valuationEvidenceConfidence,
  type ComparableConfidenceLevel,
  type MarketIndexLevel,
  type ValuationSourceLike,
} from "@/lib/valuation/combine";

export const COMPARABLES_ENTRY_NAME = "__emsal_dokumu";
/** EmlakFiyati kaynağının adı (contract.ts ile aynı; saf modül sözleşme dosyasını içe aktarmasın diye sabit). */
export const MARKET_INDEX_SOURCE_NAME = "EmlakFiyati endeksi";
export const MANUAL_COMPARABLE_LIMIT = 12;

export type ManualComparable = {
  id: string;
  /** Kısa tanım ("Aynı site, 5. kat") — kişisel veri yazılmaz. */
  title: string | null;
  /** İlan bağlantısı (yalnız https). */
  source_url: string | null;
  price: number;
  sqm: number;
  rooms: string | null;
  floor: number | null;
  added_at: string;
};

export type ComparableSelection = {
  /** `comparableKey` listesi: rapora ve hesaba girmeyen motor emsalleri. */
  excluded: string[];
  manual: ManualComparable[];
  /** Değerlenen taşınmazın m²'si (portföysüz değerlemede kayıttan çıkarılamaz; ilk düzenlemede saklanır). */
  target_sqm: number | null;
  edited_at: string | null;
};

export type EngineSnapshot = {
  low: number | null;
  mid: number | null;
  high: number | null;
  confidence: number | null;
  comparable_source: ValuationSourceLike | null;
};

export type ComparablesEntry = {
  name: typeof COMPARABLES_ENTRY_NAME;
  weight: 0;
  value: number;
  note: string;
  comparables: ComparableDetail[];
  selection?: ComparableSelection;
  engine_snapshot?: EngineSnapshot;
};

export const EMPTY_SELECTION: ComparableSelection = { excluded: [], manual: [], target_sqm: null, edited_at: null };

export function comparableKey(c: Pick<ComparableDetail, "source" | "property_id">): string {
  return `${c.source}:${c.property_id}`;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function cleanManual(v: unknown): ManualComparable | null {
  if (!isObj(v)) return null;
  const price = num(v.price);
  const sqm = num(v.sqm);
  if (typeof v.id !== "string" || price == null || price <= 0 || sqm == null || sqm <= 0) return null;
  return {
    id: v.id,
    title: typeof v.title === "string" ? v.title : null,
    source_url: typeof v.source_url === "string" ? v.source_url : null,
    price,
    sqm,
    rooms: typeof v.rooms === "string" ? v.rooms : null,
    floor: num(v.floor),
    added_at: typeof v.added_at === "string" ? v.added_at : "",
  };
}

/** Kayıttaki emsal elemanı + seçim (eski kayıtlarda seçim boş). */
export function readComparablesEntry(sources: unknown): {
  entry: ComparablesEntry | null;
  rows: ComparableDetail[];
  selection: ComparableSelection;
} {
  const list = Array.isArray(sources) ? sources : [];
  const raw = list.find((s) => isObj(s) && s.name === COMPARABLES_ENTRY_NAME) as Record<string, unknown> | undefined;
  if (!raw) return { entry: null, rows: [], selection: { ...EMPTY_SELECTION } };
  const rows = Array.isArray(raw.comparables) ? (raw.comparables as ComparableDetail[]) : [];
  const sel = isObj(raw.selection) ? raw.selection : {};
  const selection: ComparableSelection = {
    excluded: Array.isArray(sel.excluded) ? sel.excluded.filter((x): x is string => typeof x === "string") : [],
    manual: Array.isArray(sel.manual) ? sel.manual.map(cleanManual).filter((x): x is ManualComparable => x != null) : [],
    target_sqm: num(sel.target_sqm),
    edited_at: typeof sel.edited_at === "string" ? sel.edited_at : null,
  };
  return { entry: raw as unknown as ComparablesEntry, rows, selection };
}

export function hasEdits(selection: ComparableSelection): boolean {
  return selection.excluded.length > 0 || selection.manual.length > 0;
}

/** SQL `percentile_cont` ile aynı doğrusal ara değer. */
export function percentileCont(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export type SelectionEstimate = {
  estimatedValue: number | null;
  lowValue: number | null;
  highValue: number | null;
  medianSqmPrice: number | null;
  compCount: number;
  wonCount: number;
  manualCount: number;
  excludedCount: number;
  confidence: ComparableConfidenceLevel;
  spreadPct: number | null;
};

function rowSqmPrice(r: ComparableDetail): number | null {
  const adj = num(r.adjusted_price_per_sqm);
  if (adj != null && adj > 0) return adj;
  return null;
}

/** Seçime göre emsal tahmini (motor kuralının TS karşılığı). */
export function estimateFromSelection(
  rows: readonly ComparableDetail[],
  selection: ComparableSelection,
  targetSqm: number | null,
): SelectionEstimate {
  const excluded = new Set(selection.excluded);
  const included = rows.filter((r) => !excluded.has(comparableKey(r)) && rowSqmPrice(r) != null);
  const values: number[] = [];
  let won = 0;
  for (const r of included) {
    const v = rowSqmPrice(r)!;
    values.push(v);
    if (r.source === "won_deal") {
      values.push(v);
      won += 1;
    }
  }
  for (const m of selection.manual) values.push(m.price / m.sqm);
  values.sort((a, b) => a - b);
  const total = included.length + selection.manual.length;
  const excludedCount = rows.filter((r) => excluded.has(comparableKey(r))).length;

  const med = percentileCont(values, 0.5);
  const q1 = percentileCont(values, 0.25);
  const q3 = percentileCont(values, 0.75);
  const spread = med != null && med > 0 && q1 != null && q3 != null ? (q3 - q1) / med : null;

  let confidence: ComparableConfidenceLevel =
    total === 0
      ? "yetersiz"
      : total >= 8 && won >= 2 && spread != null && spread <= 0.35
        ? "yüksek"
        : total >= 4
          ? "orta"
          : "düşük";
  // Elle emsal güveni kural dışı yükseltemez.
  if (selection.manual.length > 0 && confidence === "yüksek") confidence = "orta";

  const sqm = targetSqm != null && targetSqm > 0 ? targetSqm : null;
  const ok = total > 0 && med != null && sqm != null;
  return {
    estimatedValue: ok ? Math.round(med! * sqm!) : null,
    lowValue: ok && q1 != null ? Math.round(q1 * sqm!) : null,
    highValue: ok && q3 != null ? Math.round(q3 * sqm!) : null,
    medianSqmPrice: med != null ? Math.round(med) : null,
    compCount: total,
    wonCount: won,
    manualCount: selection.manual.length,
    excludedCount,
    confidence: ok ? confidence : "yetersiz",
    spreadPct: spread != null ? Math.round(spread * 1000) / 10 : null,
  };
}

const CONF_RE = /güven:\s*(yüksek|orta|düşük)/u;
const MEDIAN_RE = /medyan\s+([\d.]+)\s*₺\/m²/u;

/** Eski emsal kaynağı notundan güven kademesi (ilk hesaptaki). */
export function parseComparableConfidence(note: string | null | undefined): ComparableConfidenceLevel | null {
  const m = CONF_RE.exec(note ?? "");
  return m ? (m[1] as ComparableConfidenceLevel) : null;
}

/**
 * Hedef m²: seçimde saklı > çağıranın verdiği (portföy) > eski emsal kaynağından (değer ÷ medyan ₺/m²).
 * Hiçbiri yoksa null (çağıran m² ister).
 */
export function resolveTargetSqm(
  selection: ComparableSelection,
  fallbackSqm: number | null,
  comparableSource: ValuationSourceLike | null,
): number | null {
  if (selection.target_sqm && selection.target_sqm > 0) return selection.target_sqm;
  if (fallbackSqm && fallbackSqm > 0) return fallbackSqm;
  const m = comparableSource ? MEDIAN_RE.exec(comparableSource.note) : null;
  if (m && comparableSource) {
    const median = Number(m[1]!.replace(/\./g, ""));
    if (median > 0 && comparableSource.value > 0) return Math.round(comparableSource.value / median);
  }
  return null;
}

/**
 * Kayıtlı güven puanını üreten piyasa endeksi kademesini bulur (endeks özeti kayıtta yok). Eşleşme yoksa endeks
 * kaynağı varsa en düşük kademe ("low") — güven hiçbir zaman kayıttakinden yüksek tahmin edilmez.
 */
export function inferMarketIndexLevel(input: {
  hasMarketIndex: boolean;
  hasListPrice: boolean;
  previousComparableConfidence: ComparableConfidenceLevel | null;
  storedConfidence: number | null;
}): MarketIndexLevel {
  if (!input.hasMarketIndex) return "none";
  const stored = input.storedConfidence == null ? null : input.storedConfidence > 1 ? input.storedConfidence / 100 : input.storedConfidence;
  if (stored != null) {
    for (const level of ["high", "medium", "low"] as const) {
      const c = valuationEvidenceConfidence({
        hasListPrice: input.hasListPrice,
        comparableConfidence: input.previousComparableConfidence,
        marketIndex: level,
      });
      if (Math.abs(c - stored) < 0.005) return level;
    }
  }
  return "low";
}

export function comparableSourceNote(est: SelectionEstimate, edited: boolean): string {
  const parts = [`${est.compCount} emsal (${est.wonCount} kapanmış satış${est.manualCount > 0 ? `, ${est.manualCount} danışman girdisi` : ""})`];
  if (est.medianSqmPrice != null) parts.push(`medyan ${est.medianSqmPrice.toLocaleString("tr-TR")} ₺/m²`);
  parts.push(`güven: ${est.confidence}`);
  if (edited) parts.push("danışman seçimi");
  return parts.join(" · ");
}

export type RecomputeResult = {
  low: number | null;
  mid: number | null;
  high: number | null;
  confidence: number;
  sources: unknown[];
  estimate: SelectionEstimate;
};

/**
 * Seçimi uygular ve kaydın yeni değerlerini döndürür. Diğer kaynaklar (liste fiyatı, piyasa endeksi, uyarılar)
 * kayıtta olduğu gibi kalır; yalnız emsal kaynağı yeniden üretilir. Seçim boşsa ve motor anlık görüntüsü varsa
 * değerleme motorun ilk sonucuna döner.
 */
export function recomputeValuation(input: {
  sources: unknown;
  storedConfidence: number | null;
  stored: { low: number | null; mid: number | null; high: number | null };
  selection: ComparableSelection;
  fallbackSqm: number | null;
  editedAt: string;
}): RecomputeResult | { error: string } {
  const list = Array.isArray(input.sources) ? (input.sources as unknown[]) : [];
  const { entry, rows } = readComparablesEntry(list);
  const publicSources = list.filter(
    (s): s is ValuationSourceLike => isObj(s) && typeof s.name === "string" && !s.name.startsWith("__"),
  );
  const oldComparable = publicSources.find((s) => s.name === COMPARABLE_SOURCE_LABEL) ?? null;
  const snapshot: EngineSnapshot = entry?.engine_snapshot ?? {
    low: input.stored.low,
    mid: input.stored.mid,
    high: input.stored.high,
    confidence: input.storedConfidence,
    comparable_source: oldComparable,
  };

  const targetSqm = resolveTargetSqm(input.selection, input.fallbackSqm, snapshot.comparable_source ?? oldComparable);
  if (!targetSqm) return { error: "Değerlenen taşınmazın m² bilgisi bulunamadı; önce m² girin." };

  const edited = hasEdits(input.selection);
  const selection: ComparableSelection = { ...input.selection, target_sqm: targetSqm, edited_at: edited ? input.editedAt : null };
  const estimate = estimateFromSelection(rows, selection, targetSqm);
  const newEntry: ComparablesEntry = {
    name: COMPARABLES_ENTRY_NAME,
    weight: 0,
    value: rows.length,
    note: entry?.note ?? "Değerleme anında kullanılan emsal kayıtları (rapor tablosu için).",
    comparables: rows,
    selection,
    engine_snapshot: snapshot,
  };

  const others = list.filter((s) => !(isObj(s) && (s.name === COMPARABLES_ENTRY_NAME || s.name === COMPARABLE_SOURCE_LABEL)));

  // Seçim boş: motorun ilk sonucuna dönülür (aynı kaynak, aynı rakamlar).
  if (!edited) {
    const restored = snapshot.comparable_source ? [snapshot.comparable_source] : [];
    return {
      low: snapshot.low,
      mid: snapshot.mid,
      high: snapshot.high,
      confidence: snapshot.confidence ?? 0,
      sources: [...others, ...restored, newEntry],
      estimate,
    };
  }

  const comparableSource: ValuationSourceLike | null =
    estimate.confidence !== "yetersiz" && estimate.estimatedValue
      ? {
          name: COMPARABLE_SOURCE_LABEL,
          weight: comparableSourceWeight(estimate.confidence),
          value: estimate.estimatedValue,
          note: comparableSourceNote(estimate, true),
        }
      : null;

  const priceSources: ValuationSourceLike[] = [
    ...publicSources.filter((s) => s.name !== COMPARABLE_SOURCE_LABEL),
    ...(comparableSource ? [comparableSource] : []),
  ];
  const combined = combinePriceSources(priceSources, comparableSource ? estimate.spreadPct : null);
  const hasListPrice = publicSources.some((s) => s.name === "Ofis liste fiyatı" && s.weight > 0);
  const hasMarketIndex = publicSources.some((s) => s.name === MARKET_INDEX_SOURCE_NAME && s.weight > 0);
  const marketIndex = inferMarketIndexLevel({
    hasMarketIndex,
    hasListPrice,
    previousComparableConfidence: parseComparableConfidence(snapshot.comparable_source?.note),
    storedConfidence: snapshot.confidence,
  });
  const confidence = combined
    ? valuationEvidenceConfidence({
        hasListPrice,
        comparableConfidence: comparableSource ? estimate.confidence : null,
        marketIndex,
      })
    : 0;

  return {
    low: combined?.low ?? null,
    mid: combined?.mid ?? null,
    high: combined?.high ?? null,
    confidence,
    sources: [...others, ...(comparableSource ? [comparableSource] : []), newEntry],
    estimate,
  };
}

/** Rapor tablosu satırı (motor + elle), seçim uygulanmış. */
export type ReportComparable =
  | { kind: "engine"; key: string; row: ComparableDetail; included: boolean }
  | { kind: "manual"; key: string; manual: ManualComparable; included: true };

export function reportComparables(rows: readonly ComparableDetail[], selection: ComparableSelection): ReportComparable[] {
  const excluded = new Set(selection.excluded);
  return [
    ...rows.map((row) => ({ kind: "engine" as const, key: comparableKey(row), row, included: !excluded.has(comparableKey(row)) })),
    ...selection.manual.map((manual) => ({ kind: "manual" as const, key: `manual:${manual.id}`, manual, included: true as const })),
  ];
}
