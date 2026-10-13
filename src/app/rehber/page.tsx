import type { Metadata } from "next";
import { ToolsShell } from "@/components/tools/tools-shell";
import { getBaseUrl } from "@/lib/base-url";
import { isThinGuide } from "@/lib/guides/schema";
import { listPublishedGuidesForPage } from "@/lib/guides/store";
import { GUIDE_HUB_DESCRIPTION, GUIDE_HUB_TITLE, guideHubMetadata } from "@/lib/guides/view";
import { buildMetadata } from "@/lib/seo/store";
import { CategoryNav, ComingSoon, Crumbs, GuideGrid, categoryCounts } from "./guide-ui";

/**
 * /rehber: yayındaki yazıların listesi. Sunucuda ISR (300 sn; yayında `guides` etiketi + yol düşer), istemci bileşeni yok.
 * Yayında indekslenebilir (ince olmayan) yazı yoksa noindex; hiç yazı yoksa "Yakında" gösterilir.
 */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const guides = await listPublishedGuidesForPage();
  return buildMetadata("/rehber", guideHubMetadata(getBaseUrl(), guides.filter((g) => !isThinGuide(g.content)).length));
}

export default async function GuideHubPage() {
  const guides = await listPublishedGuidesForPage();
  return (
    <ToolsShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Crumbs items={[{ name: "Ana sayfa", path: "/" }, { name: GUIDE_HUB_TITLE }]} />
        <h1 className="mt-1 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">{GUIDE_HUB_TITLE}</h1>
        <p className="mt-3 max-w-2xl text-text-muted">{GUIDE_HUB_DESCRIPTION}</p>
        <a href="/rehber/rss.xml" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
          RSS ile takip edin
        </a>
        {guides.length === 0 ? (
          <ComingSoon title="Rehber yazılarımız" />
        ) : (
          <>
            <CategoryNav counts={categoryCounts(guides)} />
            <GuideGrid guides={guides} />
          </>
        )}
      </div>
    </ToolsShell>
  );
}
