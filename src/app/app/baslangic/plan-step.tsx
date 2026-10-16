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
 * İsteğe bağlı "Paket seç" adımı. Ödenmiş abonelikte yalnız mevcut paketin özeti ve "Paketi değiştir" bağlantısı görünür
 * (öneri çıkmaz). Denemede varsayılan "Denemeye devam et"; danışman sayısı ofisin üye sayısıyla başlar. Paket değişikliği ve
 * ödeme /app/abonelik'teki mevcut akışta yapılır; online ödeme kapalıyken o bağlantı yerine destek bağlantısı verilir.
 */
export function PlanStep({
  plans,
  offers,
  trialText,
  efValuationCost,
  efLive,
  nextHref,
  canManageBilling,
  current,
  initialSeats,
  paymentOffNote,
  supportHref,
}: {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  trialText: string;
  efValuationCost?: number;
  efLive?: boolean;
  nextHref: string;
  canManageBilling: boolean;
  /** Ödenmiş abonelikte mevcut paket (öneri yerine özet gösterilir). */
  current: { planName: string; members: number; seatLimit: number } | null;
  /** Ofisin etkin üye sayısı (danışman sayısının başlangıç değeri). */
  initialSeats: number;
  /** Online ödeme kapalıyken gösterilecek metin; null = ödeme (ya da demo) açık. */
  paymentOffNote: string | null;
  supportHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (current) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text">
              Mevcut paketiniz: {current.planName} · {current.members}/{current.seatLimit} kullanıcı
            </p>
            <p className="mt-0.5 text-xs text-text-muted">Aboneliğiniz etkin; bu adımda yapılacak bir şey yok.</p>
          </div>
          {canManageBilling ? (
            <ButtonLink href="/app/abonelik#paketler" variant="secondary" iconRight={ArrowRight}>
              Paketi değiştir
            </ButtonLink>
          ) : null}
        </div>
      </div>
    );
  }

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
        initialSeats={initialSeats}
        trialText={trialText}
        efValuationCost={efValuationCost}
        efLive={efLive}
        footer={(sel) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" onClick={continueTrial} loading={pending}>
              Denemeye devam et
            </Button>
            {canManageBilling && paymentOffNote ? (
              <ButtonLink href={supportHref} variant="secondary" iconRight={ArrowRight}>
                Paket için destekle görüş
              </ButtonLink>
            ) : canManageBilling ? (
              <ButtonLink href="/app/abonelik#paketler" variant="secondary" iconRight={ArrowRight}>
                {sel.planName} için abonelik sayfasına git
              </ButtonLink>
            ) : null}
          </div>
        )}
      />
      <p className="text-xs text-text-faint">
        {paymentOffNote ?? "Kart gerekmez; paketi istediğiniz an Abonelik sayfasından seçebilirsiniz."}
      </p>
    </div>
  );
}
