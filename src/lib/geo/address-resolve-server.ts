import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAllDistricts, getNeighborhoods, getProvinces } from "./reader";
import { loadGeoAliases } from "./resolve";
import { addressInputKey, resolveAddressCore, type AddressIndex, type AddressInput, type AddressResolution } from "./address-resolve";

/**
 * Sunucu sarmalayıcısı: coğrafya okuyucularıyla (önbellekli) `resolveAddressCore` çalıştırır.
 * Kullananlar: içe aktarma (il/ilçe/mahalle + adres sütunları), başvuru alımı (lead-intake konum metni).
 */

/**
 * Toplu çözümleyici: aynı adres metni bir kez çözülür, ilçe başına mahalle listesi bir kez okunur.
 * İçe aktarma parçası (250 satır) için bir tane oluşturulur.
 */
export async function createAddressResolver(): Promise<(input: AddressInput) => Promise<AddressResolution>> {
  const [provinces, districts, aliases] = await Promise.all([
    getProvinces({ includeInactive: true }),
    getAllDistricts(),
    loadGeoAliases(),
  ]);
  const hoods = new Map<string, Promise<readonly { id: string; name: string }[]>>();
  const index: AddressIndex = {
    provinces,
    districts,
    aliases,
    neighborhoodsOf: (districtId) => {
      let p = hoods.get(districtId);
      if (!p) {
        p = getNeighborhoods(districtId, { includeInactive: true });
        hoods.set(districtId, p);
      }
      return p;
    },
  };
  const memo = new Map<string, Promise<AddressResolution>>();
  return (input) => {
    const key = addressInputKey(input);
    let r = memo.get(key);
    if (!r) {
      r = resolveAddressCore(input, index);
      memo.set(key, r);
    }
    return r;
  };
}

/** Tek adres çözümü (form yardımcısı, başvuru alımı). */
export async function resolveAddressText(input: AddressInput): Promise<AddressResolution> {
  const resolve = await createAddressResolver();
  return resolve(input);
}

type CentroidClient = Pick<SupabaseClient, "from">;

export type AreaCentroid = { lat: number; lng: number; level: "neighborhood" | "district" };

/**
 * Harita yedeği: koordinatı olmayan portföy için mahalle (yoksa ilçe) merkez noktası.
 * Coğrafya tabloları herkese açık okunur; çağıranın istemcisi kullanılır. Koordinatı olmayan bölge atlanır.
 */
export async function loadAreaCentroids(
  supabase: CentroidClient,
  ids: { neighborhoodIds: Iterable<string>; districtIds: Iterable<string> },
): Promise<{ neighborhoods: Map<string, AreaCentroid>; districts: Map<string, AreaCentroid> }> {
  const out = { neighborhoods: new Map<string, AreaCentroid>(), districts: new Map<string, AreaCentroid>() };
  const read = async (table: string, list: string[], level: AreaCentroid["level"], into: Map<string, AreaCentroid>) => {
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await supabase.from(table).select("id, lat, lng").in("id", list.slice(i, i + 200));
      if (error || !data) return;
      for (const row of data as { id: string; lat: number | null; lng: number | null }[]) {
        const lat = Number(row.lat);
        const lng = Number(row.lng);
        if (row.lat == null || row.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        into.set(row.id, { lat, lng, level });
      }
    }
  };
  const n = [...new Set(ids.neighborhoodIds)];
  const d = [...new Set(ids.districtIds)];
  await Promise.all([
    n.length ? read("geo_neighborhoods", n, "neighborhood", out.neighborhoods) : null,
    d.length ? read("geo_districts", d, "district", out.districts) : null,
  ]);
  return out;
}
