"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { markPaymentLinkPaid, startPaymentLinkCheckout } from "@/app/actions/payment-links";
import { EmailInput } from "@/components/ui/email-input";
import { PhoneInput } from "@/components/ui/phone-input";

type BuyerDefaults = { fullName: string; email: string; phone: string };

const inputClass = "mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-brand-400";

export function PayButtons({
  token,
  iyzicoReady,
  defaults,
}: {
  token: string;
  iyzicoReady: boolean;
  defaults: BuyerDefaults;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function payLive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await startPaymentLinkCheckout(token, new FormData(event.currentTarget));
    setPending(false);
    if (res.checkoutUrl) {
      window.location.href = res.checkoutUrl;
      return;
    }
    if (res.url) {
      window.location.href = res.url;
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
        <form onSubmit={payLive} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Ad soyad
              <input
                name="full_name"
                required
                minLength={3}
                maxLength={120}
                autoComplete="name"
                defaultValue={defaults.fullName}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              E-posta
              <EmailInput
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                defaultValue={defaults.email}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Cep telefonu
              <PhoneInput
                name="phone"
                required
                autoComplete="tel"
                defaultValue={defaults.phone}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              T.C. kimlik / vergi numarası
              <input
                name="identity_number"
                inputMode="numeric"
                required
                minLength={10}
                maxLength={14}
                autoComplete="off"
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Şehir
              <input name="city" required minLength={2} maxLength={80} autoComplete="address-level1" className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Açık adres
              <textarea
                name="address"
                required
                minLength={10}
                maxLength={250}
                rows={2}
                autoComplete="street-address"
                className={`${inputClass} resize-none`}
              />
            </label>
          </div>
          <p className="text-xs leading-relaxed text-text-faint">
            Bu bilgiler yalnızca ödeme sağlayıcısının zorunlu alıcı doğrulaması için kullanılır.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="btn-shine w-full rounded-[var(--radius-control)] bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Yönlendiriliyor…" : "iyzico ile güvenli öde"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={payDemo}
          className="btn-shine w-full rounded-[var(--radius-control)] bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "İşleniyor…" : "Ödemeyi tamamla (demo)"}
        </button>
      )}
      {error ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
    </div>
  );
}
