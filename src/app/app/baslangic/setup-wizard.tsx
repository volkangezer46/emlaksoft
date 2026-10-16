import Link from "@/components/ui/smart-link";
import { ArrowLeft, ArrowRight, Check, FlaskConical, X } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Celebrate } from "@/components/ui/celebrate";
import { Progress } from "@/components/ui/progress";
import {
  FINISH_STEP,
  splitOptional,
  wizardNeighbors,
  wizardPosition,
  type FirstTask,
  type OnboardingState,
  type OnboardingStepId,
  type WizardStepKey,
} from "@/lib/onboarding-checklist";
import { renderStepBody, type StepBodyProps } from "./step-bodies";
import { SkipButton } from "./skip-button";
import { FinishTourStarter } from "./finish-tour";
import { SetupFocusMode } from "./focus-mode";
import { WizardLink } from "./wizard-nav";

export type SetupWizardProps = {
  state: OnboardingState;
  skipped: OnboardingStepId[];
  current: WizardStepKey;
  /** "İlk işler" kontrol listesi (özette görünür). */
  firstTasks: FirstTask[];
  /** Ofiste örnek (demo) müşteri sayısı; 0 ise örnek veri bilgisi gösterilmez. */
  sampleCustomers: number;
  /** Adım gövdesi bağlamı (step ve nextHref sihirbaz tarafından eklenir). */
  body: Omit<StepBodyProps, "step" | "nextHref">;
};

const href = (k: WizardStepKey) => `/app/baslangic?adim=${k}`;

const NAV_BTN =
  "focus-ring press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold transition active:scale-[0.98]";

/**
 * Tek "Kurulum" sihirbazı, ODAK MODUNDA (C27). Ofis sahibi için zorunlu akış 4 adımdır: Ofis · Ne iş yapıyorsunuz ·
 * Verileri taşı · Ekibi davet et. Üstte adım şeridi yerine "Adım x / 4" ve ilerleme çubuğu; tek çıkış "Kurulumdan çık".
 * Adım URL'de (`?adim=`) durur: geri/ileri tarayıcıyla çalışır, ana ekran kartı doğrudan sıradaki adıma getirir.
 * Tamamlanma gerçek veriden hesaplanır (onboarding-state); hiçbir adım zorunlu değildir ("Sonra yaparım", tercih profilde).
 * İsteğe bağlı ayarlar sayaca katılmaz; özetteki "İsteğe bağlı ayarlar" listesinden açılır ve oradan özete dönülür.
 */
