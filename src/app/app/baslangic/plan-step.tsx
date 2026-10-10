"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { PlanExplorer } from "@/components/billing/plan-explorer";
import { setSetupStepSkipped } from "@/app/actions/onboarding-setup";
import type { PlanDef } from "@/lib/billing/plans";
import type { SeatCalcOffers } from "@/lib/billing/seat-calculator-model";

/**
 * İsteğe bağlı "Paket seç" adımı. Varsayılan "Denemeye devam et": deneme süresince her şey açıktır, kart istenmez.
 * Paket değişikliği ve ödeme /app/abonelik'teki mevcut akışta yapılır (oransal yükseltme, iyzico); burada karşılaştırılır.
 */
export function PlanStep({
  plans,
  offers,
  trialText,
  efValuationCost,
  efLive,
  nextHref,
  canManageBilling,
}: {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  trialText: string;
  efValuationCost?: number;
  efLive?: boolean;
  nextHref: string;
  canManageBilling: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function continueTrial() {
    startTransition(async () => {
      await setSetupStepSkipped("plan", true);
      router.push(nextHref);
    });
  }

  return (
    <div className="space-y-4">
      <PlanExplorer
        plans={plans}
        offers={offers}
        trialText={trialText}
        efValuationCost={efValuationCost}
        efLive={efLive}
        footer={(sel) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" onClick={continueTrial} loading={pending}>
              Denemeye devam et
            </Button>
            {canManageBilling ? (
              <ButtonLink href="/app/abonelik#paketler" variant="secondary" iconRight={ArrowRight}>
                {sel.planName} için abonelik sayfasına git
              </ButtonLink>
            ) : null}
          </div>
        )}
      />
      <p className="text-xs text-text-faint">Kart gerekmez; paketi istediğin an Abonelik sayfasından seçebilirsin.</p>
    </div>
  );
}
