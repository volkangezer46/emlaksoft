/**
 * Ofis Merkezi — AKILLI ATAMA MOTORU (SAF: veri çekmez, saat okumaz, kişisel veri taşımaz).
 *
 * `rankAdvisorsForProperty(property, advisors, context)` → sıralı, açıklanabilir öneri listesi.
 * Ölçütler (ağırlıklar ofis ayarından gelir, varsayılanlar DEFAULT_WEIGHTS; toplam oransal 100'e normalize edilir):
 *   iş yükü · uzmanlık (tür + işlem) · bölge (il/ilçe/mahalle) · son 90 gün performansı (kapanış oranı + SLA uyumu)
 *   · müsaitlik (mesai + son aktivite). Adil dağıtım: ±TIE_WINDOW puan içindekilerde son atamadan en eski öne geçer.
 * Takım/şube kısıtı: `context.restrictToBranchId` verilirse (şube müdürü) başka şubedeki danışman ELENİR.
 * Eleme (`exclusionReason`, havuzla aynı kural) puandan önce gelir: pasif, havuza kapalı, duraklatılmış, izinli, kapasite dolu.
 *
 * Bölge ve uzmanlık alt hesapları `@/lib/pool/score.ts` ile ORTAKTIR (tek kaynak): oradaki 35/20/10 tabanlı puan,
 * buradaki ağırlığa ölçeklenir. Böylece havuz sayfası ile Ofis Merkezi aynı eşleşmeyi farklı ağırlıkla yorumlar.
 */
