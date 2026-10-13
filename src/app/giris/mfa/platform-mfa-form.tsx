"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, LogOut, QrCode, ShieldCheck } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { TotpCodeForm, TotpEnrollmentView, TotpError, useTotp, type TotpEnrollment } from "./totp-core";

/** Zorunlu platform MFA kapısı. Kurulum/doğrulama mantığı ortak `totp-core` (Hesabım > Güvenlik de kullanır). */
export function PlatformMfaForm({
  next,
  existingFactorId,
  staffName,
}: {
  next: string;
  existingFactorId: string | null;
  staffName: string;
}) {
  const router = useRouter();
  const totp = useTotp();
  const [factorId, setFactorId] = useState(existingFactorId);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);

  async function beginEnrollment() {
    if (totp.busy || factorId) return;
    const started = await totp.enroll("EmlakSoft Platform");
    if (started) {
      setEnrollment(started);
      setFactorId(started.factorId);
    }
  }

  async function verify(code: string) {
    if (!factorId) return false;
    const ok = await totp.verify(factorId, code);
    if (ok) {
      router.replace(next);
      router.refresh();
    }
    return ok;
  }

  return (
    <AuthShell
      panelTitle="Platform yönetimi AAL2 ile korunuyor"
      panelDesc="Ofis verileri, ödeme işlemleri ve destek oturumları için parola sonrasında authenticator doğrulaması zorunludur."
    >
      <div className="mt-8 lg:mt-0">
        <span className="inline-flex items-center gap-2 rounded-full bg-mint-500/12 px-3 py-1.5 text-xs font-semibold text-mint-600">
          <ShieldCheck className="h-3.5 w-3.5" /> Zorunlu platform MFA
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold text-ink-950">Kimliğinizi doğrulayın</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          <span className="font-semibold text-ink-900">{staffName}</span> için Google Authenticator,
          Microsoft Authenticator veya uyumlu bir TOTP uygulaması kullanın.
        </p>

        {!factorId ? (
          <div className="mt-8 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                <QrCode className="h-5 w-5" />
              </span>
              <div>
                <p className="font-bold text-ink-950">Authenticator kurun</p>
                <p className="mt-1 text-sm text-text-muted">Tek kullanımlık QR kodunu oluşturup telefonunuzla tarayın.</p>
              </div>
            </div>
            <button
              type="button"
              disabled={totp.busy}
              onClick={beginEnrollment}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {totp.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Güvenlik anahtarı oluştur
            </button>
          </div>
        ) : null}

        {enrollment ? (
          <div className="mt-6">
            <TotpEnrollmentView enrollment={enrollment} />
          </div>
        ) : null}

        {factorId ? (
          <div className="mt-6">
            <TotpCodeForm
              id="platform-mfa-code"
              busy={totp.busy}
              autoFocus={Boolean(existingFactorId)}
              onSubmit={verify}
              submitLabel="Doğrula ve platformu aç"
              submitIcon={<ArrowRight className="h-4 w-4" />}
              submitClassName="btn-shine group flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
            />
          </div>
        ) : null}

        <TotpError error={totp.error} />

        <form action={signOut} className="mt-6 border-t border-line pt-5 text-center">
          <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-ink-950">
            <LogOut className="h-3.5 w-3.5" /> Vazgeç, çıkış yap
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
