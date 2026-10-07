/**
 * Ofis Merkezi — AKILLI ATAMA = tek puanlama motorunun (`@/lib/pool/score.ts`) OFİS AĞIRLIKLI PROFİLİ (SAF).
 *
 * `rankAdvisorsForProperty(property, advisors, context)` → sıralı, açıklanabilir öneri listesi.
 * Ölçütler (ağırlıklar ofis ayarından gelir, varsayılanlar DEFAULT_WEIGHTS; toplam oransal 100'e normalize edilir):
 *   iş yükü · uzmanlık (tür + işlem) · bölge (il/ilçe/mahalle) · son 90 gün performansı (kapanış oranı + SLA uyumu)
 *   · müsaitlik (mesai + son aktivite). Adil dağıtım: eşit sayılan puan aralığında (motor `rankScored`) son atamadan en eski öne geçer.
 * Takım/şube kısıtı: `context.restrictToBranchId` verilirse (şube müdürü) başka şubedeki danışman ELENİR.
 * Eleme (`exclusionReason`, havuzla aynı kural) puandan önce gelir: pasif, havuza kapalı, duraklatılmış, izinli, kapasite dolu.
 *
 * TÜM alt hesaplar motordan gelir (bölge, uzmanlık = tür + işlem + tanımlıysa fiyat bandı, iş yükü/performans/müsaitlik
 * çarpanları, adil dağıtımlı sıralama, açıklama); burada yalnız ofis ağırlıkları uygulanır ve gruplanır. Havuz ile Ofis
 * Merkezi aynı eşleşmeyi aynı gerekçelerle, yalnız farklı ağırlıkla yorumlar.
 */
import {
  availabilityFactor,
  exclusionReason,
  explainReasons,
  factorReason,
  performanceFactor,
  POOL_MAX,
  PERFORMANCE_MIN_SAMPLE,
  rankScored,
  regionPoints,
  specialtyReasons,
  workloadFactor,
  type PoolCandidate,
  type PoolProperty,
  type ScoreContext,
  type ScoreReason,
} from "@/lib/pool/score";

export type SmartWeights = {
  workload: number;
  specialty: number;
  region: number;
  performance: number;
  availability: number;
};

/** Ayar kaydı yoksa geçerli ağırlıklar (registry tenant.ts ile aynı; test kilitler). */
export const DEFAULT_WEIGHTS: SmartWeights = { workload: 25, specialty: 20, region: 25, performance: 15, availability: 15 };

export const PERF_MIN_LISTINGS = PERFORMANCE_MIN_SAMPLE;
export const SUGGESTION_LIMIT = 3;

export type SmartCandidate = PoolCandidate & {
  branchId: string | null;
  teamId: string | null;
  /** Açık talep (müşterisi bu danışmana atanmış). */
  openDemands: number;
  /** Bu dönem ilk yanıt SLA uyumu (0-100) veya null (ölçüm yok). */
  slaWithinPct: number | null;
  /** Son aktivite (epoch ms) veya null. */
  lastActivityAtMs: number | null;
};

export type SmartContext = ScoreContext & {
  weights?: Partial<SmartWeights> | null;
  /** Ofis ortalama açık yük (portföy + talep); 0 ise iş yükü nötr sayılır. Motor bu alanla iş yüküne talebi de katar. */
  officeAvgLoad: number;
  /** Şube müdürü kısıtı: yalnız bu şubedeki danışmanlar aday olur. */
  restrictToBranchId?: string | null;
};

export type SmartSuggestion = {
  profileId: string;
  name: string;
  score: number;
  reasons: ScoreReason[];
  /** "Bölge +25 · İş yükü +18" biçiminde tek satır. */
  summary: string;
  excluded?: { reason: string };
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Ağırlıkları doğrular ve toplamı 100'e oransal normalize eder; hepsi 0/geçersizse varsayılan. */
export function normalizeWeights(input?: Partial<SmartWeights> | null): SmartWeights {
  const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof SmartWeights)[];
  const raw: SmartWeights = { ...DEFAULT_WEIGHTS };
  for (const k of keys) {
    const v = input?.[k];
    raw[k] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHTS[k];
  }
  const sum = keys.reduce((s, k) => s + raw[k], 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as SmartWeights;
  let acc = 0;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) out[k] = 100 - acc;
    else {
      out[k] = Math.round((raw[k] / sum) * 100);
      acc += out[k];
    }
  });
  return out;
}

