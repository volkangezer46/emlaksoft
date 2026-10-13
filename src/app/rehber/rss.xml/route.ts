import { getBaseUrl } from "@/lib/base-url";
import { renderGuideRss } from "@/lib/guides/rss";
import { listPublishedGuidesForPage } from "@/lib/guides/store";

/** /rehber/rss.xml: yayındaki son 50 yazı (RSS 2.0). ISR 300 sn; yayında yol düşer. */
export const revalidate = 300;

export async function GET() {
  const xml = renderGuideRss(getBaseUrl(), await listPublishedGuidesForPage());
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}
