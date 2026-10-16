import Link from "@/components/ui/smart-link";
import { BookOpen, ExternalLink } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { toTrLocalInput } from "@/lib/clock";
import { GUIDE_CATEGORY_LABEL, GUIDE_LIMITS, GUIDE_STATUS_LABEL, guidePath, type GuideStatus } from "@/lib/guides/defaults";
import { readGuideIndexState } from "@/lib/guides/store";
import { requirePlatformModule } from "@/lib/platform";
import { NewGuideForm } from "./new-guide-form";

export const metadata = { title: "Rehber" };

const STATUS_TONE: Record<GuideStatus, string> = {
  yayinda: "bg-mint-500/15 text-mint-700",
  taslak: "bg-amber-100 text-amber-900",
  arsiv: "bg-ink-950/8 text-text-muted",
};

/**
 * Rehber yazıları (/rehber). Operasyon taslak açar ve düzenler; yayın, geri alma ve yayından kaldırma yalnız süper
 * admin. Zamanlı yayın Yayın masasındadır.
 */
export default async function AdminGuidesPage() {
  const staff = await requirePlatformModule("sitecontent");
  const read = await readGuideIndexState();
  const guides = read.ok ? [...read.list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  const published = guides.filter((g) => g.status === "yayinda").length;
  const nearLimit = guides.length >= GUIDE_LIMITS.maxGuides * 0.8;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="document"
        eyebrow="Herkese açık site"
        icon={BookOpen}
        title="Rehber"
        description="Emlak ofislerine yönelik rehber yazıları (/rehber). Yazılar önce taslaktır; süper admin yayınlar, her yayın geri alınabilir. Yayınlanan ve en az 300 kelimelik yazılar sitemap'e girer."
        glow="brand"
      />

      {!read.ok ? (
        <p role="alert" className="rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Rehber listesi şu an okunamadı; yeni yazı açmak ve kayıt güvenlik için kapalı. Biraz sonra sayfayı yenileyin.
        </p>
      ) : null}
      {nearLimit ? (
        <p role="status" className="rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {guides.length}/{GUIDE_LIMITS.maxGuides} yazı. Sınıra yaklaşıldı: daha fazla yazı için ayrı tablo kararı gerekir (sahibe iletin).
        </p>
      ) : null}

      <section aria-labelledby="yazilar" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="yazilar" className="font-display text-base font-extrabold text-ink-950">
            Yazılar <span className="text-sm font-semibold text-text-muted">({guides.length} · {published} yayında)</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {published > 0 ? (
              <a href="/rehber" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm font-semibold text-brand-700 hover:underline">
                /rehber&apos;i aç <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
            {read.ok ? <NewGuideForm full={guides.length >= GUIDE_LIMITS.maxGuides} /> : null}
          </div>
        </div>
        {guides.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface p-6 text-center">
            <p className="font-semibold text-ink-950">Henüz rehber yazısı yok</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-text-muted">
              İlk yazıyı açın: paragraf, ara başlık, liste, tablo, bilgi kutusu, SSS ve araç kartı bloklarıyla yazılır. Yayında yazı yokken /rehber &quot;Yakında&quot; gösterir ve arama motorlarına kapalıdır.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
            {guides.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/admin/site/rehber/${g.id}`} className="focus-ring min-w-0 flex-1 rounded">
                  <span className="block truncate font-semibold text-ink-950">{g.title}</span>
                  <span className="block truncate text-xs text-text-muted">
                    {guidePath(g.slug)} · {GUIDE_CATEGORY_LABEL[g.category]} · {toTrLocalInput(g.updatedAt).replace("T", " ")}
                    {g.updatedBy ? ` · ${g.updatedBy}` : ""}
                  </span>
                </Link>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_TONE[g.status]}`}>{GUIDE_STATUS_LABEL[g.status]}</span>
                {g.status === "yayinda" ? (
                  <a href={guidePath(g.slug)} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs font-semibold text-brand-700 hover:underline">
                    Canlıda aç <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {staff.role !== "super_admin" ? (
          <p className="text-xs text-text-muted">Bu hesap taslak yazabilir; yayınlama süper admin yetkisindedir.</p>
        ) : null}
      </section>
    </div>
  );
}
