import { cache } from "react";
import { getAllDistricts, getNeighborhoods, getProvinces } from "@/lib/geo/reader";
import type { GeoItem } from "./parse";

/**
 * Doğal dil ayrıştırıcısının konum listeleri — TEK MERKEZDEN (src/lib/geo, önbellekli okuyucular).
 * 81 il + ~973 ilçe küçük; mahalleler (31.922) yalnız bulunan ilçe için çekilir.
 */

export const loadNlProvincesAndDistricts = cache(async (): Promise<{ provinces: GeoItem[]; districts: GeoItem[] }> => {
  const [provinces, districts] = await Promise.all([getProvinces({ includeInactive: true }), getAllDistricts()]);
  return {
    provinces: provinces.map((p) => ({ id: p.id, name: p.name })),
    districts: districts.filter((d) => d.isActive).map((d) => ({ id: d.id, name: d.name, parentId: d.provinceId as string | null })),
  };
});

export async function loadNlNeighborhoods(districtId: string): Promise<GeoItem[]> {
  const rows = await getNeighborhoods(districtId);
  return rows.slice(0, 400).map((n) => ({ id: n.id, name: n.name, parentId: n.districtId as string | null }));
}
