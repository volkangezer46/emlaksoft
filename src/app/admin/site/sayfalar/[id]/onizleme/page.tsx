import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { requirePlatformModule } from "@/lib/platform";
import { readSeoSettingsFresh } from "@/lib/seo/store";
import { SitePageBlocks, contactInfoFrom } from "@/lib/site-pages/blocks";
import { readSitePageIndex, sitePageStore } from "@/lib/site-pages/store";

export const metadata: Metadata = { title: "Sayfa önizlemesi", robots: { index: false, follow: false } };

/**
 * Personel önizlemesi: KAYITLI taslağı herkese açık sayfayla AYNI blok bileşenleriyle çizer. Yalnız oturumlu personel
 * (`sitecontent` modülü) açabilir; noindex. Yayına etkisi yoktur.
 */
export default async function AdminSitePagePreview({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformModule("sitecontent");
  const { id } = await params;
  if (!/^[a-f0-9]{12}$/.test(id)) notFound();
  const [index, state, seo] = await Promise.all([readSitePageIndex(), sitePageStore(id).readState(), readSeoSettingsFresh()]);
  const entry = index.find((e) => e.id === id);
  const content = state.draft ?? state.live;
  if (!entry || !content) notFound();

  return (
    <div className="space-y-4">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>
          <b>Önizleme</b> · /{entry.slug} · kayıtlı taslak gösteriliyor (kaydedilmemiş değişiklikler görünmez). Bu sayfa arama motorlarına kapalıdır.
        </span>
        <Link href={`/admin/site/sayfalar/${id}`} className="inline-flex min-h-11 items-center font-semibold underline">Editöre dön</Link>
      </p>
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-text">
        <SitePageBlocks content={content} contact={contactInfoFrom(seo.global)} />
      </div>
    </div>
  );
}
