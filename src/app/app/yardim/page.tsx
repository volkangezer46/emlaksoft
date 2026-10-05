import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, LifeBuoy, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireModulePage } from "@/lib/require-module-page";
import { FIRST_30_INTRO, GLOSSARY, GUIDES, HELP_TABS, resolveHelpTab, type HelpTab } from "@/lib/help-content";
import { loadOnboardingState, type HomeCtx } from "../_home/data";
import { RestartTourButton, TourPicker } from "./restart-tour-button";

export const metadata = { title: "Yardım ve Destek" };

const PANEL = "rounded-[var(--radius-panel)] border border-line bg-surface p-5";

function tabHref(tab: HelpTab) {
  return tab === "baslangic" ? "/app/yardim" : `/app/yardim?sekme=${tab}`;
}

/**
 * Yardım merkezi: Başlangıç (kurulum kontrol listesi), Rehberler (görev bazlı
 * adımlar), Sözlük (jargon → ofis dili) ve Destek talebi. İçerik tek kaynaktan
 * gelir (src/lib/help-content.ts); "Destek talepleri" sekmesi mevcut /app/destek
 * sayfasıdır, formu değişmemiştir.
 */
export default async function HelpPage({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const { tenantId } = await requireModulePage("support");
  const tab = resolveHelpTab((await searchParams)?.sekme);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Yardım ve Destek"
        title="Size nasıl yardımcı olabiliriz?"
        description="Adım adım kılavuzlar, terimlerin ofis dilindeki karşılığı ve destek ekibine ulaşma yolu burada."
        actions={<RestartTourButton />}
      />

      <nav aria-label="Yardım bölümleri" className="flex flex-wrap gap-2">
        {HELP_TABS.map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            aria-current={t.id === tab ? "page" : undefined}
            className={`focus-ring inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition ${
              t.id === tab
                ? "bg-ink-950 text-white"
                : "border border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "baslangic" ? <TourPicker /> : null}
      {tab === "baslangic" ? <StartTab tenantId={tenantId} /> : null}
      {tab === "rehberler" ? <GuidesTab /> : null}
      {tab === "sozluk" ? <GlossaryTab /> : null}
      {tab === "destek" ? <SupportTab /> : null}
    </div>
  );
}

async function StartTab({ tenantId }: { tenantId: string | null }) {
  // Kurulum şeridiyle aynı sayımlar (loadOnboardingState yalnız tenantId okur).
  const state = tenantId ? await loadOnboardingState({ tenantId } as HomeCtx) : null;

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

function GuidesTab() {
  return (
    <section aria-label="Rehberler" className="space-y-4">
      <ul className="flex flex-wrap gap-2" aria-label="Rehber listesi">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <a
              href={`#${g.slug}`}
              className="focus-ring inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-text-muted transition hover:border-brand-300 hover:text-ink-950"
            >
              {g.title}
            </a>
          </li>
        ))}
      </ul>
      {GUIDES.map((g) => (
        <article key={g.slug} id={g.slug} className={`${PANEL} scroll-mt-24`}>
          <h2 className="font-display text-lg font-bold text-ink-950">{g.title}</h2>
          <p className="mt-1 text-sm text-text-muted">{g.intro}</p>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-base leading-relaxed text-text marker:font-bold marker:text-brand-600">
            {g.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="mt-5">
            <ButtonLink href={g.href} iconRight={ArrowRight}>
              Şimdi dene: {g.cta}
            </ButtonLink>
          </div>
        </article>
      ))}
    </section>
  );
}

function GlossaryTab() {
  return (
    <section aria-label="Sözlük" className="space-y-3">
      <p className="text-sm text-text-muted">
        Ekranlarda gördüğünüz terimlerin ofis dilindeki karşılığı. Bir terimin yanındaki ? düğmesi sizi doğrudan buraya getirir.
      </p>
      <dl className="space-y-3">
        {GLOSSARY.map((g) => (
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

function SupportTab() {
  return (
    <section aria-label="Destek talebi" className="space-y-4">
      <div className={PANEL}>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
          <LifeBuoy className="h-5 w-5 text-brand-600" aria-hidden /> EmlakSoft ekibine yazın
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Rehberlerde cevabı bulamadıysanız fatura, kurulum veya teknik konuda destek talebi açın. Ekibimiz en geç 1 iş günü içinde döner.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/app/destek/yeni" icon={LifeBuoy}>
            Yeni destek talebi
          </ButtonLink>
          <ButtonLink href="/app/destek" variant="secondary" iconRight={ArrowRight}>
            Taleplerim
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
