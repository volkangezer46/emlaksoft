import Link from "@/components/ui/smart-link";
import { ArrowLeft, ArrowRight, Check, FlaskConical } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Celebrate } from "@/components/ui/celebrate";
import { Progress } from "@/components/ui/progress";
import {
  FINISH_STEP,
  wizardNeighbors,
  type FirstTask,
  type OnboardingState,
  type OnboardingStepId,
  type WizardStepKey,
} from "@/lib/onboarding-checklist";
import { renderStepBody, type StepBodyProps } from "./step-bodies";
import { SkipButton } from "./skip-button";
import { StartChoice } from "./start-choice";
import { FinishTourStarter } from "./finish-tour";

export type SetupWizardProps = {
  state: OnboardingState;
  skipped: OnboardingStepId[];
  current: WizardStepKey;
  canEditSettings: boolean;
  showSampleData: boolean;
  /** Boş ofis ve tanım girilmemiş: "Nasıl başlamak istersin?" paneli (ofis tipi + demo/boş). */
  showStartChoice: boolean;
  canSeedSample: boolean;
  /** "İlk işler" kontrol listesi (bitiş ekranında da görünür). */
  firstTasks: FirstTask[];
  /** Ofiste örnek (demo) müşteri sayısı; 0 ise örnek veri bilgisi gösterilmez. */
  sampleCustomers: number;
  /** Adım gövdesi bağlamı (step ve nextHref sihirbaz tarafından eklenir). */
  body: Omit<StepBodyProps, "step" | "nextHref">;
};

const href = (k: WizardStepKey) => `/app/baslangic?adim=${k}`;

/**
 * Tek "Kurulum" sihirbazı. Adım URL'de (`?adim=`) durur: geri/ileri tarayıcıyla çalışır, ana ekran kartı doğrudan
 * sıradaki adıma getirir. Tamamlanma gerçek veriden hesaplanır (onboarding-state); hiçbir adım zorunlu değildir
 * ("Sonra yaparım"), istediğin an çıkıp sonra devam edebilirsin. Adım listesi `onboarding-steps.ts` kaydından gelir.
 */
