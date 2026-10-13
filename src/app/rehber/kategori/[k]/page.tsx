import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolsShell } from "@/components/tools/tools-shell";
import { getBaseUrl } from "@/lib/base-url";
import { GUIDE_CATEGORIES, GUIDE_CATEGORY_DESCRIPTION, GUIDE_CATEGORY_LABEL, isGuideCategory, isThinGuide } from "@/lib/guides/schema";
import { listPublishedGuidesForPage } from "@/lib/guides/store";
import { GUIDE_HUB_TITLE, guideCategoryMetadata } from "@/lib/guides/view";
import { buildMetadata } from "@/lib/seo/store";
import { CategoryNav, ComingSoon, Crumbs, GuideGrid, categoryCounts } from "../../guide-ui";

/** /rehber/kategori/<k>: sabit kategoriler (enum), ISR. İndekslenebilir yazı yoksa noindex + "Yakında". */
export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDE_CATEGORIES.map((k) => ({ k }));
}

type Props = { params: Promise<{ k: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { k } = await params;
  if (!isGuideCategory(k)) return {};
  const guides = (await listPublishedGuidesForPage()).filter((g) => g.entry.category === k);
  return buildMetadata(`/rehber/kategori/${k}`, guideCategoryMetadata(getBaseUrl(), k, guides.filter((g) => !isThinGuide(g.content)).length));
}

export default async function GuideCategoryPage({ params }: Props) {
  const { k } = await params;
  if (!isGuideCategory(k)) notFound();
  const all = await listPublishedGuidesForPage();
  const guides = all.filter((g) => g.entry.category === k);
  const label = GUIDE_CATEGORY_LABEL[k];
  return (
    <ToolsShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Crumbs items={[{ name: "Ana sayfa", path: "/" }, { name: GUIDE_HUB_TITLE, path: "/rehber" }, { name: label }]} />
        <h1 className="mt-1 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">{label} rehberleri</h1>
        <p className="mt-3 max-w-2xl text-text-muted">{GUIDE_CATEGORY_DESCRIPTION[k]}</p>
        {all.length > 0 ? <CategoryNav active={k} counts={categoryCounts(all)} /> : null}
        {guides.length === 0 ? <ComingSoon title={`${label} rehberleri`} /> : <GuideGrid guides={guides} />}
      </div>
    </ToolsShell>
  );
}
