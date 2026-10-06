"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { replyWhatsAppInWindow } from "@/app/actions/whatsapp-reply";
import { useToast } from "@/components/app/toast-provider";

/**
 * Gelen WhatsApp mesajına pencere içi serbest yanıt (satır içi panel, popup yok). `windowLabel` sunucuda hesaplanır;
 * gönderimde sunucu pencereyi yeniden doğrular. Kanal kapalıysa (ofis entegrasyonu yok) panel bunu söyler.
 */
export function WhatsAppWindowReply({ communicationId, open, label, channelReady }: { communicationId: string; open: boolean; label: string; channelReady: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const { push } = useToast();

  if (!channelReady) {
    return <p className="relative z-10 mt-1 text-xs text-text-faint">WhatsApp yanıt kanalı kapalı (ofis WhatsApp entegrasyonu bağlı değil).</p>;
  }
  return (
    <div className="relative z-10 mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${open ? "bg-mint-500/12 text-mint-700" : "bg-amber-400/15 text-amber-700"}`}>{label}</span>
        {open ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="text-xs font-semibold text-brand-600 hover:underline">
            {expanded ? "Kapat" : "WhatsApp'tan yanıtla"}
          </button>
        ) : null}
      </div>
      {open && expanded ? (
        <form
          className="mt-2 flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await replyWhatsAppInWindow(communicationId, text);
              if (res.error) push(res.error, "err");
              else {
                push("WhatsApp yanıtı gönderildi");
                setText("");
                setExpanded(false);
              }
            });
          }}
        >
          <label htmlFor={`wa-reply-${communicationId}`} className="sr-only">WhatsApp yanıtı</label>
          <textarea
            id={`wa-reply-${communicationId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4096}
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-400"
            placeholder="Yanıtınız (serbest metin; pencere kapanınca şablon gerekir)"
          />
          <button type="submit" disabled={pending || !text.trim()} className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-brand-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
            <Send className="h-3.5 w-3.5" aria-hidden /> {pending ? "Gönderiliyor…" : "Gönder"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