export function SetupWizard(props: SetupWizardProps) {
  const { state, skipped, current } = props;
  const { prev, next } = wizardNeighbors(current);
  const step = state.steps.find((s) => s.id === current) ?? null;
  const nextHref = href(next ?? FINISH_STEP);
  const chips = [
    ...state.steps.map((s) => ({ key: s.id as WizardStepKey, short: s.short, done: s.done })),
    { key: FINISH_STEP as WizardStepKey, short: "Bitiş", done: state.complete },
  ];

  return (
    <div className="space-y-4" data-tour="kurulum">
      {props.showStartChoice && current === "office" ? (
        <StartChoice canEdit={props.canEditSettings} canSeed={props.canSeedSample} />
      ) : null}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-text">
              {state.doneCount} / {state.total} adım tamam
            </p>
            <p className="text-sm font-semibold text-text-muted">%{state.percent}</p>
          </div>
          <Progress value={state.percent} label="Kurulum ilerlemesi" tone={state.complete ? "success" : "accent"} />
          <nav aria-label="Kurulum adımları">
            <ol className="relative flex gap-1 overflow-x-auto pb-1">
              {chips.map((s, i) => {
                const isCurrent = s.key === current;
                const isSkipped = !s.done && skipped.includes(s.key as OnboardingStepId);
                return (
                  <li key={s.key} className="shrink-0">
                    <Link
                      href={href(s.key)}
                      aria-current={isCurrent ? "step" : undefined}
                      className={
                        "focus-ring flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                        (isCurrent
                          ? "bg-accent text-white"
                          : s.done
                            ? "bg-mint-500/12 text-mint-600"
                            : "bg-line text-text-muted hover:text-text")
                      }
                    >
                      <span aria-hidden>{s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                      {s.short}
                      {s.done ? <span className="sr-only"> (tamamlandı)</span> : null}
                      {isSkipped ? <span className="sr-only"> (sonra yapılacak)</span> : null}
                      {isSkipped ? <span aria-hidden className="text-xs font-normal opacity-70">sonra</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          {current === FINISH_STEP ? (
            <FinishPanel {...props} />
          ) : step ? (
            <>
              <div>
                <h2 className="font-display text-lg font-bold text-text">
                  {step.title}
                  {step.done ? <span className="ml-2 text-xs font-semibold text-mint-600">Tamamlandı</span> : null}
                </h2>
                <p className="mt-0.5 text-sm text-text-muted">{step.description}</p>
              </div>
              {renderStepBody({ ...props.body, step, nextHref })}
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {prev ? (
            <ButtonLink href={href(prev)} variant="ghost" icon={ArrowLeft}>
              Geri
            </ButtonLink>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {step ? <SkipButton stepId={step.id} nextHref={nextHref} skipped={skipped.includes(step.id) && !step.done} /> : null}
          {next ? (
            <ButtonLink href={nextHref} variant={step?.done ? "primary" : "secondary"} iconRight={ArrowRight}>
              {next === FINISH_STEP ? "Özete geç" : "İleri"}
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FinishPanel({ state, skipped, firstTasks, sampleCustomers }: SetupWizardProps) {
  const pendingSteps = state.steps.filter((s) => !s.done);
  const openTasks = firstTasks.filter((t) => !t.done);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        {state.complete ? <Celebrate label="Kurulum tamamlandı" /> : null}
        <div>
          <h2 className="font-display text-lg font-bold text-text">{state.complete ? "Ofisin hazır" : "Kurulum özeti"}</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {state.complete
              ? "Tüm adımlar tamam. Günlük işlerin Bugün ekranında seni bekliyor."
              : `${state.doneCount} / ${state.total} adım tamam. Kalanları istediğin zaman buradan sürdürebilirsin.`}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {state.steps.map((s) => {
          const isSkipped = !s.done && skipped.includes(s.id);
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span
                className={
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-white " +
                  (s.done ? "bg-mint-500" : "bg-line text-text-muted")
                }
                aria-hidden
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1 text-text">{s.title}</span>
              <span className="text-xs text-text-muted">{s.done ? "Tamamlandı" : isSkipped ? "Sonra yapılacak" : "Bekliyor"}</span>
              {!s.done ? (
                <Link href={href(s.id)} className="focus-ring inline-flex min-h-11 items-center text-xs font-semibold text-brand-600 hover:underline">
                  Aç
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!state.complete && pendingSteps.length > 0 ? (
        <Alert tone="info">Ana ekrandaki Başlangıç kartı, sonra yapılacak olmayan sıradaki adımı sana hatırlatır.</Alert>
      ) : null}

      {openTasks.length > 0 ? (
        <section aria-label="İlk işler">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">İlk işler</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {openTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.href}
                  className="focus-ring flex min-h-11 flex-col justify-center rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2 transition hover:border-brand-300"
                >
                  <span className="text-sm font-semibold text-ink-950">{t.title}</span>
                  <span className="text-xs text-text-muted">{t.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sampleCustomers > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
          <FlaskConical className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-text-muted">
            Ofisinde örnek veriler var (&quot;Örnek veri&quot; rozetli). Sistemi rahatça dene; hazır olunca{" "}
            <strong className="text-text">örnek verileri tek tuşla sil, gerçek kullanıma geç</strong>.
          </p>
          <ButtonLink href="/app/ayarlar/gercek-kullanim" variant="secondary">
            Gerçek kullanıma geç
          </ButtonLink>
        </div>
      ) : null}

      <FinishTourStarter auto={state.settled} />
      <ButtonLink href="/app" iconRight={ArrowRight}>
        Bugün ekranına git
      </ButtonLink>
    </div>
  );
}
