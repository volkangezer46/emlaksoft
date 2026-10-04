import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickMatch, type MatchAlias } from "./match";
import { getAllDistricts, getDistrict, getNeighborhood, getNeighborhoods, getProvince, getProvinces, validateGeoChain } from "./reader";
import { GEO_CACHE_TAG, type GeoLevel, type GeoResolution, type GeoResolveInput, type ResolvedGeo } from "./types";

/**
 * Alias dizini (eski ad → güncel kayıt, yazım varyantı). `geo_aliases` tablosu henüz
 * yoksa (migration uygulanmadı) BOŞ döner; çözümleme bugünkü gibi çalışır.
 * `valid_to` geçmiş olsa bile eski ad çözülür (eski kayıtlar bulunabilsin).
 */
const loadAliases = unstable_cache(
  async (): Promise<Record<GeoLevel, MatchAlias[]>> => {
    const out: Record<GeoLevel, MatchAlias[]> = { province: [], district: [], neighborhood: [] };
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.from("geo_aliases").select("level, entity_id, alias").limit(20000);
      if (error || !data) return out;
      for (const r of data as Array<{ level: GeoLevel; entity_id: string; alias: string }>) {
        if (out[r.level]) out[r.level].push({ entityId: r.entity_id, alias: r.alias });
      }
    } catch {
      /* tablo yok */
    }
    return out;
  },
  ["geo-aliases-v1"],
  { revalidate: 900, tags: [GEO_CACHE_TAG] },
);

const EMPTY: ResolvedGeo = {
  provinceId: null, provinceName: null, districtId: null, districtName: null, neighborhoodId: null, neighborhoodName: null,
};

/**
 * TEK ÇÖZÜMLEME GİRİŞİ: serbest metin (il/ilçe/mahalle) → kimlik zinciri.
 * İçe aktarma, public form, webhook, eski serbest metin kayıtlarının eşleştirilmesi
 * hep buradan geçer. Belirsiz/bulunamayan sonuç ASLA tahmin edilmez.
 * Plaka kodu ("34") il olarak kabul edilir.
 */
export async function resolveGeo(input: GeoResolveInput): Promise<GeoResolution> {
  const provText = (input.province ?? "").trim();
  const distText = (input.district ?? "").trim();
  const neighText = (input.neighborhood ?? "").trim();
  if (!provText && !distText && !neighText) return { status: "unmatched", reason: "Bölge bilgisi boş." };

  const [provinces, districts, aliases] = await Promise.all([getProvinces({ includeInactive: true }), getAllDistricts(), loadAliases()]);
  let geo: ResolvedGeo = { ...EMPTY };
  let via: "exact" | "alias" | "fuzzy" = "exact";
  const bump = (v: "exact" | "alias" | "fuzzy") => {
    if (v === "fuzzy" || (v === "alias" && via === "exact")) via = v;
  };

  if (provText) {
    const plate = /^\d{1,2}$/.test(provText) ? Number(provText) : null;
    const byPlate = plate ? provinces.find((p) => p.plateCode === plate) : null;
    if (byPlate) {
      geo = { ...geo, provinceId: byPlate.id, provinceName: byPlate.name };
    } else {
      const m = pickMatch(provText, "province", provinces, aliases.province);
      if (m.status === "none") return { status: "unmatched", reason: `İl bulunamadı: "${provText}"` };
      if (m.status === "ambiguous") {
        return { status: "ambiguous", candidates: m.ids.map((id) => ({ ...EMPTY, provinceId: id, provinceName: provinces.find((p) => p.id === id)?.name ?? null })) };
      }
      bump(m.via);
      geo = { ...geo, provinceId: m.id, provinceName: provinces.find((p) => p.id === m.id)?.name ?? null };
    }
  }

  if (distText) {
    const pool = geo.provinceId ? districts.filter((d) => d.provinceId === geo.provinceId) : districts;
    const m = pickMatch(distText, "district", pool, aliases.district);
    if (m.status === "none") return { status: "unmatched", reason: `İlçe bulunamadı: "${distText}"` };
    if (m.status === "ambiguous") {
      return {
        status: "ambiguous",
        candidates: m.ids.map((id) => {
          const d = districts.find((x) => x.id === id);
          const p = provinces.find((x) => x.id === d?.provinceId);
          return { ...EMPTY, provinceId: p?.id ?? null, provinceName: p?.name ?? null, districtId: id, districtName: d?.name ?? null };
        }),
      };
    }
    bump(m.via);
    const d = districts.find((x) => x.id === m.id);
    const p = provinces.find((x) => x.id === d?.provinceId);
    if (!d || !p) return { status: "unmatched", reason: `İlçe kaydı tutarsız: "${distText}"` };
    geo = { ...geo, provinceId: p.id, provinceName: p.name, districtId: d.id, districtName: d.name };
  }

  if (neighText) {
    if (!geo.districtId) return { status: "unmatched", reason: "Mahalle için ilçe gerekli." };
    const pool = await getNeighborhoods(geo.districtId, { includeInactive: true });
    const m = pickMatch(neighText, "neighborhood", pool, aliases.neighborhood);
    if (m.status === "none") return { status: "unmatched", reason: `Mahalle bulunamadı: "${neighText}"` };
    if (m.status === "ambiguous") {
      return { status: "ambiguous", candidates: m.ids.map((id) => ({ ...geo, neighborhoodId: id, neighborhoodName: pool.find((n) => n.id === id)?.name ?? null })) };
    }
    bump(m.via);
    geo = { ...geo, neighborhoodId: m.id, neighborhoodName: pool.find((n) => n.id === m.id)?.name ?? null };
  }

  return { status: "ok", geo, via };
}

