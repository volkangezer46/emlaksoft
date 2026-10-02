"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";

export default function SupportError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    console.error("Destek merkezi yüklenemedi", error);
  }, [error]);

  return (
    <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white" role="alert">
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
      <div className="relative max-w-xl">
        <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-danger-500/15 text-red-200"><AlertTriangle className="h-5 w-5" /></span>
        <h1 className="mt-4 font-display text-2xl font-extrabold text-white">Destek kayıtları şu anda yüklenemiyor</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">Eksik veya boş bilgi göstermemek için ekranı durdurduk. Bağlantıyı yenileyerek güvenle tekrar deneyebilirsiniz.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => startTransition(() => unstable_retry())} className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />{pending ? "Yükleniyor…" : "Yeniden dene"}</button>
          <Link href="/app" className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/15 px-4 py-2.5 text-sm font-semibold text-white"><ArrowLeft className="h-4 w-4" />Panele dön</Link>
        </div>
        {error.digest ? <p className="mt-4 text-xs text-white/35">Hata referansı: {error.digest}</p> : null}
      </div>
    </section>
  );
}