import {
  exclusionReason,
  POOL_MAX,
  regionPoints,
  specialtyReasons,
  TIE_WINDOW,
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

export const PERF_MIN_LISTINGS = 5;
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
  /** Ofis ortalama açık yük (portföy + talep); 0 ise iş yükü nötr sayılır. */
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
const DAY_MS = 86_400_000;

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

function workloadReason(c: SmartCandidate, ctx: SmartContext, max: number): ScoreReason {
  const load = c.openListings + c.openDemands;
  let ratio: number;
  let detail: string;
  if (c.capacity != null && c.capacity > 0) {
    ratio = 1 - c.openListings / c.capacity;
    detail = `${c.openListings}/${c.capacity} portföy · ${c.openDemands} açık talep`;
  } else if (ctx.officeAvgLoad <= 0) {
    ratio = 0.6;
    detail = `${c.openListings} portföy · ${c.openDemands} talep (ofis ortalaması yok: nötr)`;
  } else {
    ratio = 1 - load / (2 * ctx.officeAvgLoad);
    detail = `${c.openListings} portföy · ${c.openDemands} talep (ofis ort. ${Math.round(ctx.officeAvgLoad)})`;
  }
  return { key: "workload", label: "İş yükü", points: Math.round(max * clamp(ratio, 0, 1)), max, detail };
}

function specialtyReason(c: SmartCandidate, p: PoolProperty, max: number): ScoreReason {
  const [type, txn] = specialtyReasons(c, p);
  const ratio = (type.points + txn.points) / (POOL_MAX.type + POOL_MAX.transaction);
  const parts = [type.points > 0 ? type.detail : null, txn.points > 0 ? txn.detail : null].filter(Boolean);
  return {
    key: "specialty",
    label: "Uzmanlık",
    points: Math.round(max * clamp(ratio, 0, 1)),
    max,
    detail: parts.length ? parts.join(" · ") : "Tür/işlem uzmanlığı eşleşmedi",
  };
}

function regionReason(c: SmartCandidate, p: PoolProperty, ctx: SmartContext, max: number): ScoreReason {
  const r = regionPoints(c, p, ctx);
  return { key: "region", label: "Bölge", points: Math.round(max * clamp(r.points / POOL_MAX.region, 0, 1)), max, detail: r.detail };
}

function performanceReason(c: SmartCandidate, max: number): ScoreReason {
  const perf = c.performance;
  const closeRatio = perf && perf.listings >= PERF_MIN_LISTINGS ? clamp(perf.deals / perf.listings / 0.25, 0, 1) : null;
  const slaRatio = c.slaWithinPct != null ? clamp(c.slaWithinPct / 100, 0, 1) : null;
  if (closeRatio == null && slaRatio == null) {
    return { key: "performance", label: "Performans (90 gün)", points: Math.round(max * 0.4), max, detail: "Veri yetersiz: nötr" };
  }
  const parts: number[] = [];
  const details: string[] = [];
  if (closeRatio != null && perf) {
    parts.push(closeRatio);
    details.push(`${perf.listings} ilandan ${perf.deals} anlaşma`);
  }
  if (slaRatio != null) {
    parts.push(slaRatio);
    details.push(`SLA uyumu %${Math.round(c.slaWithinPct ?? 0)}`);
  }
  const ratio = parts.reduce((s, v) => s + v, 0) / parts.length;
  return { key: "performance", label: "Performans (90 gün)", points: Math.round(max * ratio), max, detail: details.join(" · ") };
}

function availabilityReason(c: SmartCandidate, ctx: SmartContext, max: number): ScoreReason {
  const shift = c.availability === "in_hours" ? 1 : c.availability === "out_of_hours" ? 0.6 : 0;
  const shiftText = c.availability === "in_hours" ? "mesai içinde" : c.availability === "out_of_hours" ? "mesai dışı" : "çalışma günü değil";
  let recency: number;
  let recencyText: string;
  if (c.lastActivityAtMs == null) {
    recency = 0.2;
    recencyText = "son 90 günde aktivite kaydı yok";
  } else {
    const days = (ctx.nowMs - c.lastActivityAtMs) / DAY_MS;
    if (days <= 2) {
      recency = 1;
      recencyText = "son 2 günde aktif";
    } else if (days <= 7) {
      recency = 0.7;
      recencyText = "son 7 günde aktif";
    } else if (days <= 30) {
      recency = 0.4;
      recencyText = "son 30 günde aktif";
    } else {
      recency = 0.2;
      recencyText = `${Math.floor(days)} gündür aktivite yok`;
    }
  }
  return {
    key: "availability",
    label: "Müsaitlik",
    points: Math.round(max * (0.5 * shift + 0.5 * recency)),
    max,
    detail: `Şimdi ${shiftText} · ${recencyText}`,
  };
}

/** Elenme nedeni: havuz kuralları + şube kısıtı. */
export function smartExclusionReason(c: SmartCandidate, ctx: SmartContext): string | null {
  if (ctx.restrictToBranchId && c.branchId !== ctx.restrictToBranchId) return "Başka şubede (yalnız kendi şubenize atayabilirsiniz)";
  return exclusionReason(c, ctx);
}

export function explainSmart(reasons: ScoreReason[]): string {
  const parts = reasons.filter((r) => r.points > 0).map((r) => `${r.label} +${r.points}`);
  return parts.length ? parts.join(" · ") : "Puan veren ölçüt yok";
}

export function scoreSmartCandidate(c: SmartCandidate, p: PoolProperty, ctx: SmartContext): SmartSuggestion {
  const why = smartExclusionReason(c, ctx);
  if (why) return { profileId: c.profileId, name: c.name, score: 0, reasons: [], summary: `Elendi: ${why}`, excluded: { reason: why } };
  const w = normalizeWeights(ctx.weights);
  const reasons = [
    workloadReason(c, ctx, w.workload),
    specialtyReason(c, p, w.specialty),
    regionReason(c, p, ctx, w.region),
    performanceReason(c, w.performance),
    availabilityReason(c, ctx, w.availability),
  ].filter((r) => r.max > 0);
  const score = clamp(reasons.reduce((s, r) => s + r.points, 0), 0, 100);
  return { profileId: c.profileId, name: c.name, score, reasons, summary: explainSmart(reasons) };
}

/**
 * Sıralı öneri listesi. Elenmeyenler puana göre; ±TIE_WINDOW içindeki küme son atamadan EN ESKİ (hiç almamış en önde)
 * sonra yüksek kural ağırlığı, sonra ad. Elenenler sona, nedenleriyle.
 */
export function rankAdvisorsForProperty(property: PoolProperty, advisors: readonly SmartCandidate[], ctx: SmartContext): SmartSuggestion[] {
  const byId = new Map(advisors.map((c) => [c.profileId, c]));
  const scored = advisors.map((c) => scoreSmartCandidate(c, property, ctx));
  const eligible = scored.filter((s) => !s.excluded).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr"));
  const excluded = scored.filter((s) => s.excluded).sort((a, b) => a.name.localeCompare(b.name, "tr"));

  const ordered: SmartSuggestion[] = [];
  let i = 0;
  while (i < eligible.length) {
    const top = eligible[i].score;
    let j = i;
    while (j < eligible.length && top - eligible[j].score <= TIE_WINDOW) j++;
    const cluster = eligible.slice(i, j).sort((a, b) => {
      const ca = byId.get(a.profileId);
      const cb = byId.get(b.profileId);
      const la = ca?.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY;
      const lb = cb?.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY;
      if (la !== lb) return la - lb;
      const wa = ca?.ruleWeight ?? 1;
      const wb = cb?.ruleWeight ?? 1;
      if (wa !== wb) return wb - wa;
      if (a.score !== b.score) return b.score - a.score;
      return a.name.localeCompare(b.name, "tr");
    });
    ordered.push(...cluster);
    i = j;
  }
  return [...ordered, ...excluded];
}

/** İlk N uygun öneri (elenenler hariç). */
export function topSuggestions(list: readonly SmartSuggestion[], limit = SUGGESTION_LIMIT): SmartSuggestion[] {
  return list.filter((s) => !s.excluded).slice(0, limit);
}

/** pool_assignments.score jsonb için sade biçim (kişisel veri yok). */
export function toStoredScore(s: SmartSuggestion): { total: number; reasons: { key: string; label: string; points: number; max: number }[] } {
  return { total: s.score, reasons: s.reasons.map((r) => ({ key: r.key, label: r.label, points: r.points, max: r.max })) };
}
