"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

/**
 * Web Share API butonu (public sayfalar).
 * navigator.share varsa native paylaşım paneli; yoksa link panoya kopyalanır
 * ve kısa süreliğine "Kopyalandı" gösterilir. `url` verilmezse o anki adres
 * paylaşılır. `tone`: açık (vitrin/rapor) ve koyu (paylas) temalar için stil.
 */
export function ShareButton({
  title,
  text,
  url,
  tone = "light",
  className = "",
}: {
  title: string;
  text?: string;
  url?: string;
  tone?: "light" | "dark";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(shareUrl: string) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* pano izni yoksa sessiz kal */
    }
  }

  async function onShare() {
    const shareUrl = url ?? window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: text ?? title, url: shareUrl });
        return;
      } catch (e) {
        // Kullanıcı paneli kapattıysa sorun yok; diğer hatalarda panoya düş
        if ((e as DOMException | null)?.name === "AbortError") return;
      }
    }
    await copyToClipboard(shareUrl);
  }

  const toneClass =
    tone === "dark"
      ? copied
        ? "border-mint-400/40 bg-mint-500/15 text-mint-300"
        : "border-white/15 bg-white/[0.05] text-white/70 hover:border-white/30 hover:text-white"
      : copied
        ? "border-mint-500/40 bg-mint-500/10 text-mint-600"
        : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600";

  return (
    <button
      type="button"
      onClick={onShare}
      title="Paylaş"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${toneClass} ${className}`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Kopyalandı" : "Paylaş"}
    </button>
  );
}
