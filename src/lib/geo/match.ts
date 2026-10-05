/**
 * Ad eşleştirme çekirdeği — SAF (veritabanı yok), birim testli.
 * Sıra: tam eşleşme → alias → yazım toleransı. Aynı katmanda birden çok aday = belirsiz.
 */
import { editDistance, geoKey, typoBudget } from "./normalize";
import type { GeoLevel } from "./types";

export type MatchCandidate = { id: string; name: string };
export type MatchAlias = { entityId: string; alias: string };

export type MatchResult =
  | { status: "ok"; id: string; via: "exact" | "alias" | "fuzzy" }
  | { status: "ambiguous"; ids: string[] }
  | { status: "none" };

export function pickMatch(
  text: string,
  level: GeoLevel,
  candidates: readonly MatchCandidate[],
  aliases: readonly MatchAlias[] = [],
): MatchResult {
  const key = geoKey(text, level);
  if (!key) return { status: "none" };

  const exact = candidates.filter((c) => geoKey(c.name, level) === key);
  if (exact.length === 1) return { status: "ok", id: exact[0].id, via: "exact" };
  if (exact.length > 1) return { status: "ambiguous", ids: exact.map((c) => c.id) };

  const ids = new Set(candidates.map((c) => c.id));
  const viaAlias = [...new Set(aliases.filter((a) => ids.has(a.entityId) && geoKey(a.alias, level) === key).map((a) => a.entityId))];
  if (viaAlias.length === 1) return { status: "ok", id: viaAlias[0], via: "alias" };
  if (viaAlias.length > 1) return { status: "ambiguous", ids: viaAlias };

  const budget = typoBudget(key);
  if (budget > 0) {
    let best = budget + 1;
    let bestIds: string[] = [];
    for (const c of candidates) {
      const d = editDistance(key, geoKey(c.name, level), budget);
      if (d > budget) continue;
      if (d < best) {
        best = d;
        bestIds = [c.id];
      } else if (d === best) bestIds.push(c.id);
    }
    if (bestIds.length === 1) return { status: "ok", id: bestIds[0], via: "fuzzy" };
    if (bestIds.length > 1) return { status: "ambiguous", ids: bestIds };
  }
  return { status: "none" };
}
