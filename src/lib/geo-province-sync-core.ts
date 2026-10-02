export type GeoSourceProvince = {
  id: number;
  name: string;
  population: number | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type GeoSourceDistrict = {
  id: number;
  name: string;
  provinceId: number;
  population: number | null;
};

export type GeoSourceNeighborhood = {
  id: number;
  name: string;
  provinceId: number;
  districtId: number;
  population: number | null;
  postalCode: string | null;
};

export type ExistingGeoDistrict = {
  id: string;
  name: string;
  source_id: number | null;
  population: number | null;
};

export type ExistingGeoNeighborhood = {
  id: string;
  district_id: string;
  name: string;
  source_id: number | null;
  postal_code: string | null;
  population: number | null;
};

export type DistrictInsert = {
  name: string;
  source_id: number;
  population: number | null;
};

export type DistrictUpdate = DistrictInsert & { id: string };

export type MappedSourceNeighborhood = GeoSourceNeighborhood & {
  databaseDistrictId: string;
};

export type NeighborhoodInsert = {
  district_id: string;
  name: string;
  source_id: number;
  postal_code: string | null;
  population: number | null;
};

export type NeighborhoodUpdate = NeighborhoodInsert & { id: string };

export type GeoPlanConflict = {
  sourceId: number;
  existingId: string;
  kind: "name_owned_by_other_source";
};

export function normalizeGeoName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
}

function sameNullable<T>(left: T | null, right: T | null): boolean {
  return left === right;
}

export function planDistrictChanges(
  source: readonly GeoSourceDistrict[],
  existing: readonly ExistingGeoDistrict[],
): {
  inserts: DistrictInsert[];
  updates: DistrictUpdate[];
  conflicts: GeoPlanConflict[];
  unchanged: number;
  preservedExtra: number;
} {
  const bySourceId = new Map<number, ExistingGeoDistrict>();
  const legacyByName = new Map<string, ExistingGeoDistrict>();
  const ownedByName = new Map<string, ExistingGeoDistrict>();
  for (const row of existing) {
    if (row.source_id !== null) bySourceId.set(row.source_id, row);
    if (row.source_id === null) legacyByName.set(normalizeGeoName(row.name), row);
    else ownedByName.set(normalizeGeoName(row.name), row);
  }

  const matched = new Set<string>();
  const inserts: DistrictInsert[] = [];
  const updates: DistrictUpdate[] = [];
  const conflicts: GeoPlanConflict[] = [];
  let unchanged = 0;

  for (const row of source) {
    const normalizedName = normalizeGeoName(row.name);
    const current = bySourceId.get(row.id) ?? legacyByName.get(normalizedName);
    const desired: DistrictInsert = {
      name: row.name,
      source_id: row.id,
      population: row.population,
    };
    if (!current) {
      const occupied = ownedByName.get(normalizedName);
      if (occupied) {
        conflicts.push({
          sourceId: row.id,
          existingId: occupied.id,
          kind: "name_owned_by_other_source",
        });
        continue;
      }
      inserts.push(desired);
      continue;
    }
    matched.add(current.id);
    if (
      current.name !== desired.name
      || current.source_id !== desired.source_id
      || !sameNullable(current.population, desired.population)
    ) {
      updates.push({ id: current.id, ...desired });
    } else {
      unchanged += 1;
    }
  }

  return {
    inserts,
    updates,
    conflicts,
    unchanged,
    preservedExtra: existing.filter((row) => !matched.has(row.id)).length,
  };
}

export function planNeighborhoodChanges(
  source: readonly MappedSourceNeighborhood[],
  existing: readonly ExistingGeoNeighborhood[],
): {
  inserts: NeighborhoodInsert[];
  updates: NeighborhoodUpdate[];
  conflicts: GeoPlanConflict[];
  unchanged: number;
  preservedExtra: number;
} {
  const bySourceId = new Map<number, ExistingGeoNeighborhood>();
  const legacyByDistrictAndName = new Map<string, ExistingGeoNeighborhood>();
  const ownedByDistrictAndName = new Map<string, ExistingGeoNeighborhood>();
  for (const row of existing) {
    if (row.source_id !== null) bySourceId.set(row.source_id, row);
    const key = `${row.district_id}::${normalizeGeoName(row.name)}`;
    if (row.source_id === null) legacyByDistrictAndName.set(key, row);
    else ownedByDistrictAndName.set(key, row);
  }

  const matched = new Set<string>();
  const inserts: NeighborhoodInsert[] = [];
  const updates: NeighborhoodUpdate[] = [];
  const conflicts: GeoPlanConflict[] = [];
  let unchanged = 0;

  for (const row of source) {
    const nameKey = `${row.databaseDistrictId}::${normalizeGeoName(row.name)}`;
    const current = bySourceId.get(row.id) ?? legacyByDistrictAndName.get(nameKey);
    const desired: NeighborhoodInsert = {
      district_id: row.databaseDistrictId,
      name: row.name,
      source_id: row.id,
      postal_code: row.postalCode,
      population: row.population,
    };
    if (!current) {
      const occupied = ownedByDistrictAndName.get(nameKey);
      if (occupied) {
        conflicts.push({
          sourceId: row.id,
          existingId: occupied.id,
          kind: "name_owned_by_other_source",
        });
        continue;
      }
      inserts.push(desired);
      continue;
    }
    matched.add(current.id);
    if (
      current.district_id !== desired.district_id
      || current.name !== desired.name
      || current.source_id !== desired.source_id
      || !sameNullable(current.postal_code, desired.postal_code)
      || !sameNullable(current.population, desired.population)
    ) {
      updates.push({ id: current.id, ...desired });
    } else {
      unchanged += 1;
    }
  }

  return {
    inserts,
    updates,
    conflicts,
    unchanged,
    preservedExtra: existing.filter((row) => !matched.has(row.id)).length,
  };
}
