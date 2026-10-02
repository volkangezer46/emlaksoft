"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";

export default function AdminTicketDetailError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    console.error("Admin ticket detayı yüklenemedi", error);
  }, [error]);

  return (
    <section className="rounded-[var(--radius-panel)] border border-danger-500/20 bg-surface p-6 text-center" role="alert">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-danger-500/10 text-danger-600"><AlertTriangle className="h-6 w-6" /></span>
      <h1 className="mt-4 font-display text-xl font-bold text-ink-950">Ticket ayrıntıları yüklenemedi</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">Konuşma, SLA veya işlem geçmişini eksik göstermemek için ekran durduruldu. Yeniden yüklemeyi deneyin.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" disabled={pending} onClick={() => startTransition(() => unstable_retry())} className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />{pending ? "Yükleniyor…" : "Yeniden dene"}</button>
        <Link href="/admin/tickets" className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-semibold text-ink-950"><ArrowLeft className="h-4 w-4" />Kuyruğa dön</Link>
      </div>
      {error.digest ? <p className="mt-3 text-xs text-text-faint">Hata referansı: {error.digest}</p> : null}
    </section>
  );
}
