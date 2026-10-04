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
}: {
  plan: PlanId;
  cycle: BillingCycle;
  label: string;
  variant?: "primary" | "ghost";
  /** coupons tablosu yoksa (migration uygulanmadı) kupon alanı hiç gösterilmez. */
  couponsEnabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");

  async function onClick() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("plan", plan);
    fd.set("cycle", cycle);
    if (couponsEnabled && coupon.trim()) fd.set("coupon", coupon.trim());
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
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
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
