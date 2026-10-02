"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, LogOut, QrCode, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth/auth-shell";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

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
  const supabase = useRef(createClient()).current;
  const [factorId, setFactorId] = useState(existingFactorId);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function beginEnrollment() {
    if (busy || factorId) return;
    setBusy(true);
    setError(null);
    try {
      const listed = await supabase.auth.mfa.listFactors();
      if (listed.error) throw listed.error;

      // An interrupted setup leaves an unusable unverified factor. Clear only
      // those factors; verified authenticators are never removed here.
      for (const factor of listed.data.totp) {
        if (factor.status !== "verified") {
          const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
          if (removed.error) throw removed.error;
        }
      }

      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "EmlakSoft Platform",
      });
      if (enrolled.error) throw enrolled.error;
      const nextEnrollment = {
        factorId: enrolled.data.id,
        qrCode: enrolled.data.totp.qr_code,
        secret: enrolled.data.totp.secret,
      };
      setEnrollment(nextEnrollment);
      setFactorId(nextEnrollment.factorId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authenticator kurulumu başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError("Authenticator uygulamasındaki 6 haneli kodu girin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (verified.error) throw verified.error;

      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data.currentLevel !== "aal2") {
        throw assurance.error ?? new Error("AAL2 oturumu oluşturulamadı.");
      }
      router.replace(next);
      router.refresh();
    } catch (cause) {
      setCode("");
      setError(cause instanceof Error ? cause.message : "Kod doğrulanamadı.");
    } finally {
      setBusy(false);
    }
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
          <div className="mt-8 rounded-[16px] border border-line bg-surface p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
                <QrCode className="h-5 w-5" />
              </span>
              <div>
                <p className="font-bold text-ink-950">Authenticator kurun</p>
                <p className="mt-1 text-sm text-text-muted">Tek kullanımlık QR kodunu oluşturup telefonunuzla tarayın.</p>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={beginEnrollment}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Güvenlik anahtarı oluştur
            </button>
          </div>
        ) : null}

        {enrollment ? (
          <div className="mt-6 rounded-[16px] border border-line bg-white p-5 text-center shadow-[var(--elev-2)]">
            <Image
              src={enrollment.qrCode}
              alt="Authenticator uygulaması için MFA QR kodu"
              width={220}
              height={220}
              unoptimized
              className="mx-auto rounded-[12px]"
            />
            <p className="mt-3 text-xs text-text-muted">QR okunmazsa bu anahtarı elle girin:</p>
            <code className="mt-1 block break-all rounded-[8px] bg-canvas px-3 py-2 text-xs font-bold text-ink-900">
              {enrollment.secret}
            </code>
          </div>
        ) : null}

        {factorId ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void verify();
            }}
          >
            <div>
              <label htmlFor="platform-mfa-code" className="mb-1.5 block text-sm font-semibold text-ink-900">
                Authenticator kodu
              </label>
              <input
                id="platform-mfa-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus={Boolean(existingFactorId)}
                className="w-full rounded-[12px] border border-line bg-surface px-3.5 py-3 text-center font-display text-2xl font-extrabold tracking-[0.4em] outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                placeholder="••••••"
              />
            </div>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="btn-shine group flex w-full items-center justify-center gap-2 rounded-[12px] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Doğrula ve platformu aç <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600">
            {error}
          </p>
        ) : null}

        <form action={signOut} className="mt-6 border-t border-line pt-5 text-center">
          <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-ink-950">
            <LogOut className="h-3.5 w-3.5" /> Vazgeç, çıkış yap
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
