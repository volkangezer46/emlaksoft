"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { submitTicketCsat, type TicketResult } from "@/app/actions/tickets";

export function TicketCsatForm({
  ticketId,
  existing,
}: {
  ticketId: string;
  existing?: { score: number; comment: string | null } | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<TicketResult, FormData>(submitTicketCsat, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  if (existing) {
    return (
      <section className="rounded-[16px] border border-amber-400/25 bg-amber-400/[0.06] p-4">
        <p className="text-xs font-bold text-ink-950">Değerlendirmeniz</p>
        <div className="mt-1 flex gap-0.5" aria-label={`${existing.score} / 5 puan`}>
          {[1, 2, 3, 4, 5].map((score) => <Star key={score} className={`h-4 w-4 ${score <= existing.score ? "fill-amber-400 text-amber-400" : "text-line"}`} />)}
        </div>
        {existing.comment ? <p className="mt-2 text-xs leading-relaxed text-text-muted">{existing.comment}</p> : null}
      </section>
    );
  }

  return (
    <section className="rounded-[16px] border border-line bg-surface p-4">
      <h2 className="font-display text-sm font-bold text-ink-950">Çözümü değerlendirin</h2>
      <p className="mt-0.5 text-xs text-text-muted">Geri bildiriminiz destek kalitesini iyileştirmemize yardımcı olur.</p>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="id" value={ticketId} />
        <fieldset>
          <legend className="sr-only">Destek deneyimi puanı</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((score) => (
              <label key={score} className="focus-within:ring-2 focus-within:ring-brand-400/40 grid h-9 w-9 cursor-pointer place-items-center rounded-[9px] border border-line bg-canvas text-amber-500 transition hover:border-amber-400">
                <input className="peer sr-only" type="radio" name="score" value={score} required />
                <Star className="h-4 w-4 peer-checked:fill-amber-400" aria-hidden />
                <span className="sr-only">{score} puan</span>
              </label>
            ))}
          </div>
        </fieldset>
        <textarea name="comment" maxLength={1000} rows={3} placeholder="İsterseniz kısa bir yorum ekleyin…" className="w-full resize-y rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs leading-relaxed outline-none focus:border-brand-400" />
        <button type="submit" disabled={pending} className="focus-ring press rounded-[9px] bg-ink-950 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-60">{pending ? "Kaydediliyor…" : "Değerlendirmeyi gönder"}</button>
        {state.error ? <p className="text-xs font-semibold text-danger-600" role="alert">{state.error}</p> : null}
        {state.ok ? <p className="text-xs font-semibold text-mint-700" role="status">Teşekkürler, değerlendirmeniz kaydedildi.</p> : null}
      </form>
    </section>
  );
}
