import { getSitemapChunks } from "@/lib/seo/sitemap-data";
import { renderUrlset } from "@/lib/seo/sitemap-rules";

const HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400",
};

/** Sitemap parçası: /sitemap/1.xml, /sitemap/2.xml ... (yalnız indeks modunda kullanılır). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const raw = (await ctx.params).id;
  const m = /^(\d{1,4})\.xml$/.exec(raw);
  if (!m) return new Response("Not found", { status: 404 });
  const index = Number(m[1]) - 1;
  const { chunks } = await getSitemapChunks();
  const chunk = chunks.length > 1 ? chunks[index] : undefined;
  if (!chunk) return new Response("Not found", { status: 404 });
  return new Response(renderUrlset(chunk), { headers: HEADERS });
}
