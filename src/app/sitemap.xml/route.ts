import { getBaseUrl } from "@/lib/base-url";
import { getSitemapChunks } from "@/lib/seo/sitemap-data";
import { renderSitemapIndex, renderUrlset } from "@/lib/seo/sitemap-rules";

const HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400",
};

/**
 * Sitemap girişi. Tek parçaysa doğrudan urlset; büyürse (ayardaki parça başına URL sınırını aşınca)
 * sitemap indeksi döner ve parçalar /sitemap/<n>.xml adresindedir (protokol sınırı 50.000 URL / 50 MB).
 * Veri `src/lib/seo/sitemap-data.ts` içindedir; token'lı/noindex/demo yüzeyler orada süzülür.
 */
export async function GET() {
  const { chunks } = await getSitemapChunks();
  if (chunks.length <= 1) return new Response(renderUrlset(chunks[0] ?? []), { headers: HEADERS });
  const base = getBaseUrl();
  return new Response(renderSitemapIndex(chunks.map((_, i) => ({ url: `${base}/sitemap/${i + 1}.xml` }))), { headers: HEADERS });
}
