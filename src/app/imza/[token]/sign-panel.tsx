"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Clock3, PenLine, ShieldCheck, Smartphone } from "lucide-react";
import {
  requestSignatureOtp,
  submitSignatureByToken,
  verifySignatureOtp,
  type ContractResult,
} from "@/app/actions/contracts";

const initial: ContractResult = {};

export function SignPanel({
  token,
  signerName,
  smsRequired,
  smsVerified,
  maskedPhone,
}: {
  token: string;
  signerName: string;
  smsRequired: boolean;
  smsVerified: boolean;
  maskedPhone: string | null;
}) {
  // İmza anının zaman damgası — sunucudaki signed_at ile aynı ana denk düşer;
  // imzalayana anında kanıt satırı göstermek için başarı anında yakalanır.
  const [signedAtText, setSignedAtText] = useState<string | null>(null);
  // SMS OTP durumu — kod gönderildi mi / telefon doğrulandı mı
  const [codeSent, setCodeSent] = useState(false);
  const [verified, setVerified] = useState(smsVerified);

  const [state, action, pending] = useActionState(
    async (prev: ContractResult, fd: FormData) => {
      const res = await submitSignatureByToken(prev, fd);
      if (res.ok) {
        setSignedAtText(
          new Intl.DateTimeFormat("tr-TR", {
            day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
          }).format(new Date()),
        );
      }
      return res;
    },
    initial,
  );

  const [sendState, sendAction, sendPending] = useActionState(
    async (prev: ContractResult, fd: FormData) => {
      const res = await requestSignatureOtp(prev, fd);
      if (res.ok) setCodeSent(true);
      return res;
    },
    initial,
  );

  const [verifyState, verifyAction, verifyPending] = useActionState(
    async (prev: ContractResult, fd: FormData) => {
      const res = await verifySignatureOtp(prev, fd);
      if (res.ok) setVerified(true);
      return res;
    },
    initial,
  );

  if (state.ok) {
    return (
      <div className="print-avoid-break rounded-[14px] border border-mint-500/30 bg-mint-500/10 px-5 py-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" />
        <p className="mt-3 font-display text-lg font-bold text-ink-950">İmzanız alındı</p>
        <p className="mt-1 text-sm text-text-muted">
          Teşekkürler {signerName}. Onayınız kaydedildi; taraflar bilgilendirilecektir.
        </p>
        {/* İmza kanıt satırı — imzalayana gösterilen zaman damgası */}
        {signedAtText ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-mint-500/30 bg-surface px-3 py-1.5 text-xs font-semibold text-ink-800">
            <Clock3 className="h-3.5 w-3.5 text-mint-600" />
            İmza zaman damgası: {signedAtText}
          </p>
        ) : null}
        {verified ? (
          <p className="mt-2 block">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-mint-500/30 bg-surface px-3 py-1.5 text-xs font-semibold text-mint-600">
              <ShieldCheck className="h-3.5 w-3.5" /> SMS ile doğrulandı ✓
            </span>
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-text-faint">
          Bu işlem tarih-saat bilgisiyle birlikte elektronik kanıt olarak saklanır.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* SMS OTP adımı — telefon kayıtlı ve SMS gönderilebilir durumdaysa zorunlu */}
      {smsRequired && !verified ? (
        <div className="rounded-[14px] border-2 border-brand-600/35 bg-brand-600/[0.05] px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <Smartphone className="h-4 w-4 text-brand-600" /> SMS doğrulaması gerekli
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            İmzalamadan önce {maskedPhone ?? "kayıtlı"} numaralı telefonunuza gönderilecek
            6 haneli kodu doğrulamanız gerekir. Kod 5 dakika geçerlidir.
          </p>

          {!codeSent ? (
            <form action={sendAction} className="mt-3">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                disabled={sendPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                <Smartphone className="h-4 w-4" />
                {sendPending ? "Gönderiliyor…" : "Doğrulama kodu gönder"}
              </button>
            </form>
          ) : (
            <>
              {sendState.ok ? (
                <p className="mt-2 text-xs font-semibold text-mint-600">Kod telefonunuza gönderildi.</p>
              ) : null}
              <form action={verifyAction} className="mt-3 flex gap-2">
                <input type="hidden" name="token" value={token} />
                <input
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  placeholder="6 haneli kod"
                  className="w-full rounded-[10px] border border-line bg-surface px-3 py-2.5 text-sm tracking-[0.3em] outline-none focus:border-brand-400"
                />
                <button
                  type="submit"
                  disabled={verifyPending}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {verifyPending ? "Doğrulanıyor…" : "Doğrula"}
                </button>
              </form>
              <form action={sendAction} className="mt-2">
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  disabled={sendPending}
                  className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-60"
                >
                  {sendPending ? "Gönderiliyor…" : "Yeni kod gönder"}
                </button>
              </form>
            </>
          )}

          {sendState.error ? (
            <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-600" role="alert">
              {sendState.error}
            </p>
          ) : null}
          {verifyState.error ? (
            <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-600" role="alert">
              {verifyState.error}
            </p>
          ) : null}
        </div>
      ) : null}

      {smsRequired && verified ? (
        <p className="flex items-center gap-1.5 rounded-[12px] border border-mint-500/30 bg-mint-500/10 px-4 py-2.5 text-xs font-semibold text-mint-600">
          <ShieldCheck className="h-4 w-4" /> Telefonunuz SMS ile doğrulandı ✓ — şimdi imzalayabilirsiniz.
        </p>
      ) : null}

      {/* İmza formu — SMS zorunluysa yalnız doğrulama sonrası açılır */}
      {!smsRequired || verified ? (
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          {/* Onay metni bilinçli olarak belirgin — imzanın hukuki karşılığı burada */}
          <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border-2 border-brand-600/35 bg-brand-600/[0.05] px-4 py-3.5 text-sm font-medium text-ink-950 transition hover:border-brand-600/55">
            <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
            <span>
              Sözleşme metnini okudum, anladım ve içeriğini kabul ederek elektronik ortamda
              imzalamayı onaylıyorum.
            </span>
          </label>

          {state.error ? (
            <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-600" role="alert">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="btn-shine no-print mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            <PenLine className="h-4 w-4" />
            {pending ? "İmzalanıyor…" : "Sözleşmeyi imzala"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