export function SetupWizard(props: SetupWizardProps) {
  const { state, skipped, current } = props;
  const groups = splitOptional(state.steps);
  const step = state.steps.find((s) => s.id === current) ?? null;
  const isOptional = Boolean(step?.optional);
  // Zorunlu adımlarda sıra: zorunlular → Bitiş. İsteğe bağlı adımdan tek dönüş yolu özettir.
  const { prev, next } = isOptional
    ? { prev: FINISH_STEP as WizardStepKey, next: FINISH_STEP as WizardStepKey }
    : wizardNeighbors(current, groups.required.map((s) => s.id));
  const nextHref = href(next ?? FINISH_STEP);
  const pos = wizardPosition(current, state);
  const total = groups.required.length;
  const progress = current === FINISH_STEP ? 100 : pos ? Math.round((pos.index / Math.max(1, pos.total)) * 100) : state.percent;
  const heading = current === FINISH_STEP ? (state.complete ? "Ofisiniz hazır" : "Kurulum özeti") : (step?.title ?? "Kurulum");

  return (
    <div className="space-y-4" data-tour="kurulum">
      <SetupFocusMode />
      <header className="space-y-3 pt-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-text-muted" data-testid="kurulum-adim">
            {pos ? `Adım ${pos.index} / ${pos.total}` : isOptional ? "İsteğe bağlı ayar" : total > 0 ? `${state.doneCount} / ${total} adım tamam` : "Kurulum"}
          </p>
          <Link
            href="/app"
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-text-muted transition hover:bg-canvas hover:text-text"
          >
            <X className="h-4 w-4" aria-hidden /> Kurulumdan çık
          </Link>
        </div>
        <Progress value={progress} label="Kurulum ilerlemesi" tone={state.complete ? "success" : "accent"} />
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-950">
            {heading}
            {step?.done ? <span className="ml-2 align-middle text-sm font-semibold text-mint-600">Tamamlandı</span> : null}
          </h1>
          {step ? <p className="mt-1 text-base text-text-muted">{step.description}</p> : null}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4">
          {current === FINISH_STEP ? <FinishPanel {...props} /> : step ? renderStepBody({ ...props.body, step, nextHref }) : null}
        </CardContent>
      </Card>

      {current === FINISH_STEP ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {prev ? (
              <WizardLink href={href(prev)} prefetchFull className={`${NAV_BTN} text-text-muted hover:bg-canvas hover:text-text`}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> {isOptional ? "Özete dön" : "Geri"}
              </WizardLink>
            ) : null}
          </div>
          {isOptional ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {step ? <SkipButton stepId={step.id} nextHref={nextHref} skipped={skipped.includes(step.id) && !step.done} /> : null}
              {next ? (
                <WizardLink
                  href={nextHref}
                  prefetchFull
                  className={
                    NAV_BTN +
                    " " +
                    (step?.done ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-line bg-surface text-text hover:border-brand-300")
                  }
                >
                  {next === FINISH_STEP ? "Özete geç" : "İleri"} <ArrowRight className="h-4 w-4" aria-hidden />
                </WizardLink>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({ id, title, done, status }: { id: OnboardingStepId; title: string; done: boolean; status: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span
        className={"grid h-6 w-6 shrink-0 place-items-center rounded-full text-white " + (done ? "bg-mint-500" : "bg-line text-text-muted")}
        aria-hidden
      >
        {done ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1 text-base text-text">{title}</span>
      <span className="text-sm text-text-muted">{status}</span>
      {!done ? (
        <Link href={href(id)} className="focus-ring inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand-600 hover:underline">
          Aç
        </Link>
      ) : null}
    </li>
  );
}

function FinishPanel({ state, skipped, firstTasks, sampleCustomers }: SetupWizardProps) {
  const { required, optional } = splitOptional(state.steps);
  const openTasks = firstTasks.filter((t) => !t.done);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        {state.complete ? <Celebrate label="Kurulum tamamlandı" /> : null}
        <p className="text-base text-text-muted">
          {state.complete
            ? "Tüm adımlar tamam. Günlük işleriniz Bugün ekranında sizi bekliyor."
            : `${state.doneCount} / ${state.total} adım tamam. Kalanları istediğiniz zaman buradan sürdürebilirsiniz.`}
        </p>
      </div>
      {required.length > 0 ? (
        <ul aria-label="Kurulum adımları" className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {required.map((s) => (
            <StepRow
              key={s.id}
              id={s.id}
              title={s.title}
              done={s.done}
              status={s.done ? "Tamamlandı" : skipped.includes(s.id) ? "Sonra yapılacak" : "Bekliyor"}
            />
          ))}
        </ul>
      ) : null}

      <ButtonLink href="/app" size="lg" iconRight={ArrowRight}>
        Bugün ekranına git
      </ButtonLink>

      {optional.length > 0 ? (
        <details className="group rounded-[var(--radius-card)] border border-line">
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 text-base font-semibold text-text">
            İsteğe bağlı ayarlar ({optional.filter((s) => !s.done).length} açık)
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {optional.map((s) => (
              <StepRow key={s.id} id={s.id} title={s.title} done={s.done} status={s.done ? "Tamamlandı" : "İsteğe bağlı"} />
            ))}
          </ul>
        </details>
      ) : null}

      {openTasks.length > 0 ? (
        <details className="rounded-[var(--radius-card)] border border-line">
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold text-text">
            İlk işler ({openTasks.length})
          </summary>
          <ul className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
            {openTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.href}
                  className="focus-ring flex min-h-11 flex-col justify-center rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2 transition hover:border-brand-300"
                >
                  <span className="text-sm font-semibold text-ink-950">{t.title}</span>
                  <span className="text-sm text-text-muted">{t.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {sampleCustomers > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
          <FlaskConical className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-text-muted">
            Ofisinizde &quot;Örnek veri&quot; rozetli kayıtlar var. Hazır olunca tek tuşla silip gerçek kullanıma geçebilirsiniz.
          </p>
          <ButtonLink href="/app/ayarlar/gercek-kullanim" variant="secondary">
            Gerçek kullanıma geç
          </ButtonLink>
        </div>
      ) : null}

      {/* Tur kendiliğinden başlamaz: kullanıcı isterse kısa turu buradan açar. */}
      <FinishTourStarter auto={false} />
    </div>
  );
}
