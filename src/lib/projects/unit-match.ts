/**
 * PF-06 — Proje daireleri ↔ alıcı talepleri. SAF modül: müsait daireleri eşleşme motorunun portföy biçimine çevirir
 * ve skorlanmış çiftleri talep başına gruplar. Skor kuralı TEK kaynaktır (`scoreDemandMatches` / `scoreDemandProperty`):
 * ofis ağırlıkları, olmazsa olmaz kriterler, ±%10 bütçe esnekliği, gösterim eşiği portföy eşleşmesiyle AYNI.
 */
import type { MatchProperty, MatchResult } from "@/lib/matching";

export type MatchableProject = { id: string; name: string; province_id: string | null; district_id: string | null };

export type MatchableUnit = {
  id: string;
  block: string | null;
  floor: number | null;
  unit_no: string;
  rooms: string | null;
  gross_m2: number | string | null;
  list_price: number | string | null;
  status: string;
};

/** Proje dairesi = satılık konut (daire). Yalnız müsait daireler aday olur. */
export function unitToMatchProperty(project: MatchableProject, unit: MatchableUnit): MatchProperty {
  return {
    id: unit.id,
    property_code: unitLabel(unit),
    title: `${project.name} — ${unitLabel(unit)}`,
    transaction_type: "Satılık",
    property_type: "Daire",
    status: "live",
    list_price: unit.list_price != null ? Number(unit.list_price) : null,
    province_id: project.province_id,
    district_id: project.district_id,
    neighborhood_id: null,
    features: {
      rooms: unit.rooms,
      sqm: unit.gross_m2 != null ? Number(unit.gross_m2) : null,
      floor: unit.floor,
    },
  };
}

export function unitLabel(unit: Pick<MatchableUnit, "block" | "unit_no">): string {
  return unit.block ? `${unit.block} Blok ${unit.unit_no}` : `Daire ${unit.unit_no}`;
}

export function matchableUnits(project: MatchableProject, units: readonly MatchableUnit[]): MatchProperty[] {
  return units.filter((u) => u.status === "available").map((u) => unitToMatchProperty(project, u));
}

export type UnitMatchPair<D> = {
  demand: D;
  property: MatchProperty;
  score: number;
  tier: MatchResult["tier"];
};

export type ProjectBuyer<D> = {
  demand: D;
  best: number;
  tier: MatchResult["tier"];
  /** En iyi daireler (skor sırasıyla, en çok `limit`). */
  units: Array<{ id: string; label: string; score: number; price: number | null; rooms: string | null }>;
  unitCount: number;
};

/** Talep başına grupla: en iyi skor, uyan daire sayısı, ilk N daire. Sıra: en iyi skor ↓, sonra uyan daire sayısı ↓. */
export function groupBuyers<D extends { id: string }>(pairs: readonly UnitMatchPair<D>[], limit = 3): ProjectBuyer<D>[] {
  const byDemand = new Map<string, ProjectBuyer<D>>();
  for (const p of pairs) {
    let g = byDemand.get(p.demand.id);
    if (!g) {
      g = { demand: p.demand, best: 0, tier: p.tier, units: [], unitCount: 0 };
      byDemand.set(p.demand.id, g);
    }
    g.unitCount += 1;
    if (p.score > g.best) {
      g.best = p.score;
      g.tier = p.tier;
    }
    g.units.push({
      id: p.property.id,
      label: p.property.property_code,
      score: p.score,
      price: p.property.list_price,
      rooms: p.property.features?.rooms ?? null,
    });
  }
  const out = [...byDemand.values()];
  for (const g of out) {
    g.units.sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));
    g.units = g.units.slice(0, limit);
  }
  return out.sort((a, b) => b.best - a.best || b.unitCount - a.unitCount);
}
