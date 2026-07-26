"use client";

import { useState } from "react";
import { Loader2, MessageCircleQuestion, ThumbsUp } from "lucide-react";
import { likePublicShare } from "@/app/actions/vitrin";

/**
 * /paylas/[token] mikro-etkileşim satırı:
 * - "Beğendim": paylaşan danışmana bildirim (server action, IP bazlı hız sınırlı)
 * - "Soru sor": danışmanın telefonuna önyazılı wa.me linki (telefon yoksa gizlenir)
 */
export function ShareFeedback({
  token,
  whatsappHref,
}: {
  token: string;
  whatsappHref: string | null;
}) {
  const [liked, setLiked] = useState<"idle" | "loading" | "done">("idle");

  async function onLike() {
    if (liked !== "idle") return;
    setLiked("loading");
    try {
      await likePublicShare(token);
    } catch {
      // Bildirim ulaşmasa da ziyaretçi deneyimi bozulmasın — teşekkür göster.
    }
    setLiked("done");
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={onLike}
        disabled={liked !== "idle"}
        className={`inline-flex items-center justify-center gap-2 rounded-[12px] border px-4 py-3 text-sm font-bold transition ${
          liked === "done"
            ? "border-mint-400/40 bg-mint-500/15 text-mint-300"
            : "border-white/15 bg-white/[0.05] text-white/75 hover:border-mint-400/40 hover:text-white"
        }`}
      >
        {liked === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
        {liked === "done" ? "Teşekkürler!" : "Beğendim"}
      </button>
      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-white/15 bg-white/[0.05] px-4 py-3 text-sm font-bold text-white/75 transition hover:border-cyan-400/40 hover:text-white"
        >
          <MessageCircleQuestion className="h-4 w-4" /> Soru sor
        </a>
      ) : (
        <span className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-white/10 px-4 py-3 text-sm font-semibold text-white/35">
          <MessageCircleQuestion className="h-4 w-4" /> Soru sor
        </span>
      )}
    </div>
  );
}
