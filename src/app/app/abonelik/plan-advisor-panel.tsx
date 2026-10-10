"use client";

import { useState } from "react";
import { ArrowDown, Calculator } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PlanExplorer } from "@/components/billing/plan-explorer";
import type { PlanDef } from "@/lib/billing/plans";
import type { SeatCalcOffers } from "@/lib/billing/seat-calculator-model";

/** Kapalı başlar; açılınca animasyonlu seçici yüklenir (ilk boyamada ağır JS yok). */
export function PlanAdvisorPanel({
  plans,
  offers,
  trialText,
  efValuationCost,
  efLive,
}: {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  trialText: string;
  efValuationCost?: number;
  efLive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-bold text-ink-950">
        <Calculator className="h-4 w-4 text-brand-600" aria-hidden /> Ekibine göre paket öner
        <span className="ml-auto text-xs font-semibold text-text-muted">Kaç danışmanla çalışacağını yaz, paketi görelim</span>
      </summary>
      {open ? (
        <div className="mt-4">
          <PlanExplorer
            plans={plans}
            offers={offers}
            trialText={trialText}
            efValuationCost={efValuationCost}
            efLive={efLive}
            footer={(sel) => (
              <div className="flex justify-center">
                <ButtonLink href="#paketler" variant="secondary" icon={ArrowDown}>
                  {sel.planName} paketi aşağıda
                </ButtonLink>
              </div>
            )}
          />
        </div>
      ) : null}
    </details>
  );
}
