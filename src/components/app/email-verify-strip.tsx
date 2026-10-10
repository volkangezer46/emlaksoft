"use client";

import { useState, useTransition } from "react";
import { MailCheck, X } from "lucide-react";
import { resendVerificationEmail } from "@/app/actions/email-verification";

/**
 * İnce, kapatılabilir şerit: e-postası doğrulanmamış kullanıcıya. Doğrulanınca sunucu bunu hiç çizmez.
 * Kapatma yalnız bu oturum içindir (sayfa yenilenince tekrar görünür); hiçbir özelliği kilitlemez.
 */
export function EmailVerifyStrip() {
  const [hidden, setHidden] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (hidden) return null;
  return (
    <aside
      aria-label="E-posta doğrulama"
      className="tone-info flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs font-semibold"
    >
      <span className="inline-flex items-center gap-1.5">
        <MailCheck className="h-3.5 w-3.5" aria-hidden />
        E-postanı doğrula — fatura ve önemli bildirimler için
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await resendVerificationEmail();
            setNote(r.error ? { tone: "err", text: r.error } : { tone: "ok", text: r.message ?? "Gönderildi." });
          })
        }
        className="focus-ring rounded-[var(--radius-control)] underline underline-offset-2 hover:no-underline disabled:opacity-60"
      >
        {pending ? "Gönderiliyor…" : "Doğrulama e-postasını yeniden gönder"}
      </button>
      {note ? (
        <span role="status" className={note.tone === "err" ? "text-danger-600" : undefined}>
          {note.text}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label="Şeridi kapat"
        className="focus-ring grid h-5 w-5 place-items-center rounded-full hover:bg-black/5"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </aside>
  );
}
