import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { GUIDE_CATEGORY_LABEL, guidePath } from "@/lib/guides/defaults";
import { guideStore, readGuideIndex } from "@/lib/guides/store";
import { readingMinutes, tocOf } from "@/lib/rich-text/core";
import { RichText } from "@/lib/rich-text/render";
import { requirePlatformModule } from "@/lib/platform";

export const metadata: Metadata = { title: "Rehber önizlemesi", robots: { index: false, follow: false } };

/**
 * Personel önizlemesi: KAYITLI taslağı herkese açık yazıyla AYNI renderer'la (sunucuda) çizer. Yalnız oturumlu personel
 * (`sitecontent` modülü) açabilir; noindex. Yayına etkisi yoktur.
 */
export default async function AdminGuidePreview({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformModule("sitecontent");
  const { id } = await params;
  if (!/^[a-f0-9]{12}$/.test(id)) notFound();
  const [index, state] = await Promise.all([readGuideIndex(), guideStore(id).readState()]);
  const entry = index.find((e) => e.id === id);
  const content = state.draft ?? state.live;
  if (!entry || !content) notFound();
  const toc = tocOf(content.body);

  return (
    <div className="space-y-4">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>
          <b>Önizleme</b> · {guidePath(entry.slug)} · kayıtlı taslak gösteriliyor (kaydedilmemiş değişiklikler görünmez). Bu sayfa arama motorlarına kapalıdır.
        </span>
        <Link href={`/admin/site/rehber/${id}`} className="inline-flex min-h-11 items-center font-semibold underline">Editöre dön</Link>
      </p>
      <article className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface p-6 text-text sm:p-10">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-brand-700">{GUIDE_CATEGORY_LABEL[content.category]}</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-ink-950">{content.title}</h1>
        <p className="mt-2 text-sm text-text-muted">{readingMinutes(content.body)} dk okuma</p>
        {toc.length >= 2 ? (
          <nav aria-labelledby="onizleme-icindekiler" className="mt-6 rounded-[var(--radius-panel)] border border-line bg-surface-2 p-4">
            <p id="onizleme-icindekiler" className="text-sm font-bold text-ink-950">İçindekiler</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="text-text-muted hover:underline">{t.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className="mt-8 max-w-3xl">
          <RichText blocks={content.body} />
        </div>
      </article>
    </div>
  );
}
