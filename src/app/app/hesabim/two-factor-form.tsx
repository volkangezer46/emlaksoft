"use client";

import { useActionState, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, MessageSquareText, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  activateTotpTwoFactor,
  prepareTotpEnrollment,
  regenerateRecoveryCodes,
  setTwoFactorSms,
  type TwoFactorToggleResult,
} from "./two-factor-actions";

// Authenticator kurulumu (QR, Supabase MFA istemcisi) yalnız açıldığında yüklenir: Hesabım ilk yükü küçük kalır.
const TotpSetupFlow = dynamic(() => import("@/app/giris/mfa/totp-setup-flow").then((m) => m.TotpSetupFlow), {
  ssr: false,
  loading: () => <Loader2 className="h-5 w-5 animate-spin text-text-faint" aria-label="Yükleniyor" />,
});
const RecoveryCodesPanel = dynamic(() => import("@/components/auth/recovery-codes-panel").then((m) => m.RecoveryCodesPanel), {
  ssr: false,
});

const initial: TwoFactorToggleResult = {};

/**
 * İki adımlı doğrulama yöntemi: authenticator uygulaması (önerilen; SMS maliyeti yok, internetsiz çalışır, 10 kurtarma
 * kodu) veya SMS kodu. Ofis politikası rol için 2FA'yı zorunlu kıldıysa kapatma düğmesi yoktur; yöntem değiştirilebilir.
 */
export function TwoFactorForm({
  enabled,
  method,
  phone,
  smsConfigured,
  recoveryLeft,
  required,
}: {
  enabled: boolean;
  method: "sms" | "totp";
  phone: string | null;
  smsConfigured: boolean;
  recoveryLeft: number;
  required: boolean;
}) {
  const router = useRouter();
  const [smsState, smsAction, smsPending] = useActionState(setTwoFactorSms, initial);
  const [setupOpen, setSetupOpen] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenPending, startRegen] = useTransition();
  const totpOn = enabled && method === "totp";
  const smsOn = enabled && method === "sms";
  const canSms = Boolean(phone) && smsConfigured;

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-900">
        Durum:
        {enabled ? (
          <Badge variant="success">Açık · {totpOn ? "Authenticator uygulaması" : "SMS kodu"}</Badge>
        ) : (
          <Badge variant="warning">Kapalı</Badge>
        )}
        {required ? <span className="text-xs text-text-muted">Ofis politikası rolünüz için zorunlu kılıyor.</span> : null}
      </p>

      {/* Authenticator */}
      <section className="rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4" aria-labelledby="tfa-totp-title">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
            <Smartphone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="tfa-totp-title" className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-950">
              Authenticator uygulaması {totpOn ? <Badge variant="success">Kullanılıyor</Badge> : <Badge variant="info">Önerilen</Badge>}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
              Google veya Microsoft Authenticator ile her girişte 6 haneli kod. SMS beklemeden, internetsiz de çalışır.
            </p>
          </div>
        </div>

        {totpOn ? (
          <div className="mt-3 space-y-3">
            <p className={`text-xs font-semibold ${recoveryLeft <= 3 ? "text-danger-600" : "text-text-muted"}`}>
              Kalan kurtarma kodu: {recoveryLeft} / 10
              {recoveryLeft <= 3 ? " — yeni kodlar oluşturmanızı öneririz." : ""}
            </p>
            {newCodes ? (
              <RecoveryCodesPanel codes={newCodes} onDone={() => { setNewCodes(null); router.refresh(); }} doneLabel="Kaydettim, kapat" />
            ) : (
              <ConfirmDialog
                tone="default"
                title="Yeni kurtarma kodları oluşturulsun mu?"
                description="Eski kodların tamamı hemen geçersiz olur. Yeni 10 kod yalnız bir kez gösterilir."
                confirmLabel="Yeni kodlar oluştur"
                onConfirm={() =>
                  new Promise<void>((resolve) =>
                    startRegen(async () => {
                      setRegenError(null);
                      const res = await regenerateRecoveryCodes();
                      if (res.codes) setNewCodes(res.codes);
                      else setRegenError(res.error ?? "Kodlar oluşturulamadı.");
                      resolve();
                    }),
                  )
                }
                trigger={
                  <Button variant="outline" size="sm" icon={RefreshCw} loading={regenPending}>
                    Yeni kurtarma kodları
                  </Button>
                }
              />
            )}
            {regenError ? <p role="alert" className="text-xs font-medium text-danger-600">{regenError}</p> : null}
          </div>
        ) : setupOpen ? (
          <div className="mt-4">
            <TotpSetupFlow
              prepare={prepareTotpEnrollment}
              activate={activateTotpTwoFactor}
              finishLabel="Kaydettim, bitir"
              compact
              onFinished={() => {
                setSetupOpen(false);
                router.refresh();
              }}
            />
          </div>
        ) : (
          <div className="mt-3">
            <Button icon={KeyRound} onClick={() => setSetupOpen(true)} className="w-full sm:w-auto">
              {smsOn ? "Authenticator'a geç" : "Authenticator kur"}
            </Button>
          </div>
        )}
      </section>

      {/* SMS */}
      <section className="rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4" aria-labelledby="tfa-sms-title">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-mint-500/12 text-mint-600">
            <MessageSquareText className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p id="tfa-sms-title" className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-950">
              SMS kodu {smsOn ? <Badge variant="success">Kullanılıyor</Badge> : null}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
              {phone ? `Girişte ${phone} numarasına 6 haneli kod gönderilir.` : "Profilinizde kayıtlı telefon numarası yok."}
            </p>
          </div>
        </div>
        {!smsOn ? (
          <form action={smsAction} className="mt-3">
            <input type="hidden" name="enable" value="1" />
            <Button type="submit" variant="outline" icon={MessageSquareText} loading={smsPending} disabled={!canSms} className="w-full sm:w-auto">
              {totpOn ? "SMS'e geç" : "SMS ile aç"}
            </Button>
          </form>
        ) : null}
        {!phone ? (
          <p className="mt-3 rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-700">
            SMS ile doğrulama için önce Profil sekmesinden bir cep telefonu numarası ekleyin.
          </p>
        ) : !smsConfigured ? (
          <p className="mt-3 rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-700">
            SMS servisi (Netgsm) yapılandırılmadığı için SMS kodu kullanılamıyor. Authenticator uygulamasını seçebilir ya da
            Ayarlar → Entegrasyonlar bölümünden ofis Netgsm hesabınızı bağlayabilirsiniz.
          </p>
        ) : null}
      </section>

      {enabled && !required ? (
        <form action={smsAction}>
          <input type="hidden" name="enable" value="0" />
          <Button type="submit" variant="ghost" size="sm" loading={smsPending} icon={ShieldCheck}>
            İki adımlı doğrulamayı kapat
          </Button>
        </form>
      ) : null}

      {smsState.error ? (
        <p className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-xs font-medium text-danger-600" role="alert">
          {smsState.error}
        </p>
      ) : smsState.ok ? (
        <p className="rounded-[var(--radius-control)] border border-mint-500/25 bg-mint-500/8 px-3.5 py-2.5 text-xs font-medium text-mint-600" role="status">
          Ayar kaydedildi.
        </p>
      ) : null}
    </div>
  );
}