/**
 * Sunucuda form doğrulama: gelen il/ilçe/mahalle KİMLİKLERİNİ doğrular ve gösterim
 * adlarıyla birlikte döndürür (kayıtta kimlik + ad birlikte saklanır).
 */
export async function resolveChainForSave(chain: {
  province_id?: string | null;
  district_id?: string | null;
  neighborhood_id?: string | null;
}): Promise<{ error: string } | { geo: ResolvedGeo }> {
  const err = await validateGeoChain(chain, { allowInactive: false });
  if (err) return { error: err };
  const [p, d, n] = await Promise.all([
    getProvince(chain.province_id), getDistrict(chain.district_id), getNeighborhood(chain.neighborhood_id),
  ]);
  return {
    geo: {
      provinceId: p?.id ?? null, provinceName: p?.name ?? null,
      districtId: d?.id ?? null, districtName: d?.name ?? null,
      neighborhoodId: n?.id ?? null, neighborhoodName: n?.name ?? null,
    },
  };
}

/**
 * Ofis/profil formları için il-ilçe kararı: kimlikler doğrulanır; yalnız eski serbest metin gelirse
 * coğrafya servisiyle çözülür (çözülemezse REDDEDİLİR, tahmin yok). Hiçbir şey gönderilmediyse null döner.
 */
export async function resolveOfficeGeo(input: {
  provinceId?: string | null;
  districtId?: string | null;
  legacyCity?: string | null;
}): Promise<{ error: string } | { provinceId: string | null; districtId: string | null; provinceName: string | null }> {
  const provinceId = (input.provinceId ?? "").trim();
  const districtId = (input.districtId ?? "").trim();
  const legacy = (input.legacyCity ?? "").trim();
  if (provinceId) {
    const r = await resolveChainForSave({ province_id: provinceId, district_id: districtId || null });
    if ("error" in r) return r;
    return { provinceId: r.geo.provinceId, districtId: r.geo.districtId, provinceName: r.geo.provinceName };
  }
  if (districtId) return { error: "İlçe seçmek için il seçilmelidir." };
  if (legacy) {
    const r = await resolveGeo({ province: legacy });
    if (r.status !== "ok") return { error: `İl bulunamadı: "${legacy}". Listeden bir il seçin.` };
    return { provinceId: r.geo.provinceId, districtId: null, provinceName: r.geo.provinceName };
  }
  return { provinceId: null, districtId: null, provinceName: null };
}
