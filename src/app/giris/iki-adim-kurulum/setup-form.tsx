"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, LogOut, MessageSquareText, ShieldCheck, Smartphone } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { PhoneInput } from "@/components/ui/phone-input";
import { TotpSetupFlow } from "../mfa/totp-setup-flow";
import { cancelLoginVerification } from "../dogrulama/actions";
import { activateSetupTotp, confirmSetupCode, prepareSetupTotp, sendSetupCode, type SetupResult } from "./actions";

const initial: SetupResult = {};

const ALERT = "rounded-[var(--radius-control)] border px-3.5 py-2.5 text-sm font-medium";

/**
 * DG7 2FA kurulumu — ofis politikası "authenticator VEYA SMS" kabul eder:
 *  - Authenticator (önerilen; SMS ayarı olmayan ofiste tek yol): QR → kod → kurtarma kodları → kaldığı sayfa.
 *  - SMS: telefon → SMS kodu → doğrula (2FA açılır, kaldığı sayfaya döner).
 */
export function SetupForm({
  next,
  phone,
  required,
  smsReady,
}: {
  next: string;
  phone: string | null;
  /** Ofis politikası bu rol için zorunlu kıldı mı (metin; kapı proxy'dedir). */
  required: boolean;
  smsReady: boolean;
}) {
  const [sendState, sendAction, sending] = useActionState(sendSetupCode, initial);
  const [confirmState, confirmAction, confirming] = useActionState(confirmSetupCode, initial);
  const codeStep = Boolean(sendState.sent) || Boolean(confirmState.sent);
  const router = useRouter();
  const [method, setMethod] = useState<"totp" | "sms">("totp");

  return (
    <AuthShell
      panelTitle="Hesabınızı iki adımlı doğrulamayla koruyun"
      panelDesc={
        required
          ? "Ofisiniz rolünüz için iki adımlı doğrulamayı zorunlu kıldı. Authenticator uygulaması ya da SMS kodundan birini bir kez kurun."
          : "Sonraki girişlerde şifrenize ek olarak authenticator uygulamasındaki ya da SMS ile gelen kod istenir."
      }
    >
      <div className="mt-8 lg:mt-0">
        <span className="inline-flex items-center gap-2 rounded-full bg-mint-500/12 px-3 py-1.5 text-xs font-semibold text-mint-600">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> İki adımlı doğrulama kurulumu
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold text-ink-950">
          {required ? "Devam etmek için kurulumu tamamlayın" : "İki adımlı doğrulamayı açın"}
        </h1>

        <div role="radiogroup" aria-label="Doğrulama yöntemi" className="mt-6 grid grid-cols-2 gap-2">
          {(
            [
              { id: "totp", label: "Authenticator", hint: "Önerilen · SMS gerekmez", Icon: Smartphone },
              { id: "sms", label: "SMS kodu", hint: "Telefonunuza kod gelir", Icon: MessageSquareText },
            ] as const
          ).map(({ id, label, hint, Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={method === id}
              onClick={() => setMethod(id)}
              className={`focus-ring flex min-h-14 flex-col items-start gap-0.5 rounded-[var(--radius-card)] border px-3 py-2.5 text-left transition ${
                method === id ? "border-brand-500 bg-brand-600/8 ring-2 ring-brand-600/15" : "border-line bg-surface hover:border-brand-300"
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
                <Icon className="h-4 w-4 text-brand-600" aria-hidden /> {label}
              </span>
              <span className="text-xs text-text-muted">{hint}</span>
            </button>
          ))}
        </div>

        {method === "totp" ? (
          <div className="mt-6">
            <TotpSetupFlow
              prepare={prepareSetupTotp}
              activate={activateSetupTotp}
              finishLabel="Kaydettim, devam et"
              onFinished={() => {
                router.replace(next);
                router.refresh();
              }}
            />
          </div>
        ) : (
          <>
          {!smsReady ? (
            <p className={`mt-6 border-amber-400/40 bg-amber-400/10 text-amber-800 ${ALERT}`} role="alert">
              Ofisinizde SMS gönderimi henüz ayarlanmamış; kod gönderilemiyor. Authenticator uygulamasını seçin ya da ofis sahibinizden
              Ayarlar &gt; Entegrasyonlar&apos;dan SMS ayarını tamamlamasını isteyin.
            </p>
          ) : null}

          <form action={sendAction} className="mt-8 space-y-3">
            <label htmlFor="setup-phone" className="block text-sm font-semibold text-ink-900">
              Cep telefonu
            </label>
            <PhoneInput id="setup-phone" name="phone" defaultValue={phone} required autoComplete="tel" />
            {sendState.error ? (
              <p className={`border-danger-500/25 bg-danger-500/8 text-danger-600 ${ALERT}`} role="alert">
                {sendState.error}
              </p>
            ) : null}
            {sendState.sent ? (
              <p className={`border-mint-500/25 bg-mint-500/8 text-mint-600 ${ALERT}`} role="status">
                {sendState.masked} numarasına 6 haneli kod gönderildi. Kod 5 dakika geçerlidir.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={sending || !smsReady}
              className="focus-ring press inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface text-sm font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {codeStep ? "Kodu yeniden gönder" : "Doğrulama kodu gönder"}
            </button>
          </form>

          {codeStep ? (
            <form action={confirmAction} className="mt-6 space-y-3">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="setup-code" className="block text-sm font-semibold text-ink-900">
                Doğrulama kodu
              </label>
              <input
                id="setup-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                className="w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-center font-display text-2xl font-extrabold tracking-[0.4em] outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                placeholder="••••••"
              />
              {confirmState.error ? (
                <p className={`border-danger-500/25 bg-danger-500/8 text-danger-600 ${ALERT}`} role="alert">
                  {confirmState.error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={confirming}
                className="btn-shine group flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
              >
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Doğrula ve devam et <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </form>
          ) : null}
          </>
        )}

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-text-faint">
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" aria-hidden /> Kod kimseyle paylaşılmaz — EmlakSoft asla kod sormaz
        </p>

        <div className="mt-6 flex justify-end border-t border-line pt-5 text-sm">
          <form action={cancelLoginVerification}>
            <button type="submit" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-text-muted hover:text-ink-950">
              <LogOut className="h-3.5 w-3.5" aria-hidden /> Vazgeç, çıkış yap
            </button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
