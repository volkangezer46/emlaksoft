"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { seedSampleData } from "@/app/actions/sample-data";

/**
 * Boş ofis onboarding CTA'sı — dashboard'da müşteri+portföy 0 ve örnek veri
 * hiç yüklenmemişken görünür (koşul server tarafında, bkz. app/page.tsx).
 * Tek tık: örnek set yüklenir, panel yenilenir; ikincil yol içe aktarma.
 */
export function SampleDataCta() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="surface-card flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-brand-300/60 bg-brand-600/[0.04] p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display font-bold text-ink-950">
            Sistemi örnek veriyle keşfedin
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            30 saniyede dolu bir panel görün — örnek müşteri, portföy, görev ve
            randevularla tüm ekranları deneyin; tek tıkla temizlenir.
          </p>
          {error ? <p className="mt-1 text-xs font-semibold text-danger-500">{error}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await seedSampleData();
              if (result.error) {
                setError(result.error);
                return;
              }
              router.refresh();
            });
          }}
          className="focus-ring press btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {pending ? "Yükleniyor…" : "Örnek veri yükle"}
        </button>
        <Link
          href="/app/ice-aktarma"
          className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          Kendi verinizi içe aktarın <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}
