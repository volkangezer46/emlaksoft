"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { formatNumberTr } from "@/lib/format";
import { efCreditsLine } from "@/lib/ef-credits/plan-credits";
import { efPlannedLine } from "@/lib/ef-credits/public-state-core";
import { getPlan, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { registrationQuote, registrationSelection, seatBounds, type SeatCalcOffers } from "@/lib/billing/seat-calculator-model";

/**
 * Animasyonlu paket seçici (motion + animasyonlu sayı) yalnız açılınca iner: ilk boyamada ağır JS yok.
 * Yükleme sırasında aynı yükseklikte iskelet (CLS yok).
 */
const PlanPicker = dynamic(() => import("./plan-picker").then((m) => m.PlanPicker), {
  ssr: false,
  loading: () => <div className="h-[34rem] animate-pulse rounded-[var(--radius-card)] bg-line/60" aria-hidden />,
});

export type PlanExplorerSelection = {
  planId: PlanId;
  planName: string;
  seats: number;
  cycle: BillingCycle;
  /** Aylık eşdeğer tutar (KDV hariç, yıllıkta /12); teklif yoksa null. */
  monthlyTry: number | null;
};

/**
 * Paket seçici + durum (danışman sayısı, dönem, öneri/elle seçim). Kayıttan çıkarıldı; Kurulum sihirbazının isteğe
 * bağlı "Paket seç" adımında ve /app/abonelik'te kullanılır. Tutarlar `registrationQuote` (fiyat sayfasıyla AYNI motor).
 * Gerçek paket değişikliği/ödeme abonelik sayfasındaki mevcut akıştadır; burası karşılaştırma ve seçimdir.
 */
export function PlanExplorer({
  plans,
  offers,
  trialText,
  initialSeats,
  initialCycle = "monthly",
  efValuationCost,
  efLive = false,
  footer,
}: {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  trialText: string;
  initialSeats?: number;
  initialCycle?: BillingCycle;
  /** Bir değerlemenin kontör bedeli (sunucuda tarifeden); "yaklaşık N değerleme" metni için. */
  efValuationCost?: number;
  /** EmlakFiyati canlı mı (tek durum kaynağı); değilse kontör satırı "(planlanan)" ve satın alma cümlesi yok. */
  efLive?: boolean;
  /** Seçili paketi alıp eylem düğmelerini çizen alan. */
  footer?: (sel: PlanExplorerSelection) => ReactNode;
}) {
  const maxSeats = seatBounds(plans).inputMax;
  const [seats, setSeats] = useState(() => Math.min(maxSeats, Math.max(1, initialSeats ?? 2)));
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  const [chosen, setChosen] = useState<PlanId | null>(null);

  const selection = registrationSelection(plans, offers, seats, cycle, null);
  const recommendedId = selection.calc.planId as PlanId;
  const chosenQuote = chosen ? registrationQuote(plans, offers, chosen, seats, cycle) : null;
  const selectedId: PlanId = chosen && chosenQuote && !chosenQuote.maxSeatsExceeded ? chosen : (selection.planId as PlanId);
  const quote = registrationQuote(plans, offers, selectedId, seats, cycle);
  const plan = plans.find((p) => p.id === selectedId) ?? getPlan(selectedId);
  const monthlyTry = quote ? (cycle === "yearly" ? Math.round(quote.totalForCycleTry / 12) : quote.totalMonthlyTry) : null;

  const efLine = efPlannedLine(efCreditsLine(plan.efCreditsMonthly, efValuationCost ?? 0), efLive);

  return (
    <div className="space-y-4">
      <PlanPicker
        plans={plans}
        offers={offers}
        seats={seats}
        seatsMax={maxSeats}
        onSeatsChange={(n) => {
          setSeats(n);
          // Ekip büyüklüğü değişince öneri yeniden hesaplanır; eski elle seçim bırakılır.
          setChosen(null);
        }}
        cycle={cycle}
        onCycleChange={setCycle}
        recommendedId={recommendedId}
        selectedId={selectedId}
        onSelect={setChosen}
        overMaxNote={selection.calc.status === "over_max" ? selection.calc.limitNote : null}
        trialText={trialText}
      />
      {efLine ? (
        <p className="text-xs font-semibold text-mint-700">
          {efLine}
          {efLive ? "; kontör ile ek sorgu satın alınabilir." : "."}
        </p>
      ) : null}
      <p className="text-center text-xs text-text-muted" aria-live="polite">
        <strong className="text-ink-950">{plan.name}</strong> · {formatNumberTr(seats)} kullanıcı
        {monthlyTry !== null ? ` · ${formatNumberTr(monthlyTry)} ₺/ay + KDV (deneme sonrası)` : ""}
      </p>
      {footer ? footer({ planId: selectedId, planName: plan.name, seats, cycle, monthlyTry }) : null}
    </div>
  );
}
