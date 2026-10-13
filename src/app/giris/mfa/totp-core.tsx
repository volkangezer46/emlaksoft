"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { authErrorMessage } from "@/lib/action-errors";
import { createClient } from "@/lib/supabase/client";

/**
 * TOTP (authenticator) kurulum + doğrulama ORTAK mantığı. İki yüzey kullanır:
 *  - /giris/mfa (zorunlu platform MFA kapısı)
 *  - /admin/hesabim?sekme=guvenlik (kendi doğrulayıcısını kurma / yedek ekleme)
 * Ham hata metni gösterilmez; her hata `authErrorMessage` ile Türkçe cümleye çevrilir.
 */

export type TotpEnrollment = { factorId: string; qrCode: string; secret: string };

export function useTotp() {
  const supabase = useRef(createClient()).current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Yeni TOTP faktörü başlatır. Yarım kalmış (doğrulanmamış) faktörler önce silinir; doğrulanmış
   * doğrulayıcılara ASLA dokunulmaz. `friendlyName` kullanıcıda benzersiz olmalıdır (yedek için sıra eklenir).
   */
  async function enroll(friendlyName: string): Promise<TotpEnrollment | null> {
    setBusy(true);
    setError(null);
    try {
      const listed = await supabase.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      for (const factor of listed.data.totp) {
        if (factor.status !== "verified") {
          const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
          if (removed.error) throw removed.error;
        }
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName });
      if (enrolled.error) throw enrolled.error;
      return { factorId: enrolled.data.id, qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret };
    } catch (cause) {
      setError(authErrorMessage(cause, "Authenticator kurulumu başlatılamadı"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Kodu doğrular; başarılıysa oturum AAL2'ye yükselir. */
  async function verify(factorId: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) {
      setError("Authenticator uygulamasındaki 6 haneli kodu girin.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
      if (verified.error) throw verified.error;
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data.currentLevel !== "aal2") {
        throw assurance.error ?? new Error("aal2 not reached");
      }
      return true;
    } catch (cause) {
      setError(authErrorMessage(cause, "Kod doğrulanamadı"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { enroll, verify, busy, error, setError };
}

/** QR + elle girilecek anahtar. */
export function TotpEnrollmentView({ enrollment }: { enrollment: TotpEnrollment }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 text-center shadow-[var(--elev-2)]">
      <Image
        src={enrollment.qrCode}
        alt="Authenticator uygulaması için MFA QR kodu"
        width={220}
        height={220}
        unoptimized
        className="mx-auto rounded-[var(--radius-card)]"
      />
      <p className="mt-3 text-xs text-text-muted">QR okunmazsa bu anahtarı elle girin:</p>
      <code className="mt-1 block break-all rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-xs font-bold text-ink-900">
        {enrollment.secret}
      </code>
    </div>
  );
}

/** 6 haneli kod formu (yalnız rakam, en çok 6). */
export function TotpCodeForm({
  id,
  busy,
  autoFocus,
  submitLabel,
  submitClassName,
  submitIcon,
  onSubmit,
}: {
  id: string;
  busy: boolean;
  autoFocus?: boolean;
  submitLabel: React.ReactNode;
  submitClassName?: string;
  submitIcon?: React.ReactNode;
  onSubmit: (code: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(code).then((ok) => {
          if (!ok) setCode("");
        });
      }}
    >
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-900">
          Authenticator kodu
        </label>
        <input
          id={id}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus={autoFocus}
          className="w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-center font-display text-2xl font-extrabold tracking-[0.4em] outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
          placeholder="••••••"
        />
      </div>
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className={
          submitClassName ??
          "flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
        }
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {submitLabel}
        {submitIcon}
      </button>
    </form>
  );
}

export function TotpError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600">
      {error}
    </p>
  );
}
