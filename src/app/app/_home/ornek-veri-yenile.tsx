"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { dismissDemoSeedRetry, retryRegistrationDemoSeed } from "@/app/actions/sample-retry";

/** Kayıtta örnek veri yüklenemediyse ana ekranda gösterilen bant: tek tıkla yeniden dene ya da vazgeç. */
export function OrnekVeriYenile() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section
      aria-label="Örnek veri yüklenemedi"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.08] px-4 py-3"
    >
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="text-sm font-bold text-amber-800">Örnek veri yüklenemedi, buradan yeniden dene</p>
        <p className="mt-0.5 text-xs leading-relaxed text-amber-800/80">
          Kaydınız tamamlandı ancak seçtiğiniz örnek veriler yüklenemedi. Yeniden deneyebilir ya da boş ofisle devam edebilirsiniz.
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-xs font-semibold text-danger-600">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await retryRegistrationDemoSeed();
              if (res.error) setError(res.error);
              router.refresh();
            })
          }
          className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-400/25 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          Yeniden dene
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await dismissDemoSeedRetry();
              router.refresh();
            })
          }
          className="focus-ring press min-h-9 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold text-amber-800/80 transition hover:bg-amber-400/15"
        >
          Gerek yok
        </button>
      </div>
    </section>
  );
}
