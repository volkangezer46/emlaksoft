import { GUIDE_CATEGORIES, GUIDE_CATEGORY_LABEL, guideCategoryPath, guidePath, type GuideCategory } from "@/lib/guides/defaults";
import { excerptOf, readingMinutes } from "@/lib/rich-text/core";
import type { PublishedGuide } from "@/lib/guides/store";
import { formatGuideDate } from "@/lib/guides/view";

/**
 * Rehber sayfalarının ortak sunucu parçaları. İstemci bileşeni YOK; bağlantılar düz `<a>` (next/link istemci JS'i
 * taşır; rehber sayfaları istemci kodu eklemez — rehber sözleşme testi).
 */

export function Crumbs({ items }: { items: ReadonlyArray<{ name: string; path?: string }> }) {
  return (
    <nav aria-label="Konum" className="text-sm text-text-muted">
      <ol className="flex flex-wrap items-center gap-x-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-x-1">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {it.path ? (
              <a href={it.path} className="inline-flex min-h-11 items-center hover:text-ink-950 hover:underline">
                {it.name}
              </a>
            ) : (
              <span aria-current="page" className="inline-flex min-h-11 items-center font-semibold text-ink-950">
                {it.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function CategoryNav({ active, counts }: { active?: GuideCategory; counts: Partial<Record<GuideCategory, number>> }) {
  return (
    <nav aria-label="Rehber kategorileri" className="mt-6">
      <ul className="flex flex-wrap gap-2">
        <li>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- rehber sayfaları istemci bileşeni taşımaz (next/link yok) */}
          <a
            href="/rehber"
            aria-current={active ? undefined : "page"}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition ${active ? "border-line text-text-muted hover:border-brand-400 hover:text-ink-950" : "border-brand-600 bg-brand-600 text-white"}`}
          >
            Tümü
          </a>
        </li>
        {GUIDE_CATEGORIES.map((k) => (
          <li key={k}>
            <a
              href={guideCategoryPath(k)}
              aria-current={active === k ? "page" : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition ${active === k ? "border-brand-600 bg-brand-600 text-white" : "border-line text-text-muted hover:border-brand-400 hover:text-ink-950"}`}
            >
              {GUIDE_CATEGORY_LABEL[k]}
              <span className="text-xs opacity-80">{counts[k] ?? 0}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function GuideCard({ guide }: { guide: PublishedGuide }) {
  const { entry, content } = guide;
  return (
    <a
      href={guidePath(entry.slug)}
      className="flex h-full flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-sm)] transition hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{GUIDE_CATEGORY_LABEL[entry.category]}</span>
      <h2 className="mt-2 font-display text-lg font-bold text-ink-950">{content.title}</h2>
      <p className="mt-2 flex-1 text-sm text-text-muted">{content.seo.description || excerptOf(content.body, 160)}</p>
      <span className="mt-4 text-xs text-text-faint">
        {formatGuideDate(entry.publishedAt)} · {readingMinutes(content.body)} dk okuma
      </span>
    </a>
  );
}

export function GuideGrid({ guides }: { guides: readonly PublishedGuide[] }) {
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {guides.map((g) => (
        <li key={g.entry.id}>
          <GuideCard guide={g} />
        </li>
      ))}
    </ul>
  );
}

/** Yayında yazı yokken: anlamlı boş durum ("Yakında"); sayfa noindex. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mt-10 rounded-[var(--radius-panel)] border border-dashed border-line bg-surface-2 p-8 text-center">
      <p className="font-display text-xl font-extrabold text-ink-950">Yakında</p>
      <p className="mx-auto mt-2 max-w-xl text-text-muted">{title} hazırlanıyor. O zamana kadar ücretsiz hesaplama araçlarımızı kullanabilirsiniz.</p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- rehber sayfaları istemci bileşeni taşımaz (next/link yok) */}
      <a href="/araclar" className="mt-5 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
        Araçlara göz atın
      </a>
    </div>
  );
}

export function categoryCounts(guides: readonly PublishedGuide[]): Partial<Record<GuideCategory, number>> {
  const out: Partial<Record<GuideCategory, number>> = {};
  for (const g of guides) out[g.entry.category] = (out[g.entry.category] ?? 0) + 1;
  return out;
}
