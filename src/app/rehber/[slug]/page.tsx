import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolsShell } from "@/components/tools/tools-shell";
import { getBaseUrl } from "@/lib/base-url";
import { guideCrumbs, guidePageJsonLd } from "@/lib/guides/jsonld";
import { GUIDE_CATEGORY_LABEL, guideCategoryPath, guidePath, type GuideContent, type GuideIndexEntry } from "@/lib/guides/schema";
import { GUIDE_SLUG_RE } from "@/lib/guides/slug";
import { getLiveGuide, getPublishedGuideIndex } from "@/lib/guides/store";
import { formatGuideDate, guideExtraMetadata, relatedGuides, relatedToolSlugs } from "@/lib/guides/view";
import { readingMinutes, tocOf } from "@/lib/rich-text/core";
import { RichText } from "@/lib/rich-text/render";
import { serializeJsonLd } from "@/lib/seo/jsonld";
import { buildMetadata } from "@/lib/seo/store";
import { getPublishedTool } from "@/lib/tools/registry";
import { Crumbs } from "../guide-ui";

/**
 * /rehber/<slug>: yayındaki yazı. ISR (300 sn; derlemede önceden üretilmez, ilk istekte üretilir ve yayında düşer).
 * İstemci bileşeni yok; JSON-LD (Article + BreadcrumbList [+ FAQPage]) `serializeJsonLd` ile kaçışlı basılır.
 * Okuma hatası FIRLATILIR (404 sayılmaz; ISR önceki sürümü sunmayı sürdürür). İnce içerik noindex (metadata).
 */
export const revalidate = 300;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

async function load(params: Props["params"]): Promise<{ entry: GuideIndexEntry; content: GuideContent; index: GuideIndexEntry[] } | null> {
  const { slug } = await params;
  if (!GUIDE_SLUG_RE.test(slug)) return null;
  const index = await getPublishedGuideIndex();
  const entry = index.find((e) => e.slug === slug);
  if (!entry) return null;
  const content = await getLiveGuide(entry.id);
  return content ? { entry, content, index } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load(params);
  if (!data) return {};
  return buildMetadata(guidePath(data.entry.slug), guideExtraMetadata(getBaseUrl(), data.entry.slug, data.content));
}

export default async function GuidePage({ params }: Props) {
  const data = await load(params);
  if (!data) notFound();
  const { entry, content, index } = data;
  const base = getBaseUrl();
  const toc = tocOf(content.body);
  const minutes = readingMinutes(content.body);
  const tools = relatedToolSlugs(content)
    .map((s) => getPublishedTool(s))
    .filter((t) => t !== undefined);
  const related = relatedGuides(
    index.map((e) => ({ entry: e })),
    entry,
  ).map((g) => g.entry);
  const crumbs = guideCrumbs(entry, content.title);
  const jsonLd = guidePageJsonLd({ base, entry, content });

  return (
    <ToolsShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <article className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Crumbs items={crumbs.map((c, i) => (i === crumbs.length - 1 ? { name: c.name } : c))} />
        <header className="mt-2 max-w-3xl">
          <a href={guideCategoryPath(entry.category)} className="inline-flex min-h-11 items-center text-sm font-bold uppercase tracking-[0.08em] text-brand-700 hover:underline">
            {GUIDE_CATEGORY_LABEL[entry.category]}
          </a>
          <h1 className="font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">{content.title}</h1>
          <p className="mt-3 text-sm text-text-muted">
            <time dateTime={entry.publishedAt ?? undefined}>{formatGuideDate(entry.publishedAt)}</time> · {minutes} dk okuma · EmlakSoft
          </p>
        </header>

        <div className={`mt-8 grid gap-10 ${toc.length >= 2 ? "lg:grid-cols-[minmax(0,1fr)_16rem]" : ""}`}>
          <div className="min-w-0 max-w-3xl">
            {toc.length >= 2 ? (
              <nav aria-labelledby="icindekiler" className="mb-8 rounded-[var(--radius-panel)] border border-line bg-surface-2 p-4 lg:hidden">
                <p id="icindekiler" className="text-sm font-bold text-ink-950">İçindekiler</p>
                <TocList toc={toc} />
              </nav>
            ) : null}
            <RichText blocks={content.body} />
          </div>
          {toc.length >= 2 ? (
            <aside>
              <nav aria-labelledby="icindekiler-yan" className="sticky top-24 hidden rounded-[var(--radius-panel)] border border-line bg-surface-2 p-4 lg:block">
                <p id="icindekiler-yan" className="text-sm font-bold text-ink-950">İçindekiler</p>
                <TocList toc={toc} />
              </nav>
            </aside>
          ) : null}
        </div>

        {tools.length > 0 ? (
          <section aria-labelledby="ilgili-araclar" className="mt-12 max-w-3xl">
            <h2 id="ilgili-araclar" className="font-display text-xl font-extrabold text-ink-950">İlgili araçlar</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {tools.map((t) => (
                <li key={t.slug}>
                  <a href={`/araclar/${t.slug}`} className="flex h-full flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4 hover:border-brand-600">
                    <span className="font-semibold text-ink-950">{t.title}</span>
                    <span className="mt-1 text-sm text-text-muted">{t.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section aria-labelledby="ilgili-rehberler" className="mt-10 max-w-3xl">
            <h2 id="ilgili-rehberler" className="font-display text-xl font-extrabold text-ink-950">İlgili rehberler</h2>
            <ul className="mt-4 space-y-2">
              {related.map((r) => (
                <li key={r.id}>
                  <a href={guidePath(r.slug)} className="inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">
                    {r.title}
                  </a>
                  <span className="ml-2 text-xs text-text-faint">{GUIDE_CATEGORY_LABEL[r.category]}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="rehber-cta" className="mt-12 rounded-[var(--radius-panel)] border border-line bg-surface-2 p-6 text-center sm:p-10">
          <h2 id="rehber-cta" className="font-display text-2xl font-extrabold text-ink-950">Ofisinizi EmlakSoft ile yönetin</h2>
          <p className="mx-auto mt-2 max-w-2xl text-text-muted">Müşteri, portföy, randevu ve komisyon takibi tek panelde. Ücretsiz deneyin; kredi kartı gerekmez.</p>
          <a
            href={`/kayit?kaynak=rehber-${entry.slug}`}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Ücretsiz başla
          </a>
        </section>
      </article>
    </ToolsShell>
  );
}

function TocList({ toc }: { toc: ReadonlyArray<{ id: string; text: string }> }) {
  return (
    <ol className="mt-2 space-y-1 text-sm">
      {toc.map((t) => (
        <li key={t.id}>
          <a href={`#${t.id}`} className="inline-flex min-h-11 items-center text-text-muted hover:text-ink-950 hover:underline">
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
