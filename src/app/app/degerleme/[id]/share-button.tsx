"use client";

import { useState } from "react";
import { Link2, Loader2, MessageCircle, Share2 } from "lucide-react";
import { generateValuationShareLink } from "@/app/actions/valuations";
import { useToast } from "@/components/app/toast-provider";

/**
 * "Paylaşım linki oluştur/kopyala" — portföydeki PropertyWorkflow paylaşım
 * deseninin değerlemeye uyarlanmışı. Link üretilince panoya kopyalanır ve
 * WhatsApp ile gönderme kısayolu görünür (danışmanın ana kanalı).
 */
export function ShareButton({ valuationId, title }: { valuationId: string; title: string | null }) {
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

  const whatsappHref = shareUrl
    ? `https://wa.me/?text=${encodeURIComponent(
        `${title ?? "Değerleme raporu"} — değerleme raporunuz hazır: ${shareUrl}`,
      )}`
    : null;

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={share}
        disabled={busy}
        className="focus-ring press inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface px-4 py-2.5 text-sm font-bold text-brand-600 transition hover:border-brand-300 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        {shareUrl ? "Linki kopyala" : "Paylaşım linki oluştur"}
      </button>
      {shareUrl && whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring press inline-flex items-center gap-2 rounded-[10px] border border-mint-500/30 bg-mint-500/10 px-4 py-2.5 text-sm font-bold text-mint-700 transition hover:bg-mint-500/20"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp ile gönder
        </a>
      ) : null}
      {shareUrl ? (
        <span className="flex min-w-0 items-center gap-1.5 rounded-[10px] border border-brand-300/40 bg-brand-600/5 px-3 py-2 text-xs text-brand-700">
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <a href={shareUrl} target="_blank" rel="noreferrer" className="truncate font-semibold hover:underline">
            {shareUrl}
          </a>
        </span>
      ) : null}
    </div>
  );
}
