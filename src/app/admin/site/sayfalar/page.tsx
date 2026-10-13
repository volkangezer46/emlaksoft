import Link from "@/components/ui/smart-link";
import { ArrowUpRight, ExternalLink, FileStack, Lock } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { defaultPricingPage } from "@/lib/pricing-page/defaults";
import { samePricing } from "@/lib/pricing-page/schema-core";
import { pricingPageStore } from "@/lib/pricing-page/store";
import { PAGE_KIND_LABEL, PAGE_STATUS_LABEL, type PageStatus } from "@/lib/site-pages/schema-core";
import { readSitePageIndex } from "@/lib/site-pages/store";
import { PAGE_TEMPLATES } from "@/lib/site-pages/templates";
import { NewPageGallery } from "./new-page-gallery";

export const metadata = { title: "Sayfalar" };

const STATUS_TONE: Record<PageStatus, string> = {
  yayinda: "bg-mint-500/15 text-mint-700",
  taslak: "bg-amber-100 text-amber-900",
  arsiv: "bg-ink-950/8 text-text-muted",
};

const Chip = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{children}</span>
);

/**
 * Sayfalar: sistem sayfaları (kilitli; Ana sayfa site içeriğinden, Fiyatlar metinleri burada) ve sayfa oluşturucuyla açılan
 * özel sayfalar (Hakkımızda, İletişim, kampanya ve bölge landing'i). Yazma yalnız süper admin; operasyon salt okur.
 */
export default async function AdminSitePagesPage() {
  const staff = await requirePlatformModule("sitecontent");
  const canWrite = staff.role === "super_admin";
  const [index, pricing] = await Promise.all([readSitePageIndex(), pricingPageStore.readState()]);
  const pricingDraftPending = pricing.draft !== null && !samePricing(pricing.draft, pricing.live ?? defaultPricingPage());
  const pages = [...index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Herkese açık site"
        icon={FileStack}
        title="Sayfalar"
        description="Fiyatlar sayfasının metinleri ve sayfa oluşturucuyla açılan özel sayfalar (Hakkımızda, İletişim, kampanya ve bölge sayfaları). Değişiklikler önce taslaktır; Yayınla ile canlıya alınır, her yayın geri dönülebilir."
        glow="brand"
      />

      <section aria-labelledby="sistem-sayfalari" className="space-y-3">
        <h2 id="sistem-sayfalari" className="font-display text-base font-extrabold text-ink-950">Sistem sayfaları</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          <li>
            <Link href="/admin/site-icerik" className="focus-ring group flex h-full items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-400">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" aria-label="Sistem sayfası (yolu sabit)" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink-950">Ana sayfa</span>
                  <ArrowUpRight className="h-4 w-4 text-text-faint group-hover:text-brand-600" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-sm text-text-muted">/ · metinler ve bölüm düzeni Site içeriği ekranında</span>
              </span>
            </Link>
          </li>
          <li>
            <Link href="/admin/site/sayfalar/fiyatlar" className="focus-ring group flex h-full items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-400">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" aria-label="Sistem sayfası (yolu sabit)" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink-950">Fiyatlar</span>
                  <ArrowUpRight className="h-4 w-4 text-text-faint group-hover:text-brand-600" aria-hidden="true" />
                </span>
                <span className="mt-1 block text-sm text-text-muted">/fiyatlar · metinler ve SSS düzenlenebilir; fiyatlar plan editöründen</span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tone="bg-brand-600/10 text-brand-700">{pricing.live ? "Özel yayın" : "Varsayılan metin"}</Chip>
                  {pricingDraftPending ? <Chip tone="bg-amber-100 text-amber-900">Yayınlanmamış taslak var</Chip> : null}
                </span>
              </span>
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="ozel-sayfalar" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="ozel-sayfalar" className="font-display text-base font-extrabold text-ink-950">
            Özel sayfalar <span className="text-sm font-semibold text-text-muted">({pages.length}/50)</span>
          </h2>
          {canWrite ? <NewPageGallery templates={PAGE_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description, slug: t.slug }))} full={pages.length >= 50} /> : null}
        </div>
        {pages.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface p-6 text-center">
            <p className="font-semibold text-ink-950">Henüz özel sayfa yok</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-text-muted">
              Hakkımızda ve İletişim sayfaları, kampanya ya da bölge sayfaları şablondan dolu gelir; metni düzenleyip yayınlarsınız. Yayınlanan sayfa sitemap&apos;e kendiliğinden girer.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
            {pages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/admin/site/sayfalar/${p.id}`} className="focus-ring min-w-0 flex-1 rounded">
                  <span className="block truncate font-semibold text-ink-950">{p.title}</span>
                  <span className="block truncate text-xs text-text-muted">
                    /{p.slug} · {PAGE_KIND_LABEL[p.kind]} · {toTrLocalInput(p.updatedAt).replace("T", " ")}
                    {p.updatedBy ? ` · ${p.updatedBy}` : ""}
                  </span>
                </Link>
                <Chip tone={STATUS_TONE[p.status]}>{PAGE_STATUS_LABEL[p.status]}</Chip>
                {p.status === "yayinda" ? (
                  <a href={`/${p.slug}`} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs font-semibold text-brand-700 hover:underline">
                    Canlıda aç <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
