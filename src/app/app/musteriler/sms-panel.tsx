"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { MessageSquare, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import { sendCustomerSms } from "@/app/actions/communications";
import { useToast } from "@/components/app/toast-provider";
import { InlinePanel, useInlinePanel } from "@/components/ui/inline-panel";

/**
 * Tekil SMS — sayfa içi panel (popup değil). Müşteri 360 hero'su için.
 * İYS: onay durumu SERVER'dan prop gelir; onay yoksa gönderim kilitlenir ve
 * sunucu (sendCustomerSms) aynı kontrolü ikinci kez yapar.
 * Gelen kutusu satırları hâlâ `gelen-kutusu/sms-dialog` kullanır.
 */
export const SMS_PANEL_ID = "sms-gonder";

export function SmsPanelTrigger() {
  const { open, toggle } = useInlinePanel(SMS_PANEL_ID);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={SMS_PANEL_ID}
      onClick={(e) => toggle(e.currentTarget)}
      className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
    >
      <MessageSquare className="h-4 w-4" /> SMS
    </button>
  );
}

function SmsForm({
  customerId,
  consentGranted,
  initialMessage,
  close,
}: {
  customerId: string;
  consentGranted: boolean;
  initialMessage?: string;
  close: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
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
      close();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4 p-4 md:p-6">
      {consentGranted ? (
        <p className="inline-flex items-center gap-1.5 rounded-full bg-mint-500/12 px-3 py-1.5 text-xs font-semibold text-mint-600">
          <ShieldCheck className="h-3.5 w-3.5" /> İYS SMS onayı kayıtlı
        </p>
      ) : (
        <div className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 text-sm" role="alert">
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

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="sms-panel-message" className="text-sm font-semibold text-ink-950">
            Mesaj metni
          </label>
          <span className={`text-xs ${charCount > 160 ? "text-amber-600" : "text-text-faint"}`}>{charCount}/460 karakter</span>
        </div>
        <textarea
          id="sms-panel-message"
          name="message"
          required
          rows={4}
          maxLength={460}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={!consentGranted}
          placeholder="Mesajınızı buraya yazın…"
          className="w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300 disabled:opacity-50"
        />
        {charCount > 0 && charCount <= 160 ? <p className="mt-1 text-xs text-text-faint">1 SMS kredisi kullanılacak</p> : null}
        {charCount > 160 ? (
          <p className="mt-1 text-xs text-amber-600">{Math.ceil(charCount / 153)} SMS kredisi kullanılacak (uzun mesaj)</p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="hairline-t flex justify-end gap-2 pt-4">
        <button
          type="button"
          onClick={close}
          className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
        >
          Vazgeç
        </button>
        <button
          type="submit"
          disabled={!canSend}
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> {pending ? "Gönderiliyor…" : "Gönder"}
        </button>
      </div>
    </form>
  );
}

export function SmsPanel({
  customerId,
  customerName,
  consentGranted,
  initialMessage,
}: {
  customerId: string;
  customerName: string;
  consentGranted: boolean;
  initialMessage?: string;
}) {
  return (
    <InlinePanel
      id={SMS_PANEL_ID}
      title="SMS gönder"
      description={`${customerName} adlı müşteriye tekil SMS gönderin.`}
      icon={<MessageSquare />}
    >
      {(close) => (
        <SmsForm customerId={customerId} consentGranted={consentGranted} initialMessage={initialMessage} close={close} />
      )}
    </InlinePanel>
  );
}
