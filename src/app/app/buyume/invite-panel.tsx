"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { createMyReferralCode } from "@/app/actions/growth";
import { buildWhatsAppHref } from "@/lib/growth/program";

const BTN =
  "focus-ring press inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] border border-hairline bg-surface px-3.5 py-2 text-sm font-semibold text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";

/** Davet bağlantısı paneli: oluştur, kopyala, WhatsApp'ta paylaş. Popup yok; durum satır içinde. */
export function InvitePanel({ url, canCreate }: { url: string | null; canCreate: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!url) {
    return (
      <div id="davet-baglantisi" className="space-y-3">
        <p className="text-sm text-text-muted">Henüz davet bağlantınız yok. Oluşturduğunuzda size özel, kimlik içermeyen bir kod üretilir.</p>
        {canCreate ? (
          <button
            type="button"
            disabled={pending}
            className="focus-ring press inline-flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await createMyReferralCode();
                if (r.error) setError(r.error);
                else router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            Davet bağlantımı oluştur
          </button>
        ) : (
          <p className="text-xs text-text-muted">Bağlantıyı ofis yöneticisi oluşturabilir.</p>
        )}
        {error ? (
          <p role="alert" className="text-xs font-semibold text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div id="davet-baglantisi" className="space-y-3">
      <code className="block overflow-x-auto rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-sm text-ink-950">{url}</code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setError("Pano izni yok; bağlantıyı elle seçip kopyalayın.");
            }
          }}
        >
          {copied ? <Check className="h-4 w-4 text-mint-600" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
          {copied ? "Kopyalandı" : "Bağlantıyı kopyala"}
        </button>
        <a className={BTN} href={buildWhatsAppHref(url)} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="h-4 w-4" aria-hidden />
          WhatsApp ile paylaş
        </a>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-semibold text-danger-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
