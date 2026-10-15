"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecoveryCodesPanel } from "@/components/auth/recovery-codes-panel";
import { TotpCodeForm, TotpEnrollmentView, TotpError, useTotp, type TotpEnrollment } from "./totp-core";

export type TotpFlowResult = { error?: string; ok?: true; codes?: string[] };

/**
 * Ofis kullanıcısı authenticator kurulumu (Hesabım > Güvenlik ve zorunlu kurulum ekranı ortak akışı):
 *   1) `prepare` (sunucu: eski/yarım faktörleri temizler) → 2) QR + elle anahtar → 3) 6 haneli kod (oturum AAL2)
 *   → 4) `activate` (sunucu: yöntem TOTP, kurtarma kodları, oturum kanıtı) → 5) kurtarma kodları bir kez gösterilir.
 * Doğrulama/kayıt mantığı platform MFA ile aynı `totp-core`.
 */
export function TotpSetupFlow({
  prepare,
  activate,
  onFinished,
  finishLabel = "Tamam",
  startLabel = "Authenticator kur",
  compact = false,
}: {
  prepare: () => Promise<TotpFlowResult>;
  activate: () => Promise<TotpFlowResult>;
  onFinished: () => void;
  finishLabel?: string;
  startLabel?: string;
  compact?: boolean;
}) {
  const totp = useTotp();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    totp.setError(null);
    try {
      const prepared = await prepare();
      if (prepared.error) {
        totp.setError(prepared.error);
        return;
      }
      const started = await totp.enroll("EmlakSoft");
      if (started) setEnrollment(started);
    } catch {
      totp.setError("Authenticator kurulumu başlatılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setStarting(false);
    }
  }

  async function verify(code: string) {
    if (!enrollment) return false;
    const ok = await totp.verify(enrollment.factorId, code);
    if (!ok) return false;
    try {
      const result = await activate();
      if (result.error || !result.codes) {
        totp.setError(result.error ?? "Authenticator etkinleştirilemedi. Lütfen tekrar deneyin.");
        return false;
      }
      setCodes(result.codes);
      return true;
    } catch {
      totp.setError("Authenticator etkinleştirilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
      return false;
    }
  }

  if (codes) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 rounded-[var(--radius-control)] border border-mint-500/25 bg-mint-500/8 px-3.5 py-2.5 text-sm font-semibold text-mint-600" role="status">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Authenticator ile iki adımlı doğrulama açıldı.
        </p>
        <RecoveryCodesPanel codes={codes} onDone={onFinished} doneLabel={finishLabel} />
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div className="space-y-3">
        {!compact ? (
          <ol className="space-y-1.5 text-xs leading-relaxed text-text-muted">
            <li className="flex gap-2">
              <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
              Telefonunuza Google Authenticator, Microsoft Authenticator ya da benzeri bir uygulama kurun.
            </li>
            <li className="flex gap-2">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" />
              Çıkan QR kodunu tarayın ve uygulamadaki 6 haneli kodu girin. SMS gerekmez, internetsiz de çalışır.
            </li>
          </ol>
        ) : null}
        <Button icon={KeyRound} loading={starting || totp.busy} onClick={start} className="w-full sm:w-auto">
          {startLabel}
        </Button>
        <TotpError error={totp.error} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TotpEnrollmentView enrollment={enrollment} />
      <TotpCodeForm id="office-totp-code" busy={totp.busy} autoFocus onSubmit={verify} submitLabel="Doğrula ve etkinleştir" />
      <TotpError error={totp.error} />
    </div>
  );
}
