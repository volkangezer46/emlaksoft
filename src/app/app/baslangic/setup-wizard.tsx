import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ExternalLink, FileUp, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Celebrate } from "@/components/ui/celebrate";
import { Progress } from "@/components/ui/progress";
import { SampleSeedButton } from "@/app/app/_home/sample-seed-button";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";
import {
  FINISH_STEP,
  wizardNeighbors,
  type OnboardingState,
  type OnboardingStepId,
  type WizardStepKey,
} from "@/lib/onboarding-checklist";
import { OfficeStep } from "./office-step";
import type { GeoOption } from "@/lib/geo/types";
import { TeamStep } from "./team-step";
import { QuickLossReason } from "./defs-step";
import { SkipButton } from "./skip-button";
import { StartChoice } from "./start-choice";
import { FinishTourStarter } from "./finish-tour";

export type SetupWizardProps = {
  state: OnboardingState;
  skipped: OnboardingStepId[];
  current: WizardStepKey;
  canEditSettings: boolean;
  canInvite: boolean;
  showSampleData: boolean;
  /** Bos ofis ve tanim girilmemis: "Nasil baslamak istersiniz?" paneli (ofis tipi + demo/bos). */
  showStartChoice: boolean;
  canSeedSample: boolean;
  office: { name: string; phone: string; city: string; provinceId: string | null; districtId: string | null; addressLine: string; licenseNo: string; taxNumber: string; logoUrl: string | null };
  lossReasons: { value: string; label: string }[];
  stageLabels: { key: string; label: string }[];
  customers: number;
  properties: number;
  vitrinHref: string | null;
  provinces: GeoOption[];
};

const href = (k: WizardStepKey) => `/app/baslangic?adim=${k}`;

/**
 * Ofis kurulum sihirbazı. Adım URL'de (`?adim=`) durur: geri/ileri tarayıcıyla çalışır, ana ekran
 * şeridi doğrudan sıradaki adıma gelir. Tamamlanma gerçek veriden hesaplanır (onboarding-state);
 * hiçbir adım zorunlu değildir ("Sonra yaparım").
 */
