"use client";

import { useState, useTransition } from "react";
import { Copy, Loader2, MessageCircle, MessageSquareText, Send, X } from "lucide-react";
import { sendMatchToCustomer } from "@/app/actions/matching";
import { useToast } from "@/components/app/toast-provider";

type Ready = { url: string; message: string; whatsappHref: string | null; smsHref: string | null; hasPhone: boolean };

/**
 * "Müşteriye gönder": paylaşım bağlantısı + hazır mesaj üretir; kart içinde açılan şeritte WhatsApp / SMS / kopyala
 * (popup yok). Gönderim danışmanın kendi uygulamasından yapılır; bağlantı oluşturma denetim günlüğüne yazılır.
 */
export function SendMatchButton({ demandId, propertyId }: { demandId: string; propertyId: string }) {
  const [pending, startTransition] = useTransition();
  const [ready, setReady] = useState<Ready | null>(null);
  const { push } = useToast();

  const create = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("demand_id", demandId);
      fd.set("property_id", propertyId);
      const res = await sendMatchToCustomer(fd);
      if ("error" in res) push(res.error, "err");
      else setReady(res);
    });

  const copy = async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(ready.message);
      push("Mesaj ve bağlantı kopyalandı", "ok");
    } catch {
      push("Kopyalanamadı; bağlantıyı elle seçin", "err");
    }
  };

  const chip =
    "focus-ring press inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600";

  if (!ready) {
    return (
      <button type="button" disabled={pending} onClick={create} className={`${chip} disabled:opacity-50`} title="Paylaşım bağlantısı ve hazır mesajla müşteriye gönder">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
        Müşteriye gönder
      </button>
    );
  }
  return (
    <div role="group" aria-label="Müşteriye gönder" className="flex w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface-raised p-2 lg:w-auto">
      {ready.whatsappHref ? (
        <a href={ready.whatsappHref} target="_blank" rel="noopener noreferrer" className={chip}>
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> WhatsApp
        </a>
      ) : null}
      {ready.smsHref ? (
        <a href={ready.smsHref} className={chip}>
          <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /> SMS
        </a>
      ) : null}
      <button type="button" onClick={copy} className={chip}>
        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Kopyala
      </button>
      {!ready.hasPhone ? <span className="text-xs text-text-muted">Müşterinin telefonu kayıtlı değil</span> : null}
      <button type="button" onClick={() => setReady(null)} aria-label="Kapat" className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-hover">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
