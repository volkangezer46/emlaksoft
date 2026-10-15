/**
 * "Kriteri genişlet" önerisi (CRM-G6) — SAF modül.
 *
 * Sıfır ya da az eşleşmeli talepte AYNI aday kümesi (tek aday sorgusu) birkaç gevşetilmiş talep varyantıyla yeniden
 * skorlanır; her varyant kaç YENİ portföy kazandırdığıyla döner. Uydurma yok: kazanç gerçek skor motorundan gelir,
 * kazandırmayan varyant önerilmez. Uygulama (`applyDemandWiden` action'ı) aynı `widenDemandPatch` ile sunucuda
 * yeniden hesaplar; istemciden gelen sayıya güvenilmez.
 *
 * Not: aday kümesi talebin il ve işlem türüyle daraltılmıştır; bu yüzden il dışına taşan genişletme önerilmez
 * (yalnız ilçe/mahalle kısıtı kaldırılır).
 */
import { parseDemandCriteria, type CriteriaKey, type DemandCriteria } from "@/lib/demand-criteria";
import type { MatchDemand, MatchingWeights, MatchProperty } from "@/lib/matching";
import { scoreDemandMatches, type MatchFeedbackRow } from "@/lib/match-candidates";
import type { MatchStateRow } from "@/lib/match-state";

export const WIDEN_KINDS = ["budget10", "budget20", "drop_neighborhood", "drop_district", "rooms_any", "sqm10", "drop_required"] as const;
export type WidenKind = (typeof WIDEN_KINDS)[number];

export function isWidenKind(v: unknown): v is WidenKind {
  return typeof v === "string" && (WIDEN_KINDS as readonly string[]).includes(v);
}

/** Az eşleşme eşiği: bunun altındaki taleplere öneri gösterilir. */
export const WIDEN_SUGGEST_BELOW = 3;

type WidenableDemand = Pick<
  MatchDemand,
  "budget_max" | "budget_min" | "district_id" | "neighborhood_id" | "rooms" | "min_sqm" | "criteria"
>;

export type WidenPatch = {
  budget_max?: number;
  district_id?: null;
  neighborhood_id?: null;
  rooms?: null;
  min_sqm?: number;
  criteria?: DemandCriteria;
};

const roundBudget = (n: number) => (n >= 100_000 ? Math.round(n / 10_000) * 10_000 : Math.round(n / 100) * 100);

function withoutRequired(c: DemandCriteria, keys: CriteriaKey[]): DemandCriteria {
  return { ...c, required: c.required.filter((k) => !keys.includes(k)) };
}

/**
 * Varyantın talep sütunlarına yamaası (ya da uygulanamazsa null). "Olmazsa olmaz" anahtarları gevşetilen alanla
 * birlikte düşürülür (kaldırılan kritere zorunluluk asılı kalmasın).
 */
export function widenDemandPatch(demand: WidenableDemand, kind: WidenKind): WidenPatch | null {
  const criteria = parseDemandCriteria(demand.criteria);
  switch (kind) {
    case "budget10":
    case "budget20": {
      if (demand.budget_max == null || Number(demand.budget_max) <= 0) return null;
      const next = roundBudget(Number(demand.budget_max) * (kind === "budget10" ? 1.1 : 1.2));
      return next > Number(demand.budget_max) ? { budget_max: next } : null;
    }
    case "drop_neighborhood":
      return demand.neighborhood_id ? { neighborhood_id: null } : null;
    case "drop_district":
      return demand.district_id ? { district_id: null, neighborhood_id: null, criteria: withoutRequired(criteria, ["location"]) } : null;
    case "rooms_any":
      return demand.rooms ? { rooms: null, criteria: withoutRequired(criteria, ["rooms"]) } : null;
    case "sqm10": {
      if (demand.min_sqm == null || Number(demand.min_sqm) <= 0) return null;
      const next = Math.floor(Number(demand.min_sqm) * 0.9);
      return next > 0 && next < Number(demand.min_sqm) ? { min_sqm: next } : null;
    }
    case "drop_required":
      return criteria.required.length > 0 ? { criteria: { ...criteria, required: [] } } : null;
  }
}

const fmtMoney = (n: number) => `₺${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n)}`;

export function widenLabel(kind: WidenKind, patch: WidenPatch): string {
  switch (kind) {
    case "budget10":
      return `Üst bütçeyi %10 artırın (${fmtMoney(patch.budget_max ?? 0)})`;
    case "budget20":
      return `Üst bütçeyi %20 artırın (${fmtMoney(patch.budget_max ?? 0)})`;
    case "drop_neighborhood":
      return "Mahalle yerine tüm ilçeye bakın";
    case "drop_district":
      return "İlçe yerine tüm ile bakın";
    case "rooms_any":
      return "Oda sayısı şartını kaldırın";
    case "sqm10":
      return `En az m²'yi %10 düşürün (${patch.min_sqm} m²)`;
    case "drop_required":
      return "\"Olmazsa olmaz\" işaretlerini kaldırın";
  }
}

export type WidenSuggestion = {
  kind: WidenKind;
  label: string;
  /** Varyantla görünür eşleşme sayısı. */
  total: number;
  /** Bugüne göre kazanılan portföy sayısı. */
  gain: number;
  /** Kazanılan en iyi portföyler (önizleme). */
  preview: { id: string; title: string; score: number }[];
};

/**
 * Kazandıran varyantlar (kazanç sırasıyla, en fazla `limit`). Aynı kazancı veren bütçe adımlarından küçüğü tercih edilir.
 */
export function suggestWidening<D extends MatchDemand>(input: {
  demand: D;
  properties: readonly MatchProperty[];
  weights?: MatchingWeights | null;
  customerId: string | null;
  feedback?: readonly MatchFeedbackRow[];
  states?: readonly MatchStateRow[];
  limit?: number;
}): WidenSuggestion[] {
  const score = (d: D) =>
    scoreDemandMatches({
      demands: [d],
      properties: input.properties,
      weights: input.weights,
      customerOf: () => input.customerId,
      feedback: input.feedback,
      states: input.states,
    }).pairs;
  const base = score(input.demand);
  const baseIds = new Set(base.map((p) => p.property.id));
  const out: WidenSuggestion[] = [];
  for (const kind of WIDEN_KINDS) {
    const patch = widenDemandPatch(input.demand, kind);
    if (!patch) continue;
    const variant = { ...input.demand, ...patch } as D;
    const pairs = score(variant);
    const gained = pairs.filter((p) => !baseIds.has(p.property.id));
    if (gained.length === 0) continue;
    out.push({
      kind,
      label: widenLabel(kind, patch),
      total: pairs.length,
      gain: gained.length,
      preview: gained.slice(0, 3).map((p) => ({ id: p.property.id, title: p.property.title ?? p.property.property_code, score: p.score })),
    });
  }
  // budget20 yalnız budget10'dan fazla kazandırıyorsa kalır.
  const b10 = out.find((s) => s.kind === "budget10");
  const filtered = out.filter((s) => !(s.kind === "budget20" && b10 && s.gain <= b10.gain));
  filtered.sort((a, b) => b.gain - a.gain || WIDEN_KINDS.indexOf(a.kind) - WIDEN_KINDS.indexOf(b.kind));
  return filtered.slice(0, input.limit ?? 3);
}