export function SetupWizard(props: SetupWizardProps) {
  const { state, skipped, current } = props;
  const { prev, next } = wizardNeighbors(current);
  const step = state.steps.find((s) => s.id === current) ?? null;
  const nextHref = href(next ?? FINISH_STEP);

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
              {[...state.steps.map((s) => ({ key: s.id as WizardStepKey, short: s.short, done: s.done })), { key: FINISH_STEP as WizardStepKey, short: "Bitiş", done: state.complete }].map(
                (s, i) => {
                  const isCurrent = s.key === current;
                  const isSkipped = !s.done && skipped.includes(s.key as OnboardingStepId);
                  return (
                    <li key={s.key} className="shrink-0">
                      <Link
                        href={href(s.key)}
                        aria-current={isCurrent ? "step" : undefined}
                        className={
                          "focus-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition " +
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
                },
              )}
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
              <StepBody id={step.id} done={step.done} nextHref={nextHref} {...props} />
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
          {step ? (
            <SkipButton stepId={step.id} nextHref={nextHref} skipped={skipped.includes(step.id) && !step.done} />
          ) : null}
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

function StepBody(props: SetupWizardProps & { id: OnboardingStepId; done: boolean; nextHref: string }) {
  switch (props.id) {
    case "office":
      return <OfficeStep canEdit={props.canEditSettings} nextHref={props.nextHref} initial={props.office} provinces={props.provinces} />;
    case "team":
      return <TeamStep canInvite={props.canInvite} nextHref={props.nextHref} />;
    case "data":
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceLink
              href="/app/ice-aktarma"
              icon={<FileUp className="h-5 w-5" aria-hidden />}
              title="Dosyadan içe aktar"
              text="Excel/CSV müşteri ve portföy listenizi yükleyin; eşleştirmeyi önizleyin, hatalıysa geri alın."
            />
            <ChoiceLink
              href="/app/musteriler/yeni"
              icon={<Sparkles className="h-5 w-5" aria-hidden />}
              title="İlk müşterinizi elle ekleyin"
              text="Tek kayıtla başlayın; talep, randevu ve anlaşma bu kayıttan doğar."
            />
          </div>
          <p className="text-sm text-text-muted">
            Şu an <strong className="text-text">{props.customers}</strong> müşteriniz var.
          </p>
          {props.showSampleData && props.canEditSettings ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3">
              <p className="min-w-0 flex-1 text-sm text-text-muted">Önce sistemi denemek ister misiniz? Örnek veri yüklenir; hazır olunca tek tuşla tamamı silinir.</p>
              <SampleSeedButton />
            </div>
          ) : null}
        </div>
      );
    case "property":
      return (
        <div className="space-y-3">
          <ButtonLink href="/app/portfoyler/yeni" iconRight={ArrowRight}>
            İlk ilanı ekle
          </ButtonLink>
          <p className="text-sm text-text-muted">
            Şu an <strong className="text-text">{props.properties}</strong> portföyünüz var. Başlık, fiyat ve konum yeterli; fotoğraf ve ayrıntıları sonra ekleyebilirsiniz.
          </p>
        </div>
      );
    case "defs":
      return (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">Kayıp nedenleri</h3>
              <ul className="flex flex-wrap gap-1.5">
                {props.lossReasons.map((r) => (
                  <li key={r.value} className="rounded-full bg-line px-2.5 py-1 text-xs text-text">
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">Anlaşma aşamaları</h3>
              <ul className="flex flex-wrap gap-1.5">
                {props.stageLabels.map((r) => (
                  <li key={r.key} className="rounded-full bg-line px-2.5 py-1 text-xs text-text">
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <QuickLossReason canEdit={props.canEditSettings} />
          <p className="text-sm text-text-muted">
            Komisyon oranı portföy bazındadır; oran girilmediğinde varsayılan <strong className="text-text">%{DEFAULT_COMMISSION_RATE}</strong> kullanılır, portföy formunda değiştirebilirsiniz.
          </p>
          <ButtonLink href="/app/ayarlar/tanimlar" variant="secondary" iconRight={ExternalLink}>
            Tüm tanımları düzenle (aşama adları, renkler)
          </ButtonLink>
        </div>
      );
    case "portals":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceLink
              href="/app/portallar"
              icon={<ExternalLink className="h-5 w-5" aria-hidden />}
              title="Portal yayınları"
              text="İlanları portallara gönderin, yayın durumunu ve onay bekleyenleri izleyin."
            />
            <ChoiceLink
              href="/app/ayarlar/lead"
              icon={<Sparkles className="h-5 w-5" aria-hidden />}
              title="Talep toplama ve mesaj kanalı"
              text="Web formu ve WhatsApp/SMS bağlantısıyla gelen talepler doğrudan size düşsün."
            />
          </div>
          {props.vitrinHref ? (
            <p className="text-sm text-text-muted">
              Vitrininiz:{" "}
              <a className="font-semibold text-brand-600 hover:underline" href={props.vitrinHref} target="_blank" rel="noreferrer">
                {props.vitrinHref}
              </a>
            </p>
          ) : null}
        </div>
      );
  }
}

function ChoiceLink({ href: to, icon, title, text }: { href: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link
      href={to}
      className="focus-ring group flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{text}</span>
      </span>
    </Link>
  );
}

function FinishPanel({ state, skipped }: SetupWizardProps) {
  const pendingSteps = state.steps.filter((s) => !s.done);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        {state.complete ? <Celebrate label="Kurulum tamamlandı" /> : null}
        <div>
          <h2 className="font-display text-lg font-bold text-text">
            {state.complete ? "Ofisiniz hazır" : "Kurulum özeti"}
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {state.complete
              ? "Tüm adımlar tamam. Günlük işleriniz Bugün ekranında sizi bekliyor."
              : `${state.doneCount} / ${state.total} adım tamam. Kalanları istediğiniz zaman buradan sürdürebilirsiniz.`}
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
                <Link href={href(s.id)} className="focus-ring text-xs font-semibold text-brand-600 hover:underline">
                  Aç
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!state.complete && pendingSteps.length > 0 ? (
        <Alert tone="info">Ana ekranda kurulum şeridi, sonra yapılacak olmayan sıradaki adımı size hatırlatır.</Alert>
      ) : null}
      {state.complete ? <FinishTourStarter /> : null}
      <ButtonLink href="/app" iconRight={ArrowRight}>
        Bugün ekranına git
      </ButtonLink>
    </div>
  );
}
