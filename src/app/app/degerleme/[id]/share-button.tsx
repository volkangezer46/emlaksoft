"use client";

import { useState } from "react";
import { Link2, Loader2, Share2 } from "lucide-react";
import { generateValuationShareLink } from "@/app/actions/valuations";
import { useToast } from "@/components/app/toast-provider";
import { WhatsAppShareButton } from "@/components/app/whatsapp-share-button";

/**
 * "Paylaşım linki oluştur/kopyala" — portföydeki PropertyWorkflow paylaşım
 * deseninin değerlemeye uyarlanmışı. Link üretilince panoya kopyalanır.
 * "WhatsApp'ta paylaş" tek tıkla token'lı bağlantıyı hazırlar ve wa.me açar
 * (portföyün malik müşterisi kayıtlıysa doğrudan ona; ortak WhatsApp paylaşım bileşeni).
 */
export function ShareButton({ valuationId }: { valuationId: string; title?: string | null }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  async function share() {
    // Link zaten üretildiyse ikinci tık yalnızca yeniden kopyalar.
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        push("Paylaşım linki kopyalandı", "ok");
      } catch {
        push("Paylaşım linki hazır", "ok");
      }
      return;
    }
    setBusy(true);
    const res = await generateValuationShareLink(valuationId);
    setBusy(false);
    if (res.error || !res.url) {
      push(res.error ?? "Paylaşım linki oluşturulamadı", "err");
      return;
    }
    setShareUrl(res.url);
    try {
      await navigator.clipboard.writeText(res.url);
      push("Paylaşım linki kopyalandı", "ok");
    } catch {
      push("Paylaşım linki hazır", "ok");
    }
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={share}
        disabled={busy}
        className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2.5 text-sm font-bold text-brand-600 transition hover:border-brand-300 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        {shareUrl ? "Linki kopyala" : "Paylaşım linki oluştur"}
      </button>
      <WhatsAppShareButton kind="valuation" id={valuationId} />
      {shareUrl ? (
        <span className="flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-brand-300/40 bg-brand-600/5 px-3 py-2 text-xs text-brand-700">
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <a href={shareUrl} target="_blank" rel="noreferrer" className="truncate font-semibold hover:underline">
            {shareUrl}
          </a>
        </span>
      ) : null}
    </div>
  );
}
