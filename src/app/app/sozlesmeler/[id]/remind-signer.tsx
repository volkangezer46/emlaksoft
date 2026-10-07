"use client";

import { useState } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { toWhatsAppLink } from "@/lib/phone";
import { remindContractSignerBySms } from "@/app/actions/contract-reminders";

/**
 * İmzalamayan kişiye "hatırlat". Ofiste SMS (Netgsm) yapılandırılmışsa SUNUCUDAN SMS gider: kısa imza bağlantısı
 * (`/imza/k/<kod>`) `contract_signer_reminder_payload` RPC'sinden gelir, token action'a/istemciye dönmez (20261007000720).
 * SMS yoksa / RPC henüz yoksa / telefon TR cep değilse bugünkü yol: hazır mesaj WhatsApp'ta açılır, telefon yoksa
 * panoya kopyalanır. Bağlantı yalnız düzenleme yetkilisine çizilir (token = taşıyıcı kimlik).
 */
export function RemindSigner({
  token,
  fullName,
  phone,
  contractTitle,
  contractId,
  signerId,
  smsAvailable = false,
}: {
  token: string;
  fullName: string;
  phone: string | null;
  contractTitle: string;
  contractId?: string;
  signerId?: string;
  /** Ofiste SMS sağlayıcısı hazır mı (sunucuda `isTenantSmsAvailable`). */
  smsAvailable?: boolean;
}) {
  const { push } = useToast();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  function message() {
    const url = `${window.location.origin}/imza/${token}`;
    return `Sayın ${fullName}, "${contractTitle}" sözleşmesi imzanızı bekliyor. İmzalamak için: ${url}`;
  }

  async function manualRemind() {
    const text = message();
    const wa = phone ? toWhatsAppLink(phone, text) : null;
    if (wa) {
      window.open(wa, "_blank", "noopener,noreferrer");
      setDone(true);
      push("Hatırlatma mesajı WhatsApp'ta açıldı", "ok");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      push("Hatırlatma mesajı kopyalandı (telefon kayıtlı değil)", "ok");
    } catch {
      push("Mesaj panoya kopyalanamadı", "err");
    }
  }

  async function remind() {
    if (!(smsAvailable && phone && contractId && signerId)) return manualRemind();
    setBusy(true);
    try {
      const res = await remindContractSignerBySms(contractId, signerId);
      if (res.ok) {
        setDone(true);
        push("İmza hatırlatması SMS ile gönderildi", "ok");
      } else if (res.fallback) {
        await manualRemind();
      } else {
        push(res.error ?? "Hatırlatma gönderilemedi", "err");
      }
    } catch {
      push("Hatırlatma gönderilemedi. Bağlantınızı kontrol edin.", "err");
    } finally {
      setBusy(false);
    }
  }

  const viaSms = smsAvailable && Boolean(phone);
  return (
    <button
      type="button"
      onClick={remind}
      disabled={busy}
      title={viaSms ? "SMS ile imza hatırlatması gönder" : phone ? "WhatsApp ile imza hatırlatması gönder" : "Hatırlatma mesajını kopyala"}
      aria-label={`${fullName} kişisine imza hatırlatması`}
      className="focus-ring press inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : done ? (
        <Check className="h-3.5 w-3.5 text-mint-600" />
      ) : (
        <BellRing className="h-3.5 w-3.5" />
      )}{" "}
      {viaSms ? "SMS hatırlat" : "Hatırlat"}
    </button>
  );
}
