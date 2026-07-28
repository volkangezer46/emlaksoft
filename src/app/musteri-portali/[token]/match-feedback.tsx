"use client";

import { useState, useTransition } from "react";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  submitMatchFeedbackByToken,
  type MatchFeedbackVerdict,
} from "@/app/actions/customer-portal-feedback";

/**
 * Müşteri portalı kart geri bildirimi — Beğendim / İlgilenmiyorum.
 * Seçim iyimser gösterilir, hata olursa geri alınır; yeniden tıklayarak
 * fikir değiştirilebilir. Kartın soluklaşması server render'dan gelir
 * (revalidate sonrası).
 */
export function MatchFeedback({
  token,
  propertyId,
  initialVerdict,
}: {
  token: string;
  propertyId: string;
  initialVerdict: MatchFeedbackVerdict | null;
}) {
  const [pending, startTransition] = useTransition();
  const [verdict, setVerdict] = useState<MatchFeedbackVerdict | null>(initialVerdict);
  const [error, setError] = useState<string | null>(null);

  const send = (next: MatchFeedbackVerdict) => {
    if (pending || next === verdict) return;
    const prev = verdict;
    setVerdict(next); // iyimser güncelleme
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token", token);
      fd.set("property_id", propertyId);
      fd.set("verdict", next);
      const res = await submitMatchFeedbackByToken(fd);
      if (res?.error) {
        setVerdict(prev);
        setError(res.error);
      }
    });
  };

  const base =
    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:opacity-60";

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          aria-pressed={verdict === "liked"}
          onClick={() => send("liked")}
          className={`${base} ${
            verdict === "liked"
              ? "border-mint-500/25 bg-mint-500/12 text-mint-700"
              : "border-line bg-surface text-text-muted hover:border-mint-400/40 hover:text-mint-600"
          }`}
        >
          {pending && verdict === "liked" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ThumbsUp className="h-3.5 w-3.5" />
          )}
          Beğendim
        </button>
        <button
          type="button"
          disabled={pending}
          aria-pressed={verdict === "disliked"}
          onClick={() => send("disliked")}
          className={`${base} ${
            verdict === "disliked"
              ? "border-danger-500/25 bg-danger-500/10 text-danger-600"
              : "border-line bg-surface text-text-muted hover:border-danger-500/30 hover:text-danger-500"
          }`}
        >
          {pending && verdict === "disliked" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ThumbsDown className="h-3.5 w-3.5" />
          )}
          İlgilenmiyorum
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] font-semibold text-danger-600">{error}</p>}
    </div>
  );
}
