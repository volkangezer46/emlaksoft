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

// Açık referans verisi (action-gate-audit muafiyeti): kimlik kapısı yok; ama anahtar UUID değilse
// önbellek anahtarı/admin sorgusu üretilmez (rastgele dizelerle önbellek şişirme ve boş sorgu yok).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listDistricts(provinceId: string): Promise<GeoOption[]> {
  if (typeof provinceId !== "string" || !UUID_RE.test(provinceId)) return [];
  return getDistrictOptions(provinceId);
}

export async function listNeighborhoods(districtId: string): Promise<GeoOption[]> {
  if (typeof districtId !== "string" || !UUID_RE.test(districtId)) return [];
  return getNeighborhoodOptions(districtId);
}