/**
 * Uzmanlık = motorun tür + işlem bileşenleri; ilanın fiyatı ve danışmanın fiyat bandı TANIMLIYSA fiyat bandı da girer
 * (havuz profiliyle aynı uzmanlık tanımı). Bant tanımsızsa fiyat nötr değildir, hesaptan çıkar (tam uzman tam puan alır).
 */
function specialtyReason(c: SmartCandidate, p: PoolProperty, max: number): ScoreReason {
  const [type, txn, price] = specialtyReasons(c, p);
  const banded = p.listPrice != null && p.listPrice > 0 && c.specialties.some((sp) => sp.kind === "property_type" && (sp.priceMin != null || sp.priceMax != null));
  const got = type.points + txn.points + (banded ? price.points : 0);
  const of = POOL_MAX.type + POOL_MAX.transaction + (banded ? POOL_MAX.price : 0);
  const parts = [type.points > 0 ? type.detail : null, txn.points > 0 ? txn.detail : null, banded ? price.detail : null].filter(Boolean);
  return {
    key: "specialty",
    label: "Uzmanlık",
    points: Math.round(max * clamp(got / of, 0, 1)),
    max,
    detail: parts.length ? parts.join(" · ") : "Tür/işlem uzmanlığı eşleşmedi",
  };
}

function regionReason(c: SmartCandidate, p: PoolProperty, ctx: SmartContext, max: number): ScoreReason {
  const r = regionPoints(c, p, ctx);
  return { key: "region", label: "Bölge", points: Math.round(max * clamp(r.points / POOL_MAX.region, 0, 1)), max, detail: r.detail };
}

/** Elenme nedeni: havuz kuralları + şube kısıtı. */
export function smartExclusionReason(c: SmartCandidate, ctx: SmartContext): string | null {
  if (ctx.restrictToBranchId && c.branchId !== ctx.restrictToBranchId) return "Başka şubede (yalnız kendi şubenize atayabilirsiniz)";
  return exclusionReason(c, ctx);
}

export function explainSmart(reasons: ScoreReason[]): string {
  return explainReasons(reasons, "Puan veren ölçüt yok");
}

export function scoreSmartCandidate(c: SmartCandidate, p: PoolProperty, ctx: SmartContext): SmartSuggestion {
  const why = smartExclusionReason(c, ctx);
  if (why) return { profileId: c.profileId, name: c.name, score: 0, reasons: [], summary: `Elendi: ${why}`, excluded: { reason: why } };
  const w = normalizeWeights(ctx.weights);
  const reasons = [
    factorReason("workload", "İş yükü", workloadFactor(c, ctx), w.workload),
    specialtyReason(c, p, w.specialty),
    regionReason(c, p, ctx, w.region),
    factorReason("performance", "Performans (90 gün)", performanceFactor(c), w.performance),
    factorReason("availability", "Müsaitlik", availabilityFactor(c, ctx.nowMs), w.availability),
  ].filter((r) => r.max > 0);
  const score = clamp(reasons.reduce((s, r) => s + r.points, 0), 0, 100);
  return { profileId: c.profileId, name: c.name, score, reasons, summary: explainSmart(reasons) };
}

/**
 * Sıralı öneri listesi. Elenmeyenler puana göre; eşit sayılan puan kümesinde son atamadan EN ESKİ (hiç almamış en önde)
 * sonra yüksek kural ağırlığı, sonra ad. Elenenler sona, nedenleriyle.
 */
export function rankAdvisorsForProperty(property: PoolProperty, advisors: readonly SmartCandidate[], ctx: SmartContext): SmartSuggestion[] {
  return rankScored(
    advisors.map((c) => scoreSmartCandidate(c, property, ctx)),
    new Map(advisors.map((c) => [c.profileId, c])),
  );
}

/** İlk N uygun öneri (elenenler hariç). */
export function topSuggestions(list: readonly SmartSuggestion[], limit = SUGGESTION_LIMIT): SmartSuggestion[] {
  return list.filter((s) => !s.excluded).slice(0, limit);
}

/** pool_assignments.score jsonb için sade biçim (kişisel veri yok). */
export function toStoredScore(s: SmartSuggestion): { total: number; reasons: { key: string; label: string; points: number; max: number }[] } {
  return { total: s.score, reasons: s.reasons.map((r) => ({ key: r.key, label: r.label, points: r.points, max: r.max })) };
}
