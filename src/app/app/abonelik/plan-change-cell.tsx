"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarClock, RotateCcw } from "lucide-react";
import { cancelScheduledDowngrade, scheduleDowngrade, startPlanUpgrade } from "@/app/actions/plan-change";
import { BILLING_VAT_RATE } from "@/lib/billing/plans";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { WalletCreditToggle, type WalletCheckoutInfo } from "@/components/app/wallet-credit-toggle";

const fmt2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const tl2 = (n: number) => `${fmt2.format(n)} ₺`;
const tl0 = (n: number) => `${fmt0.format(n)} ₺`;

/** Sunucunun `evaluatePlanChange` ile hesapladığı teklif (istemci TUTAR HESAPLAMAZ; yalnız gösterir). */
export type PlanChangeQuoteView = {
  planId: string;
  planName: string;
  fromName: string;
  status: "upgrade" | "downgrade" | "over_capacity";
  /** Yükseltmede şimdi ödenecek net tutar (KDV hariç). */
  chargeNetTry: number;
  creditTry: number;
  newCostTry: number;
  toPeriodTry: number;
  fromPeriodTry: number;
  ratioPct: number;
  message: string;
  /** Dönem sonu (okunabilir). */
  periodEndLabel: string | null;
  cycleWord: "ay" | "yıl";
};

/**
 * Plan kartındaki paket değiştirme düğmesi (oransal yükseltme / dönem sonunda düşürme).
 * Yükseltme: tutar değişirse sunucu yeniden onay ister. Düşürme: iade yok, dönem sonunda uygulanır.
 */
export function PlanChangeCell({
  quote,
  canChange,
  scheduled,
  wallet,
}: {
  quote: PlanChangeQuoteView;
  canChange: boolean;
  /** Bu paket zaten dönem sonu için planlı: geri alma gösterilir. */
  scheduled: boolean;
  wallet?: WalletCheckoutInfo | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [useCredit, setUseCredit] = useState(false);

  async function upgrade() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("plan", quote.planId);
    fd.set("confirm_try", String(quote.chargeNetTry));
    if (useCredit && wallet) fd.set("use_credit", "1");
    const result = await startPlanUpgrade(fd);
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
      return;
    }
    setPending(false);
    setConfirming(false);
    setError(result.error ?? "Ödeme başlatılamadı.");
    if (result.quotedChargeTry !== undefined) router.refresh();
  }

  async function schedule() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("plan", quote.planId);
    const result = await scheduleDowngrade(fd);
    setPending(false);
    setConfirming(false);
    if (result.ok) {
      setDone(result.message ?? "Planlandı.");
      router.refresh();
      return;
    }
    setError(result.error ?? "Planlanamadı.");
  }

  async function undo() {
    setPending(true);
    setError(null);
    const result = await cancelScheduledDowngrade();
    setPending(false);
    if (result.ok) {
      setDone(null);
      router.refresh();
      return;
    }
    setError(result.error ?? "Geri alınamadı.");
  }

  if (scheduled) {
    return (
      <div className="space-y-2">
        <Alert tone="info" title="Dönem sonunda geçilecek">
          {quote.planName} paketine geçiş {quote.periodEndLabel ?? "dönem sonunda"} uygulanacak.
        </Alert>
        <Button variant="secondary" size="sm" icon={RotateCcw} loading={pending} onClick={undo} className="w-full">
          Planlı değişikliği geri al
        </Button>
        {error ? <p className="text-xs text-danger-600" role="alert">{error}</p> : null}
      </div>
    );
  }

  if (quote.status === "over_capacity") {
    return (
      <p className="rounded-[var(--radius-control)] border border-dashed border-line-strong px-3 py-2 text-center text-xs text-text-muted">
        {quote.message}
      </p>
    );
  }

  const isUpgrade = quote.status === "upgrade";

  return (
    <div>
      {!confirming ? (
        <Button
          variant={isUpgrade ? "primary" : "secondary"}
          icon={isUpgrade ? ArrowUpRight : CalendarClock}
          disabled={!canChange || pending}
          onClick={() => setConfirming(true)}
          className="w-full"
        >
          {isUpgrade ? "Oransal yükselt" : "Dönem sonunda geç"}
        </Button>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-brand-400 bg-surface p-3 text-xs">
          <p className="text-sm font-semibold text-ink-950">Onaylıyor musunuz?</p>
          {isUpgrade ? (
            <>
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-text-muted">{quote.planName} (kalan %{quote.ratioPct})</dt>
                  <dd className="numeric font-semibold">{tl2(quote.newCostTry)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-text-muted">{quote.fromName} kredisi (kalan %{quote.ratioPct})</dt>
                  <dd className="numeric font-semibold">- {tl2(quote.creditTry)}</dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-line pt-1">
                  <dt className="font-semibold text-ink-950">Şimdi ödenecek (KDV hariç)</dt>
                  <dd className="numeric font-display text-sm font-extrabold text-ink-950">{tl2(quote.chargeNetTry)}</dd>
                </div>
              </dl>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-text-muted">
                <li>Ödeme tamamlanınca {quote.planName} paketi hemen geçerli olur; dönem sonunuz değişmez{quote.periodEndLabel ? ` (${quote.periodEndLabel})` : ""}.</li>
                <li>Sonraki yenilemede {quote.planName} paketinin tam tutarı ({tl0(quote.toPeriodTry)} / {quote.cycleWord}) alınır.</li>
              </ul>
              <WalletCreditToggle
                wallet={wallet}
                checked={useCredit}
                onChange={setUseCredit}
                totalTry={Math.round(quote.chargeNetTry * (1 + BILLING_VAT_RATE) * 100) / 100}
                disabled={pending}
                idPrefix={`upg-${quote.planId}`}
              />
            </>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-text-muted">
              <li>{quote.message}</li>
              <li>Yenilemeden itibaren {quote.planName} paketinin tutarı ({tl0(quote.toPeriodTry)} / {quote.cycleWord}) alınır.</li>
              <li>Kısmi iade veya kredi verilmez; dönem bitmeden planı geri alabilirsiniz.</li>
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" loading={pending} onClick={isUpgrade ? upgrade : schedule}>
              {isUpgrade ? "Onayla ve öde" : "Dönem sonuna planla"}
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
          </div>
        </div>
      )}
      {!canChange ? <p className="mt-2 text-xs text-text-muted">Paketi yalnızca ofis sahibi veya genel müdür değiştirebilir.</p> : null}
      {done ? <p className="mt-2 text-xs text-success-strong" role="status">{done}</p> : null}
      {error ? <p className="mt-2 text-xs text-danger-600" role="alert">{error}</p> : null}
    </div>
  );
}
