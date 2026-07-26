"use client";

import { useActionState } from "react";
import { Loader2, MessageSquareText } from "lucide-react";
import { setTwoFactorSms, type TwoFactorToggleResult } from "./actions";

const initial: TwoFactorToggleResult = {};

/**
 * SMS 2FA aç/kapa anahtarı. Telefon yoksa veya SMS servisi yapılandırılmamışsa
 * anahtar devre dışıdır ve nedeni açıklanır.
 */
export function TwoFactorForm({
  enabled,
  phone,
  smsConfigured,
}: {
  enabled: boolean;
  phone: string | null;
  smsConfigured: boolean;
}) {
  const [state, action, pending] = useActionState(setTwoFactorSms, initial);
  const canToggle = Boolean(phone) && smsConfigured;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="enable" value={enabled ? "0" : "1"} />

      <button
        type="submit"
        disabled={!canToggle || pending}
        role="switch"
        aria-checked={enabled}
        className="flex w-full items-center gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-3 text-left transition hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-mint-500" : "bg-ink-950/15"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-950">
            SMS ile iki adımlı doğrulama {enabled ? "açık" : "kapalı"}
          </span>
          <span className="block text-[11px] text-text-muted">
            {phone
              ? `Girişte ${phone} numarasına 6 haneli kod gönderilir.`
              : "Profilinizde kayıtlı telefon numarası yok."}
          </span>
        </span>
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-text-faint" /> : null}
      </button>

      {!phone ? (
        <p className="rounded-[10px] border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-700">
          İki adımlı doğrulamayı açmak için önce profilinize bir cep telefonu numarası ekleyin.
        </p>
      ) : !smsConfigured ? (
        <p className="flex items-start gap-2 rounded-[10px] border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-700">
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          SMS servisi (Netgsm) yapılandırılmadığı için iki adımlı doğrulama açılamıyor. Ayarlar →
          Entegrasyonlar bölümünden ofis Netgsm hesabınızı bağlayın.
        </p>
      ) : null}

      {state.error ? (
        <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-xs font-medium text-danger-600" role="alert">
          {state.error}
        </p>
      ) : state.ok ? (
        <p className="rounded-[10px] border border-mint-500/25 bg-mint-500/8 px-3.5 py-2.5 text-xs font-medium text-mint-600" role="status">
          Ayar kaydedildi.
        </p>
      ) : null}
    </form>
  );
}
