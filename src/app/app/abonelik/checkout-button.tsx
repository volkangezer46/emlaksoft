"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { startPlanCheckout } from "@/app/actions/billing";
import type { BillingCycle, PlanId } from "@/lib/billing/plans";

export function CheckoutButton({
  plan,
  cycle,
  label,
  variant = "primary",
  couponsEnabled = false,
  canSaveCard = false,
  savedCardLabel = null,
}: {
  plan: PlanId;
  cycle: BillingCycle;
  label: string;
  variant?: "primary" | "ghost";
  /** coupons tablosu yoksa (migration uygulanmadı) kupon alanı hiç gösterilmez. */
  couponsEnabled?: boolean;
  /** "Kartımı sakla" açık rızası gösterilsin (owner/gm + kart tabloları hazır + iyzico bağlı). */
  canSaveCard?: boolean;
  /** Kayıtlı varsayılan kartın maskeli etiketi: doluysa "bu kartla öde" kısayolu görünür. */
  savedCardLabel?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  // Açık rıza: VARSAYILAN KAPALI. Kart verisi bu bileşende/sunucumuzda hiç yoktur; kart iyzico sayfasında girilir.
  const [saveCard, setSaveCard] = useState(false);
  const [confirmSaved, setConfirmSaved] = useState(false);

  async function onClick(useSavedCard = false) {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("plan", plan);
    fd.set("cycle", cycle);
    if (couponsEnabled && coupon.trim()) fd.set("coupon", coupon.trim());
    if (canSaveCard && saveCard) fd.set("save_card", "1");
    if (useSavedCard) fd.set("use_saved_card", "1");
    const result = await startPlanCheckout(fd);
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
      return;
    }
    setPending(false);
    setError(result.error ?? "Ödeme başlatılamadı.");
  }

  return (
    <div>
      {couponsEnabled ? (
        <div className="mb-2">
          <label htmlFor={`coupon-${plan}`} className="sr-only">Kupon kodu</label>
          <input
            id={`coupon-${plan}`}
            type="text"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="Kupon kodu (varsa)"
            autoComplete="off"
            maxLength={40}
            className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs uppercase tracking-wide text-ink-950 placeholder:normal-case placeholder:tracking-normal"
          />
        </div>
      ) : null}
      {canSaveCard ? (
        <label className="mb-2 flex items-start gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(e) => setSaveCard(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Kartımı sonraki ödemeler için iyzico&apos;da sakla. Kart bilgilerim EmlakSoft&apos;ta tutulmaz; istediğim zaman silebilirim.
          </span>
        </label>
      ) : null}
      {savedCardLabel ? (
        confirmSaved ? (
          <div className="mb-2 rounded-[var(--radius-control)] border border-brand-300 bg-brand-600/5 p-2 text-xs text-ink-950">
            <p>{savedCardLabel} kartınızla ödeme için iyzico güvenli sayfasına yönlendirileceksiniz.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => onClick(true)}
                className="rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 font-semibold text-white disabled:opacity-60"
              >
                Onayla ve öde
              </button>
              <button type="button" onClick={() => setConfirmSaved(false)} className="font-semibold text-text-muted hover:underline">
                Vazgeç
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmSaved(true)}
            className="mb-2 inline-flex w-full items-center justify-center rounded-[var(--radius-control)] border border-brand-300 px-4 py-2 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5 disabled:opacity-60"
          >
            Kayıtlı kartla öde · {savedCardLabel}
          </button>
        )
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => onClick()}
        className={
          variant === "primary"
            ? "btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            : "inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:border-brand-400 disabled:opacity-60"
        }
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {pending ? "Yönlendiriliyor…" : label}
      </button>
      {error ? <p className="mt-2 text-xs text-danger-500" role="alert">{error}</p> : null}
    </div>
  );
}
