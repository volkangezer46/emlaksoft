"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { voteHelpArticle } from "@/app/actions/help-vote";
import { Button } from "@/components/ui/button";

/**
 * "Bu yazı işe yaradı mı?" — tıklama anında görsel tepki (iyimser), oy arka planda yazılır. Hata olursa düğmeler geri
 * gelir ve kısa not çıkar. Sonuçlar yalnız yöneticide (/admin/tickets/yardim) görünür.
 */
export function HelpVote({ kind, slug }: { kind: "guide" | "faq" | "glossary"; slug: string }) {
  const [state, setState] = useState<"idle" | "yes" | "no" | "error">("idle");
  const [, start] = useTransition();

  function vote(helpful: boolean) {
    setState(helpful ? "yes" : "no");
    start(async () => {
      const r = await voteHelpArticle(kind, slug, helpful).catch(() => ({ ok: false }));
      if (!r.ok) setState("error");
    });
  }

  if (state === "yes" || state === "no") {
    return (
      <p className="text-sm text-text-muted" role="status">
        {state === "yes" ? "Teşekkürler, işinize yaramasına sevindik." : "Teşekkürler; bu yazıyı iyileştireceğiz. Yardımcıya ya da destek talebiyle de sorabilirsiniz."}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Bu yazı işe yaradı mı?">
      <span className="text-sm text-text-muted">İşe yaradı mı?</span>
      <Button type="button" variant="outline" size="sm" icon={ThumbsUp} onClick={() => vote(true)}>
        Evet
      </Button>
      <Button type="button" variant="outline" size="sm" icon={ThumbsDown} onClick={() => vote(false)}>
        Hayır
      </Button>
      {state === "error" ? <span className="text-xs text-danger-600">Oy kaydedilemedi.</span> : null}
    </div>
  );
}
