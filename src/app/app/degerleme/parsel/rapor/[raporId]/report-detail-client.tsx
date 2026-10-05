"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { loadParcelReportDetail } from "@/app/actions/ef-valuation";
import type { ReportDetailResult } from "@/lib/ef-credits/types";
import { EfResultView } from "../../result-view";

/** Rapor detayı: yalnız kullanıcı isteyince (tarife >0 ise kontör düşebileceğinden otomatik çağrılmaz; ön yüklemede ücretlendirme olmaz). */
export function ReportDetailClient({ raporId, units }: { raporId: string; units: number }) {
  const [pending, start] = useTransition();
  const [detail, setDetail] = useState<ReportDetailResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    start(async () => {
      const res = await loadParcelReportDetail(raporId);
      if (!res.ok) setError(res.error);
      else setDetail(res.detail);
    });
  }

  return (
    <div className="mt-4 space-y-4" aria-live="polite">
      {!detail || detail.status !== "ok" ? (
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Rapor detayını göster {units > 0 ? `(${units} kontör)` : "(kontör düşmez)"}
        </button>
      ) : null}
      {error ? <p role="alert" className="text-sm font-medium text-danger-600">{error}</p> : null}
      {detail && detail.status !== "ok" ? (
        <p role="alert" className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2 text-sm text-ink-950">
          {detail.status === "no_credit" ? `Yetersiz kontör: bu işlem ${detail.needed} kontör, kalan ${detail.available}.` : detail.message}
        </p>
      ) : null}
      {detail && detail.status === "ok" ? (
        detail.result.durum === "deger" ? (
          <EfResultView result={detail.result} raporId={raporId} showActions={false} />
        ) : (
          <p className="text-sm text-text-muted">Bu rapor için kayıtlı özet bulunamadı. PDF&apos;i indirmeyi deneyin.</p>
        )
      ) : null}
    </div>
  );
}
