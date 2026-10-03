"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { saveOfficeProfile } from "@/app/actions/onboarding-setup";
import { seedSampleData } from "@/app/actions/sample-data";
import type { OnboardingStep, OnboardingStepId } from "@/lib/onboarding-checklist";
import { PhoneInput } from "@/components/ui/phone-input";

type Props = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  percent: number;
  complete: boolean;
  canEdit: boolean;
  showSampleData: boolean;
  profile: { phone: string; city: string; licenseNo: string };
};

const inputCls =
  "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-text";

export function SetupWizard({ steps, doneCount, total, percent, complete, canEdit, showSampleData, profile }: Props) {
  const router = useRouter();
  const [skipped, setSkipped] = useState<OnboardingStepId[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const nextId = steps.find((s) => !s.done && !skipped.includes(s.id))?.id ?? null;

  function runSeed() {
    setError(null);
    startTransition(async () => {
      const result = await seedSampleData();
      if (result.error) return setError(result.error);
      router.refresh();
    });
  }

  function submitProfile(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveOfficeProfile(formData);
      if (result.error) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-text">
              {doneCount} / {total} adım tamam
            </p>
            <p className="text-sm font-semibold text-text-muted">%{percent}</p>
          </div>
          <Progress value={percent} label="Kurulum ilerlemesi" tone={complete ? "success" : "accent"} />
        </CardContent>
      </Card>

      {complete ? (
        <Alert
          tone="success"
          title="Ofisiniz hazır"
          action={<ButtonLink href="/app" size="sm">Ana ekrana git</ButtonLink>}
        >
          Tüm kurulum adımları tamamlandı. Şimdi ilk talebi eşleştirebilir ya da randevu planlayabilirsiniz.
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {showSampleData && canEdit ? (
        <Alert
          tone="info"
          title="Önce sistemi örnek veriyle deneyin"
          action={
            <Button size="sm" icon={Sparkles} loading={pending} onClick={runSeed}>
              Örnek veri yükle
            </Button>
          }
        >
          Örnek müşteri, portföy, görev ve randevular yüklenir; tek tıkla temizlenir.
        </Alert>
      ) : null}

      <ol className="space-y-3">
        {steps.map((step, i) => {
          const isNext = step.id === nextId;
          const isSkipped = skipped.includes(step.id) && !step.done;
          return (
            <li key={step.id}>
              <Card className={isNext ? "ring-2 ring-accent" : step.done ? "opacity-80" : undefined}>
                <CardContent>
                  <div className="flex items-start gap-3">
                    <span
                      className={
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold " +
                        (step.done ? "bg-mint-500 text-white" : isNext ? "bg-accent text-white" : "bg-line text-text-muted")
                      }
                      aria-hidden
                    >
                      {step.done ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold text-text">
                        {step.title}
                        {step.done ? <span className="sr-only"> (tamamlandı)</span> : null}
                        {isSkipped ? <span className="ml-2 text-xs font-normal text-text-muted">Sonra yapılacak</span> : null}
                      </h2>
                      <p className="mt-0.5 text-xs text-text-muted">{step.description}</p>

                      {!step.done && step.id === "profile" && canEdit ? (
                        <form action={submitProfile} className="mt-3 grid gap-2 sm:grid-cols-3">
                          <PhoneInput name="phone" defaultValue={profile.phone} className={inputCls} />
                          <input name="city" defaultValue={profile.city} placeholder="Şehir" aria-label="Şehir" className={inputCls} />
                          <input name="license_no" defaultValue={profile.licenseNo} placeholder="Ruhsat no" aria-label="Ruhsat numarası" className={inputCls} />
                          <div className="sm:col-span-3">
                            <Button type="submit" size="sm" loading={pending}>
                              Kaydet
                            </Button>
                          </div>
                        </form>
                      ) : null}

                      {!step.done ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <ButtonLink
                            href={step.href}
                            size="sm"
                            variant={isNext ? "primary" : "secondary"}
                            iconRight={ArrowRight}
                          >
                            {step.cta}
                          </ButtonLink>
                          {!isSkipped ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSkipped((s) => [...s, step.id])}
                            >
                              Sonra yap
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
