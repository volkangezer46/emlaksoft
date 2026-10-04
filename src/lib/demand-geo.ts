import type { DemandCriteria } from "@/lib/demand-criteria";

/** Bölge zinciri doğrulaması artık TEK MERKEZDE: `validateGeoChain` (@/lib/geo/reader). */

type CriteriaPresence = {
  property_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  province_id: string | null;
  district_id: string | null;
  neighborhood_id: string | null;
};

/**
 * Sütunlar değişince `criteria.required` artık değeri kalmayan anahtarı "zorunlu" tutmasın:
 * değeri olmayan kriterler zorunlu listesinden düşürülür (yalnız sütunlardan bilinenler).
 */
export function pruneRequiredKeys(criteria: DemandCriteria, cols: CriteriaPresence): DemandCriteria {
  const hasLocation =
    Boolean(cols.province_id || cols.district_id || cols.neighborhood_id) || (criteria.extra_locations?.length ?? 0) > 0;
  const present: Partial<Record<string, boolean>> = {
    property_type: cols.property_type != null,
    budget: cols.budget_min != null || cols.budget_max != null,
    rooms: cols.rooms != null,
    sqm: cols.min_sqm != null || criteria.max_sqm != null,
    location: hasLocation,
  };
  const required = (criteria.required ?? []).filter((k) => present[k] !== false);
  return { ...criteria, required };
}
