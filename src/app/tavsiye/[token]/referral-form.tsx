"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Phone, Send } from "lucide-react";
import { submitReferralByToken } from "@/app/actions/referral-public";
import { formatTurkishPhone, sanitizeTurkishPhoneInput, toTelHref, TR_MOBILE_PLACEHOLDER } from "@/lib/phone";

const inputCls =
  "w-full rounded-[12px] border border-line bg-canvas px-3.5 py-3 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";

/**
 * Tavsiye formu + teşekkür ekranı.
 *
 * NEDEN CLIENT: server action sonucu sayfa yenilenmeden gösterilir
 * (checkin-form deseni). Telefonda basit maske (sanitizeTurkishPhoneInput).
 * Honeypot form içindedir ve `<form action={submit}>` kullanıldığı için
 * gerçekten gönderilir (anket formundaki elle-FormData tuzağına düşülmedi).
 */
export function ReferralForm({
  token,
  office,
  officePhone,
}: {
  token: string;
  office: string;
  officePhone: string | null;
}) {
  const [done, setDone] = useState<null | { alreadySent: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [kvkk, setKvkk] = useState(false);
  const [pending, startTransition] = useTransition();
  const telHref = toTelHref(officePhone);

  function submit(fd: FormData) {
    setError(null);
    fd.set("token", token);
    startTransition(async () => {
      const res = await submitReferralByToken(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone({ alreadySent: res.alreadySent === true });
    });
  }

  if (done) {
    return (
      <div className="mt-5 rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">
          {done.alreadySent ? "Bu kişiyi zaten iletmişsiniz." : "Teşekkür ederiz!"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {done.alreadySent
            ? `${office} en kısa sürede kendisiyle ilgilenecek.`
            : `${office} danışmanı en kısa sürede arayacak. Güveniniz için teşekkürler.`}
        </p>
        {telHref ? (
          <a
            href={telHref}
            className="focus-ring press mt-4 inline-flex items-center gap-2 rounded-[11px] border border-hairline-strong bg-surface px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-canvas"
          >
            <Phone className="h-4 w-4 text-brand-600" />
            {formatTurkishPhone(officePhone)}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form action={submit} className="mt-5 space-y-3">
      {/* Honeypot — gerçek kullanıcılar görmez; botlar doldurursa kayıt sessizce yutulur */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div>
        <label htmlFor="ref-name" className="mb-1.5 block text-xs font-semibold text-text-muted">
          Tanıdığınızın adı *
        </label>
        <input
          id="ref-name"
          name="referred_name"
          required
          maxLength={120}
          autoComplete="off"
          placeholder="Örn. Mehmet Kaya"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="ref-phone" className="mb-1.5 block text-xs font-semibold text-text-muted">
          Cep telefonu *
        </label>
        <input
          id="ref-phone"
          name="referred_phone"
          required
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          placeholder={TR_MOBILE_PLACEHOLDER}
          value={phone}
          onChange={(e) => setPhone(sanitizeTurkishPhoneInput(e.target.value))}
          className={`${inputCls} numeric`}
        />
      </div>

      <div>
        <label htmlFor="ref-note" className="mb-1.5 block text-xs font-semibold text-text-muted">
          Kısa not <span className="font-normal text-text-faint">(ne arıyor?)</span>
        </label>
        <textarea
          id="ref-note"
          name="referred_note"
          rows={3}
          maxLength={1000}
          placeholder="Örn. Kadıköy'de 2+1 kiralık arıyor, bütçesi esnek."
          className={`${inputCls} resize-none`}
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-canvas/60 px-3.5 py-3 text-[12px] leading-relaxed text-text-muted transition hover:border-brand-300">
        <input
          type="checkbox"
          name="kvkk"
          required
          checked={kvkk}
          onChange={(e) => setKvkk(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
        />
        <span>
          Burada <strong className="font-semibold text-ink-950">tanıdığıma ait kişisel verileri</strong>{" "}
          paylaştığımı, kendisinin bilgisi ve rızası olduğunu; bu bilgilerin {office} tarafından
          yalnızca kendisiyle iletişime geçmek amacıyla işleneceğini kabul ediyorum.{" "}
          <Link
            href="/kvkk-aydinlatma"
            target="_blank"
            className="font-semibold text-brand-600 underline-offset-2 hover:underline"
          >
            Aydınlatma metni
          </Link>
        </span>
      </label>

      {error ? (
        <p
          className="rounded-[10px] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !kvkk}
        className="btn-shine focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Tavsiyemi ilet
      </button>
    </form>
  );
}
