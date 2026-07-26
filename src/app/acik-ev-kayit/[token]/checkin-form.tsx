"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { registerOpenHouseVisitorByToken } from "@/app/actions/open-house-public";
import { sanitizeTurkishPhoneInput, TR_MOBILE_PLACEHOLDER } from "@/lib/phone";

const inputCls =
  "w-full rounded-[12px] border border-line bg-canvas px-3.5 py-3 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";

/**
 * Açık ev self check-in formu + teşekkür ekranı.
 *
 * NEDEN CLIENT: server action sonucu sayfa yenilenmeden gösterilir
 * (confirm-buttons deseni). Telefonda basit maske: sadece rakam, 11 hane,
 * 0 ile başlar (sanitizeTurkishPhoneInput) — public sayfada ağır PhoneInput
 * bileşenine gerek yok.
 *
 * KİOSK MODU (?kiosk=1): tablet kapıda sabit durur; teşekkür ekranından 4 sn
 * sonra form otomatik sıfırlanır ki sıradaki ziyaretçi kaydolabilsin.
 */
export function CheckinForm({ token, kiosk }: { token: string; kiosk: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [done, setDone] = useState<null | { alreadyRegistered: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [kvkk, setKvkk] = useState(false);
  const [pending, startTransition] = useTransition();

  // Kiosk: teşekkürden 4 sn sonra boş forma dön.
  useEffect(() => {
    if (!kiosk || !done) return;
    const t = setTimeout(() => {
      setDone(null);
      setError(null);
      setPhone("");
      setKvkk(false);
      formRef.current?.reset();
    }, 4000);
    return () => clearTimeout(t);
  }, [kiosk, done]);

  function submit(fd: FormData) {
    setError(null);
    fd.set("token", token);
    startTransition(async () => {
      const res = await registerOpenHouseVisitorByToken(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone({ alreadyRegistered: res.alreadyRegistered === true });
    });
  }

  if (done) {
    return (
      <div className="mt-5 rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">
          {done.alreadyRegistered ? "Kaydınız zaten alınmış." : "Kaydınız alındı!"}
        </p>
        <p className="mt-1 text-xs text-text-muted">Etkinlikte görüşmek üzere!</p>
        {kiosk ? (
          <p className="mt-3 text-[11px] text-text-faint" role="status">
            Form birazdan sıradaki ziyaretçi için hazırlanacak…
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form ref={formRef} action={submit} className="mt-5 space-y-3">
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
        <label htmlFor="checkin-name" className="mb-1.5 block text-xs font-semibold text-text-muted">
          Ad soyad *
        </label>
        <input
          id="checkin-name"
          name="full_name"
          required
          autoComplete="name"
          placeholder="Örn. Ayşe Yıldız"
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="checkin-phone" className="mb-1.5 block text-xs font-semibold text-text-muted">
          Cep telefonu *
        </label>
        <input
          id="checkin-phone"
          name="phone"
          required
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={TR_MOBILE_PLACEHOLDER}
          value={phone}
          onChange={(e) => setPhone(sanitizeTurkishPhoneInput(e.target.value))}
          className={`${inputCls} numeric`}
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
          Kişisel verilerimin ziyaret kaydı ve iletişim amacıyla işlenmesine onay veriyorum.{" "}
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
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        Kaydımı oluştur
      </button>
    </form>
  );
}
