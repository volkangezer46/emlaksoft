"use server";

import { getDistrictOptions, getNeighborhoodOptions } from "@/lib/geo/reader";
import type { GeoOption } from "@/lib/geo/types";

export type { GeoOption };

/**
 * İl → ilçe → mahalle kademeli seçimin veri ucu (GeoSelect). Veri kaynağı TEK MERKEZ:
 * src/lib/geo (önbellekli okuyucular). Yalnız AKTİF kayıtlar döner (pasif = yeni seçimde görünmez).
 *
 * Tüm mahalleleri önden yüklemiyoruz (31 bin kayıt, ~1,5 MB): il seçilince ilçeler, ilçe seçilince
 * mahalleler gelir; sonrasında arama istemcide.
 */

export async function listDistricts(provinceId: string): Promise<GeoOption[]> {
  return getDistrictOptions(provinceId);
}

export async function listNeighborhoods(districtId: string): Promise<GeoOption[]> {
  return getNeighborhoodOptions(districtId);
}
