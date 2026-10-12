import { getAllDistricts } from "@/lib/geo/reader";
import { geoFold } from "@/lib/geo/normalize";

/**
 * Portalın konum metninden ("Kadıköy / İstanbul", "İstanbul, Kadıköy, Moda Mh.") ilçe çözümü. Sunucu portala gitmez;
 * yalnız verilen metin merkezi coğrafya okuyucusuyla (`src/lib/geo/reader.ts`) eşlenir. Aynı adlı birden çok ilçe
 * (belirsiz) ya da bulunamazsa null — yanlış ilçe uydurulmaz.
 */
export function locationTokens(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/[\/,›>|\-–]/)
    .map((t) => t.replace(/\b(mah(alle(si)?)?|mh)\.?$/i, "").trim())
    .filter((t) => t.length >= 3 && t.length <= 40)
    .slice(0, 5);
}

export async function resolveDistrict(text: string | null | undefined): Promise<{ districtId: string; provinceId: string } | null> {
  const tokens = locationTokens(text).map((t) => geoFold(t));
  if (tokens.length === 0) return null;
  const districts = (await getAllDistricts().catch(() => [])).filter((d) => d.isActive);
  for (const token of tokens) {
    const hits = districts.filter((d) => geoFold(d.name) === token);
    if (hits.length === 1) return { districtId: hits[0].id, provinceId: hits[0].provinceId };
  }
  return null;
}
