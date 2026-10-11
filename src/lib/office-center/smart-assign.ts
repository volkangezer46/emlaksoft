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
  DEFAULT_OFFICE_WEIGHTS,
  exclusionReason,
  explainReasons,
  normalizeScoreWeights,
  PERFORMANCE_MIN_SAMPLE,
  rankForProfile,
  scoreForProfile,
  type PoolCandidate,
  type PoolProperty,
  type ScoreContext,
  type ScoreProfile,
  type ScoreReason,
  type ScoreWeights,
} from "@/lib/pool/score";

export type SmartWeights = ScoreWeights;

/** Ayar kaydı yoksa geçerli ağırlıklar (registry tenant.ts ile aynı; test kilitler). TEK kaynak: pool/score.ts. */
export const DEFAULT_WEIGHTS: SmartWeights = DEFAULT_OFFICE_WEIGHTS;

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

/** Ağırlıkları doğrular ve toplamı 100'e oransal normalize eder (TEK uygulama: pool/score.ts). */
export const normalizeWeights = normalizeScoreWeights;

/** Elenme nedeni: havuz kuralları + şube kısıtı. */
export function smartExclusionReason(c: SmartCandidate, ctx: SmartContext): string | null {
  if (ctx.restrictToBranchId && c.branchId !== ctx.restrictToBranchId) return "Başka şubede (yalnız kendi şubenize atayabilirsiniz)";
  return exclusionReason(c, ctx);
}

export function explainSmart(reasons: ScoreReason[]): string {
  return explainReasons(reasons, "Puan veren ölçüt yok");
}

/** Ofis profili: TEK puanlayıcı (`pool/score.ts` scoreForProfile) + şube müdürü kısıtı. */
function officeProfile(ctx: SmartContext): ScoreProfile {
  return {
    kind: "office",
    weights: ctx.weights,
    extraExclusion: (c) => smartExclusionReason(c as SmartCandidate, ctx),
  };
}

export function scoreSmartCandidate(c: SmartCandidate, p: PoolProperty, ctx: SmartContext): SmartSuggestion {
  const r = scoreForProfile(officeProfile(ctx), c, p, ctx);
  return { ...r, summary: r.summary ?? "" };
}

/**
 * Sıralı öneri listesi. Elenmeyenler puana göre; eşit sayılan puan kümesinde son atamadan EN ESKİ (hiç almamış en önde)
 * sonra yüksek kural ağırlığı, sonra ad. Elenenler sona, nedenleriyle.
 */
export function rankAdvisorsForProperty(property: PoolProperty, advisors: readonly SmartCandidate[], ctx: SmartContext): SmartSuggestion[] {
  return rankForProfile(officeProfile(ctx), advisors, property, ctx).map((r) => ({ ...r, summary: r.summary ?? "" }));
}

/** İlk N uygun öneri (elenenler hariç). */
export function topSuggestions(list: readonly SmartSuggestion[], limit = SUGGESTION_LIMIT): SmartSuggestion[] {
  return list.filter((s) => !s.excluded).slice(0, limit);
}

/** pool_assignments.score jsonb için sade biçim (kişisel veri yok). */
export function toStoredScore(s: SmartSuggestion): { total: number; reasons: { key: string; label: string; points: number; max: number }[] } {
  return { total: s.score, reasons: s.reasons.map((r) => ({ key: r.key, label: r.label, points: r.points, max: r.max })) };
}
