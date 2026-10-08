"use client";

import { useState, useTransition } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { prepareWhatsAppShare, type WhatsAppShareResult } from "@/app/actions/whatsapp-share";
import { useToast } from "@/components/app/toast-provider";
import type { ShareKind } from "@/lib/whatsapp-share";

/**
 * Tek tık "WhatsApp'ta paylaş": token'lı bağlantı hazırlanır ve wa.me yeni sekmede açılır (mesajı kullanıcı kendi
 * WhatsApp'ından gönderir). Alıcı kayıtlıysa doğrudan ona, değilse WhatsApp'ta kişi seçilir. Ticari iletide (sunum) İYS kapısı
 * sunucuda uygulanır. Tarayıcı yeni sekmeyi engellerse bağlantı düğmenin yanında gösterilir.
 */
export function WhatsAppShareButton({ kind, id, label = "WhatsApp'ta paylaş", compact = false }: { kind: ShareKind; id: string; label?: string; compact?: boolean }) {
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [fallback, setFallback] = useState<WhatsAppShareResult | null>(null);

  function run() {
    setFallback(null);
    start(async () => {
      const res = await prepareWhatsAppShare({ kind, id });
      if (res.error || !res.waHref) {
        push(res.error ?? "Paylaşım hazırlanamadı", "err");
        return;
      }
      const win = window.open(res.waHref, "_blank", "noopener,noreferrer");
      if (!win) setFallback(res);
      push(res.recipient ? `${res.recipient.name} (${res.recipient.phoneDisplay}) için WhatsApp açıldı` : "WhatsApp açıldı; alıcıyı seçin", "ok");
      if (res.note) push(res.note, "info");
    });
  }

  const size = compact ? "h-8 px-2.5 text-xs" : "px-4 py-2.5 text-sm";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Bağlantıyı WhatsApp ile paylaş"
        className={`focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-mint-500/30 bg-mint-500/10 font-bold text-mint-700 transition hover:bg-mint-500/20 disabled:opacity-50 ${size}`}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />}
        {label}
      </button>
      {fallback?.waHref ? (
        <a href={fallback.waHref} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-600 hover:underline">
          WhatsApp&apos;ı aç
        </a>
      ) : null}
    </span>
  );
}
