"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { toWhatsAppLink } from "@/lib/phone";

/**
 * İmzalamayan kişiye "hatırlat": imza bağlantısını içeren hazır mesajı WhatsApp'ta açar; telefon yoksa
 * mesajı panoya kopyalar. Sunucudan SMS göndermez (ilk gönderim `sendContractForSigning`'de; tekrar gönderim
 * için yeni service_role yolu açılmadı). Bağlantı yalnız düzenleme yetkilisine çizilir (token = taşıyıcı kimlik).
 */
export function RemindSigner({
  token,
  fullName,
  phone,
  contractTitle,
}: {
  token: string;
  fullName: string;
  phone: string | null;
  contractTitle: string;
}) {
  const { push } = useToast();
  const [done, setDone] = useState(false);

  function message() {
    const url = `${window.location.origin}/imza/${token}`;
    return `Sayın ${fullName}, "${contractTitle}" sözleşmesi imzanızı bekliyor. İmzalamak için: ${url}`;
  }

  async function remind() {
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

  return (
    <button
      type="button"
      onClick={remind}
      title={phone ? "WhatsApp ile imza hatırlatması gönder" : "Hatırlatma mesajını kopyala"}
      aria-label={`${fullName} kişisine imza hatırlatması`}
      className="focus-ring press inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
    >
      {done ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <BellRing className="h-3.5 w-3.5" />} Hatırlat
    </button>
  );
}
