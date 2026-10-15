"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, LifeBuoy, Loader2, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { TotpCodeForm, TotpError, useTotp } from "../mfa/totp-core";
import { cancelLoginVerification, completeTotpLogin, verifyRecoveryCode, type VerifyResult } from "./actions";

const initial: VerifyResult = {};

/**
 * Authenticator (TOTP) yöntemli ofis kullanıcısının giriş adımı. Kod istemcide Supabase MFA ile doğrulanır (oturum AAL2),
 * ardından sunucu AAL2'yi yeniden denetleyip oturum kanıtını yazar. Telefon yoksa tek kullanımlık kurtarma kodu.
 */
export function TotpVerifyForm({ next, factorId, viaGoogle }: { next: string; factorId: string | null; viaGoogle: boolean }) {
  const router = useRouter();
  const totp = useTotp();
  const [mode, setMode] = useState<"totp" | "recovery">(factorId ? "totp" : "recovery");
  const [finishing, setFinishing] = useState(false);
  const [recoveryState, recoveryAction, recoveryPending] = useActionState(verifyRecoveryCode, initial);

  async function verify(code: string) {
    if (!factorId) return false;
    const ok = await totp.verify(factorId, code);
    if (!ok) return false;
    setFinishing(true);
    try {
      const result = await completeTotpLogin(next);
      if (!result.ok) {
        totp.setError(result.error ?? "Giriş tamamlanamadı. Lütfen tekrar deneyin.");
        setFinishing(false);
        return false;
      }
      router.replace(result.next ?? next);
      router.refresh();
      return true;
    } catch {
      totp.setError("Giriş tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.");
      setFinishing(false);
      return false;
    }
  }

  return (
    <AuthShell
      panelTitle="Hesabınız authenticator ile korunuyor"
      panelDesc={`${viaGoogle ? "Google hesabınız" : "Şifreniz"} doğrulandı. Son adım olarak authenticator uygulamanızdaki 6 haneli kodu girin.`}
    >
      <div className="mt-8 lg:mt-0">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600">
          <Smartphone className="h-3.5 w-3.5" /> Authenticator doğrulama
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold text-ink-950">
          {mode === "totp" ? "Giriş kodunu girin" : "Kurtarma kodu girin"}
        </h1>

        {mode === "totp" ? (
          <>
            <p className="mt-2 text-sm text-text-muted">
              Google Authenticator, Microsoft Authenticator veya kullandığınız uygulamada <strong className="text-ink-900">EmlakSoft</strong>{" "}
              kaydındaki 6 haneli kodu yazın. Kod her 30 saniyede yenilenir.
            </p>
            <div className="mt-8">
              <TotpCodeForm
                id="office-totp-login"
                busy={totp.busy || finishing}
                autoFocus
                onSubmit={verify}
                submitLabel={finishing ? "Giriş yapılıyor…" : "Doğrula ve giriş yap"}
                submitIcon={finishing ? undefined : <ArrowRight className="h-4 w-4" />}
                submitClassName="btn-shine group flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
              />
            </div>
            <TotpError error={totp.error} />
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-text-muted">
              {factorId
                ? "Authenticator kurulumu sırasında kaydettiğiniz 10 karakterlik kodlardan birini girin. Her kod yalnız bir kez çalışır."
                : "Bu hesapta etkin bir authenticator bulunamadı. Kaydettiğiniz kurtarma kodlarından birini girin ya da ofis yöneticinizden iki adımlı doğrulamanızı sıfırlamasını isteyin."}
            </p>
            <form action={recoveryAction} className="mt-8 space-y-4">
              <input type="hidden" name="next" value={next} />
              <div>
                <label htmlFor="recovery_code" className="mb-1.5 block text-sm font-semibold text-ink-900">
                  Kurtarma kodu
                </label>
                <input
                  id="recovery_code"
                  name="recovery_code"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                  maxLength={14}
                  autoFocus
                  placeholder="ABCDE-FGHJK"
                  className="w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-center font-mono text-xl font-bold uppercase tracking-[0.2em] outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                />
              </div>
              {recoveryState.error ? (
                <p role="alert" className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600">
                  {recoveryState.error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={recoveryPending}
                className="btn-shine flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
              >
                {recoveryPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Kurtarma koduyla giriş yap
              </button>
            </form>
          </>
        )}

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-text-faint">
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" /> EmlakSoft sizden bu kodları telefonla ya da e-postayla asla istemez
        </p>

        <div className="mt-6 flex flex-col gap-1 border-t border-line pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          {factorId ? (
            <button
              type="button"
              onClick={() => setMode((m) => (m === "totp" ? "recovery" : "totp"))}
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand-600 hover:underline"
            >
              {mode === "totp" ? <LifeBuoy className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
              {mode === "totp" ? "Telefonum yanımda değil" : "Authenticator koduyla gir"}
            </button>
          ) : (
            <span />
          )}
          <form action={cancelLoginVerification}>
            <button type="submit" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-text-muted hover:text-ink-950">
              <LogOut className="h-3.5 w-3.5" /> Vazgeç, çıkış yap
            </button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
