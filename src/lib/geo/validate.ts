/**
 * Bölge zinciri doğrulaması — SAF çekirdek (arama fonksiyonları dışarıdan verilir; birim testli).
 * İl → ilçe → mahalle gerçek hiyerarşiye uymalı; alt seviye üst seviyesiz olamaz.
 * Okuma hatasında (lookup fırlatırsa) güvenli tarafta kalınır: reddedilir.
 */
import type { GeoChain, GeoDistrict, GeoNeighborhood, GeoProvince } from "./types";

export type GeoLookup = {
  province(id: string): Promise<GeoProvince | null>;
  district(id: string): Promise<GeoDistrict | null>;
  neighborhood(id: string): Promise<GeoNeighborhood | null>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function validateChain(lookup: GeoLookup, chain: GeoChain, opts?: { allowInactive?: boolean }): Promise<string | null> {
  const province = chain.province_id || null;
  const district = chain.district_id || null;
  const neighborhood = chain.neighborhood_id || null;
  for (const id of [province, district, neighborhood]) {
    if (id && !UUID_RE.test(id)) return "Bölge seçimi geçersiz.";
  }
  if (district && !province) return "İlçe seçmek için il seçilmelidir.";
  if (neighborhood && !district) return "Mahalle seçmek için ilçe seçilmelidir.";
  try {
    if (province) {
      const p = await lookup.province(province);
      if (!p) return "Seçilen il bulunamadı.";
      if (!p.isActive && !opts?.allowInactive) return "Seçilen il artık kullanılmıyor.";
    }
    if (district) {
      const d = await lookup.district(district);
      if (!d) return "Seçilen ilçe bulunamadı.";
      if (d.provinceId !== province) return "Seçilen ilçe, seçilen ile ait değil.";
      if (!d.isActive && !opts?.allowInactive) return "Seçilen ilçe artık kullanılmıyor.";
    }
    if (neighborhood) {
      const n = await lookup.neighborhood(neighborhood);
      if (!n) return "Seçilen mahalle bulunamadı.";
      if (n.districtId !== district) return "Seçilen mahalle, seçilen ilçeye ait değil.";
      if (!n.isActive && !opts?.allowInactive) return "Seçilen mahalle artık kullanılmıyor.";
    }
  } catch {
    return "Bölge doğrulanamadı. Lütfen tekrar deneyin.";
  }
  return null;
}
