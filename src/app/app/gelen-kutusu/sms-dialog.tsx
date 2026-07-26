"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Reply, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { sendCustomerSms } from "@/app/actions/communications";
import { useToast } from "@/components/app/toast-provider";

/**
 * Tekil SMS dialogu — TEK ortak kopya.
 * Kullanım yerleri:
 *   - Müşteri 360 hero'su (variant="hero"): Ara/WhatsApp yanındaki SMS butonu
 *   - Gelen kutusu satırları (variant="row"): müşterisi eşleşen kayıtlarda "Yanıtla"
 *   - AI asistan eylem kartı (asistan/action-cards): draft_sms önerisi
 *     `initialMessage` + `defaultOpen` ile taslak metinli açılır
 *   - Anlaşma kazanma sihirbazı: `trigger` + `initialMessage` ile hazır tebrik metni
 *
 * İYS: onay durumu SERVER'dan prop olarak gelir (iys_consents, channel='sms',
 * status='granted'). Onay yoksa gönderim kilitlenir ve /app/uyum'a yönlendirilir;
 * sunucu tarafı (sendCustomerSms) aynı kontrolü ikinci kez yapar.
 */
export function SmsDialog({
  customerId,
  customerName,
  consentGranted,
  variant = "hero",
  initialMessage,
  trigger: customTrigger,
  defaultOpen = false,
}: {
  customerId: string;
  customerName: string;
  consentGranted: boolean;
  variant?: "hero" | "row";
  /** Metin alanını önceden doldurur (ör. kazanma sihirbazının tebrik metni). */
  initialMessage?: string;
  /** Varsayılan variant butonları yerine özel tetikleyici. */
  trigger?: React.ReactNode;
  /** İlk render'da açık başlar (ör. AI asistan taslak onayı akışı). */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [message, setMessage] = useState(initialMessage ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const charCount = message.length;
  const canSend = consentGranted && message.trim().length > 0 && !pending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSend) return;
    startTransition(async () => {
      const res = await sendCustomerSms(customerId, message);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setMessage("");
      push("SMS gönderildi", "ok");
      setOpen(false);
      router.refresh();
    });
  }

  const trigger = customTrigger ??
    (variant === "row" ? (
      // Gelen kutusu satırı: overlay linkin üstünde kalmalı → relative z-10
      <button
        type="button"
        className="focus-ring press relative z-10 inline-flex items-center gap-1 rounded-[9px] px-2 py-1.5 text-xs font-semibold text-text-faint transition hover:bg-cyan-500/10 hover:text-cyan-600"
        aria-label={`${customerName} kişisine SMS ile yanıt ver`}
      >
        <Reply className="h-3.5 w-3.5" /> Yanıtla
      </button>
    ) : (
      // Müşteri 360 hero'su: Ara/WhatsApp butonlarıyla aynı görsel dil
      <button
        type="button"
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        <MessageSquare className="h-4 w-4" /> SMS
      </button>
    ));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader
          icon={<MessageSquare />}
          title="SMS gönder"
          description={`${customerName} adlı müşteriye tekil SMS gönderin.`}
        />
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {/* İYS onay durumu göstergesi */}
          {consentGranted ? (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-mint-500/12 px-3 py-1.5 text-xs font-semibold text-mint-600">
              <ShieldCheck className="h-3.5 w-3.5" /> İYS SMS onayı kayıtlı
            </p>
          ) : (
            <div className="rounded-[10px] border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 text-sm" role="alert">
              <p className="flex items-center gap-1.5 font-semibold text-amber-600">
                <ShieldAlert className="h-4 w-4" /> İYS onayı yok
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Bu müşteri için kayıtlı SMS izni bulunmuyor; gönderim kilitli.{" "}
                <Link href="/app/uyum" className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700">
                  Uyum sayfasından izin kaydedin
                </Link>
                .
              </p>
            </div>
          )}

          {/* Mesaj + karakter/SMS sayacı (kampanya dialoguyla aynı 160/153 hesabı) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="sms-message" className="text-sm font-semibold text-ink-950">
                Mesaj metni
              </label>
              <span className={`text-xs ${charCount > 160 ? "text-amber-600" : "text-text-faint"}`}>
                {charCount}/460 karakter
              </span>
            </div>
            <textarea
              id="sms-message"
              name="message"
              required
              rows={4}
              maxLength={460}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={!consentGranted}
              placeholder="Mesajınızı buraya yazın…"
              className="w-full resize-none rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300 disabled:opacity-50"
            />
            {charCount > 0 && charCount <= 160 && (
              <p className="mt-1 text-[11px] text-text-faint">1 SMS kredisi kullanılacak</p>
            )}
            {charCount > 160 && (
              <p className="mt-1 text-[11px] text-amber-600">
                {Math.ceil(charCount / 153)} SMS kredisi kullanılacak (uzun mesaj)
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {error}
            </p>
          )}

          <div className="hairline-t flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
              >
                Vazgeç
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={!canSend}
              className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {pending ? "Gönderiliyor…" : "Gönder"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
