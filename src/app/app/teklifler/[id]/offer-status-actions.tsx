"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Repeat, Undo2 } from "lucide-react";
import { updateOfferStatus } from "@/app/actions/offers";

export function OfferStatusActions({ offerId, status }: { offerId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [counterMode, setCounterMode] = useState(false);
  const [counter, setCounter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const closed = ["accepted", "rejected", "withdrawn"].includes(status);

  function run(next: "accepted" | "rejected" | "countered" | "withdrawn", amount?: number) {
    setError(null);
    startTransition(async () => {
      const res = await updateOfferStatus(offerId, next, amount);
      if (res.error) setError(res.error);
      else {
        setCounterMode(false);
        router.refresh();
      }
    });
  }

  if (closed) {
    return (
      <p className="text-sm text-text-muted">
        Bu teklif kapandı — yeni işlem için yeni teklif oluşturun.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("accepted")}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-mint-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" /> Kabul et
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("rejected")}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-danger-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          <XCircle className="h-4 w-4" /> Reddet
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setCounterMode((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-canvas disabled:opacity-60"
        >
          <Repeat className="h-4 w-4" /> Karşı teklif
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("withdrawn")}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-text-muted transition hover:bg-canvas disabled:opacity-60"
        >
          <Undo2 className="h-4 w-4" /> Geri çek
        </button>
      </div>

      {counterMode ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-canvas p-3">
          <input
            type="number"
            min="0"
            step="1000"
            value={counter}
            onChange={(e) => setCounter(e.target.value)}
            placeholder="Karşı teklif tutarı (₺)"
            className="min-w-[180px] flex-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400"
          />
          <button
            type="button"
            disabled={pending || !counter}
            onClick={() => run("countered", Number(counter))}
            className="rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Karşı teklif gönder
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger-500">{error}</p> : null}
    </div>
  );
}
