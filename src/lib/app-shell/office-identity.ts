import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Ofis KİMLİK KARTI verisi (yan menü ofis kartı + ana ekran hava durumu): ad, şehir, logo ve ilin koordinatı.
 * İstek başına TEK sorgu (React `cache`), kabuk modelini BEKLETMEZ: kart kendi Suspense sınırında akar
 * (yedek: yalnız ofis adı). Şehir önce ofisin il kaydından (geo_provinces), yoksa serbest `city` alanından.
 * Logo yalnız https adresiyse kullanılır (Storage public URL). Hata → null (kart yedekteki gibi kalır).
 */
export type OfficeIdentity = {
  name: string;
  city: string | null;
  logoUrl: string | null;
  coords: { lat: number; lng: number } | null;
};

type Row = {
  name: string | null;
  city?: string | null;
  logo_url?: string | null;
  province?: { name: string | null; lat: number | null; lng: number | null } | { name: string | null; lat: number | null; lng: number | null }[] | null;
};

const safeUrl = (u: string | null | undefined): string | null => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

export const loadOfficeIdentity = cache(async (tenantId: string | null): Promise<OfficeIdentity | null> => {
  if (!tenantId) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tenants")
      .select("name, city, logo_url, province:geo_provinces(name, lat, lng)")
      .eq("id", tenantId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as Row;
    const prov = Array.isArray(row.province) ? (row.province[0] ?? null) : (row.province ?? null);
    const lat = prov?.lat;
    const lng = prov?.lng;
    return {
      name: row.name?.trim() || "Ofis",
      city: prov?.name?.trim() || row.city?.trim() || null,
      logoUrl: safeUrl(row.logo_url),
      coords: typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    };
  } catch {
    return null;
  }
});
