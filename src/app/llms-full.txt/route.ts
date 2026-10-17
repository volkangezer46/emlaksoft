import { getBaseUrl } from "@/lib/base-url";
import { guidePath } from "@/lib/guides/defaults";
import { isThinGuide } from "@/lib/guides/schema";
import { listPublishedGuidesForPage } from "@/lib/guides/store";
import { plainTextOf } from "@/lib/rich-text/core";
import { loadHubIndex } from "@/lib/seo/hubs/data";
import { hubDecision, hubTitle } from "@/lib/seo/hubs/rules";
import { buildLlmsFullTxt } from "@/lib/seo/robots-rules";
import { getHubSettings, getSeoSettings } from "@/lib/seo/store";

/**
 * llms-full.txt: llms.txt ile aynı anahtarla açılır (varsayılan KAPALI, 404). Yayındaki indekslenebilir (ince olmayan)
 * rehber yazılarının tam metni + indekslenen bölge sayfaları. Ofis/ilan ayrıntısı ve kişisel veri girmez.
 */
export async function GET() {
  const s = await getSeoSettings();
  if (!s.robots.llmsTxtEnabled) return new Response("Not found", { status: 404 });
  const [guides, hubSettings] = await Promise.all([listPublishedGuidesForPage().catch(() => []), getHubSettings()]);
  const hubs = hubSettings.enabled ? (await loadHubIndex().catch(() => ({ hubs: [] }))).hubs.filter((h) => hubDecision(h.count, hubSettings) === "index" && h.level !== "mahalle") : [];
  const body = buildLlmsFullTxt(s.global, s.robots, getBaseUrl(), s.pages, {
    guides: guides
      .filter((g) => !isThinGuide(g.content))
      .map((g) => ({ title: g.content.title, path: guidePath(g.entry.slug), description: g.content.seo.description, text: plainTextOf(g.content.body) })),
    hubs: hubs.slice(0, 300).map((h) => ({ title: hubTitle(h), path: h.path, count: h.count })),
  });
  if (body === null) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" } });
}
