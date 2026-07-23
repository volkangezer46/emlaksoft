"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markPaymentLinkPaid, startPaymentLinkCheckout } from "@/app/actions/payment-links";

export function PayButtons({ token, iyzicoReady }: { token: string; iyzicoReady: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function payLive() {
    setPending(true);
    setError(null);
    const res = await startPaymentLinkCheckout(token);
    setPending(false);
    if (res.checkoutUrl) {
      window.location.href = res.checkoutUrl;
      return;
    }
    setError(res.error ?? "Ödeme başlatılamadı.");
  }

  async function payDemo() {
    setPending(true);
    setError(null);
    const res = await markPaymentLinkPaid(token);
    setPending(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Demo tahsilat başarısız.");
  }

  return (
    <div className="space-y-3">
      {iyzicoReady ? (
        <button
          type="button"
          disabled={pending}
          onClick={payLive}
          className="btn-shine w-full rounded-[11px] bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Yönlendiriliyor…" : "iyzico ile güvenli öde"}
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={payDemo}
          className="btn-shine w-full rounded-[11px] bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "İşleniyor…" : "Ödemeyi tamamla (demo)"}
        </button>
      )}
      {error ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
    </div>
  );
}
