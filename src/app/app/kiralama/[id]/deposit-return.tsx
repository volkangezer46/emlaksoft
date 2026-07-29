"use client";

import { useTransition } from "react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { markDepositReturned } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";

/**
 * Depozito iade kontrolü (C.3) — kira detayının koyu hero'sunda durur, o yüzden
 * koyu-zemin (cam) stili. İade edilmişse tarih + geri-al; edilmemişse işaretle.
 */
export function DepositReturnControl({
  rentalId,
  returned,
  returnedAt,
}: {
  rentalId: string;
  returned: boolean;
  returnedAt: string | null;
}) {
  const [pending, start] = useTransition();
  const { push } = useToast();

  const set = (next: boolean) => {
    start(async () => {
      const res = await markDepositReturned(rentalId, next);
      if (res?.error) push(res.error, "err");
      else push(next ? "Depozito iade edildi olarak işaretlendi." : "Depozito iadesi geri alındı.", "ok");
    });
  };

  if (returned) {
    const dateLabel = returnedAt
      ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(returnedAt))
      : null;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/20 px-2 py-0.5 text-[11px] font-bold text-mint-300">
          <CheckCircle2 className="h-3 w-3" /> İade edildi{dateLabel ? ` · ${dateLabel}` : ""}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => set(false)}
          title="İadeyi geri al"
          className="focus-ring grid h-6 w-6 place-items-center rounded-[8px] text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => set(true)}
      className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-mint-400/30 bg-mint-500/12 px-2.5 py-1 text-[11px] font-bold text-mint-300 transition hover:border-mint-400/50 hover:bg-mint-500/20 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
      Depozito iade edildi
    </button>
  );
}
