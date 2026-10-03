"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setSetupStepSkipped } from "@/app/actions/onboarding-setup";
import type { OnboardingStepId } from "@/lib/onboarding-checklist";

/** "Sonra yaparım": tercihi çereze yazar ve sonraki adıma geçer (ya da geri alır). */
export function SkipButton({
  stepId,
  nextHref,
  skipped,
}: {
  stepId: OnboardingStepId;
  nextHref: string;
  skipped: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await setSetupStepSkipped(stepId, !skipped);
          if (skipped) router.refresh();
          else router.push(nextHref);
        })
      }
    >
      {skipped ? "Sonra yapılacak işaretini kaldır" : "Sonra yaparım"}
    </Button>
  );
}
