import { redirect } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { FilterChip } from "@/components/ui/filter-chip";
import { ArrowRight, CheckCircle2, Circle, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireModulePage } from "@/lib/require-module-page";
import { FIRST_30_INTRO, HELP_TABS, resolveHelpTab, type GlossaryEntry, type HelpTab } from "@/lib/help-content";
import { getHelpContent } from "@/lib/help-center/store";
import { loadOnboardingState } from "../_home/data";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { RestartTourButton, TourPicker } from "./restart-tour-button";
import { FaqSearch, GuidesSearch } from "./help-search";

export const metadata = { title: "Yardım ve Destek" };

const PANEL = "rounded-[var(--radius-panel)] border border-line bg-surface p-5";

/**
 * Sayfa içi sekmeler. "Destek talebi" sekmesi kaldırıldı: üstteki şeritte zaten "Destek" (/app/destek) var, aynı yere
 * giden iki sekme kafa karıştırıyordu. Eski derin bağlantı (?sekme=destek) Destek sayfasına yönlenir.
 */
const PAGE_TABS = HELP_TABS.filter((t) => t.id !== "destek");

function tabHref(tab: HelpTab) {
  return tab === "baslangic" ? "/app/yardim" : `/app/yardim?sekme=${tab}`;
}

/**
 * Yardım merkezi: Başlangıç (kurulum kontrol listesi), Rehberler (görev bazlı
 * adımlar), SSS ve Sözlük (jargon → ofis dili). İçerik yardım merkezi CMS'inden gelir: koddaki taban
 * (src/lib/help-content.ts, help-faq.ts) + yayındaki DB makaleleri (src/lib/help-center; /admin/site/yardim). Yayın
 * önbellek etiketini tazeler: yeni makale hemen aranabilir. Destek talepleri merkezin "Destek" sekmesidir (/app/destek).
 */
export default async function HelpPage({ searchParams }: { searchParams?: Promise<{ sekme?: string; q?: string }> }) {
  const [{ tenantId, perms }, sp, help] = await Promise.all([requireModulePage("support"), searchParams, getHelpContent()]);
  if (sp?.sekme === "destek") redirect("/app/destek");
  const tab = resolveHelpTab(sp?.sekme);
  const q = (sp?.q ?? "").slice(0, 100);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Yardım ve Destek"
        title="Size nasıl yardımcı olabiliriz?"
        description="Adım adım kılavuzlar, terimlerin ofis dilindeki karşılığı ve destek ekibine ulaşma yolu burada."
        actions={<RestartTourButton />}
      />

      <nav aria-label="Yardım bölümleri" className="flex flex-wrap gap-2">
        {PAGE_TABS.map((t) => (
          <FilterChip key={t.id} href={tabHref(t.id)} active={t.id === tab}>
            {t.label}
          </FilterChip>
        ))}
      </nav>

      {tab === "baslangic" ? <TourPicker /> : null}
      {tab === "baslangic" ? <StartTab tenantId={tenantId} perms={perms} /> : null}
      {tab === "rehberler" ? <GuidesSearch initialQ={q} guides={help.guides} /> : null}
      {tab === "sss" ? <FaqSearch initialQ={q} faq={help.faq} /> : null}
      {tab === "sozluk" ? <GlossaryTab glossary={help.glossary} /> : null}
    </div>
  );
}

async function StartTab({ tenantId, perms }: { tenantId: string | null; perms: EffectivePermissions }) {
  // Ana ekran Başlangıç kartıyla aynı sayımlar ve aynı yetki süzgeci (yetkisiz adım listelenmez, yüzdeye sayılmaz).
  const state = tenantId ? await loadOnboardingState({ tenantId, perms }) : null;

  return (
    <section aria-labelledby="ilk-30" className="space-y-4">
      <div className={PANEL}>
        <h2 id="ilk-30" className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
          <ListChecks className="h-5 w-5 text-brand-600" aria-hidden /> İlk 30 dakikada yapılacaklar
        </h2>
        <p className="mt-1 text-sm text-text-muted">{FIRST_30_INTRO}</p>
        {state ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm font-bold text-ink-950">
              {state.doneCount}/{state.total} adım tamam
            </span>
            <Progress value={state.percent} label="Kurulum ilerlemesi" className="min-w-32 flex-1" />
          </div>
        ) : null}
      </div>

      {state ? (
        <ol className="space-y-3">
          {state.steps.map((step, i) => (
            <li key={step.id} className={`${PANEL} flex flex-wrap items-center gap-3`}>
              <span aria-hidden className={step.done ? "text-mint-600" : "text-text-faint"}>
                {step.done ? <CheckCircle2 className="h-6 w-6" /> : <Circle className="h-6 w-6" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-ink-950">
                  <span className="sr-only">Adım {i + 1}: </span>
                  {step.title}
                  {step.done ? <span className="sr-only"> (tamamlandı)</span> : null}
                </p>
                <p className="mt-0.5 text-sm text-text-muted">{step.description}</p>
              </div>
              {step.done ? null : (
                <ButtonLink href={`/app/baslangic?adim=${step.id}`} variant="secondary" iconRight={ArrowRight}>
                  Şimdi kur
                </ButtonLink>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className={PANEL}>
          <p className="text-sm text-text-muted">
            Kurulum adımları bir ofis hesabı içinde görünür. Rehberler sekmesinden günlük işlerin adımlarına bakabilirsiniz.
          </p>
        </div>
      )}

      <div className={`${PANEL} flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-sm text-text-muted">Kurulum sayfasında adımları ayrıntılı görebilir, dilediğinizi sonraya bırakabilirsiniz.</p>
        <ButtonLink href="/app/baslangic" variant="secondary" iconRight={ArrowRight}>
          Ofis kurulumunu aç
        </ButtonLink>
      </div>
    </section>
  );
}

function GlossaryTab({ glossary }: { glossary: readonly GlossaryEntry[] }) {
  return (
    <section aria-label="Sözlük" className="space-y-3">
      <p className="text-sm text-text-muted">
        Ekranlarda gördüğünüz terimlerin ofis dilindeki karşılığı. Bir terimin yanındaki ? düğmesi sizi doğrudan buraya getirir.
      </p>
      <dl className="space-y-3">
        {glossary.map((g) => (
          <div key={g.slug} id={g.slug} className={`${PANEL} scroll-mt-24 target:border-brand-600`}>
            <dt className="font-display text-base font-bold text-ink-950">
              {g.term}
              {g.aka ? <span className="ml-2 text-sm font-normal text-text-muted">({g.aka})</span> : null}
            </dt>
            <dd className="mt-1.5 space-y-2 text-base leading-relaxed text-text">
              <p>{g.short}</p>
              {g.detail ? <p className="text-sm text-text-muted">{g.detail}</p> : null}
              {g.href ? (
                <Link
                  href={g.href}
                  className="focus-ring inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
                >
                  {g.hrefLabel ?? "Sayfaya git"} <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
