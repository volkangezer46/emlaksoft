"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
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
    <>
    <PageHeader title="Destek kayıtları şu anda yüklenemiyor" description="Eksik veya boş bilgi göstermemek için ekranı durdurduk. Bağlantıyı yenileyerek güvenle tekrar deneyebilirsiniz." />
<section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white"><div className="relative"><div className="mt-5 flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => startTransition(() => unstable_retry())} className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />{pending ? "Yükleniyor…" : "Yeniden dene"}</button>
          <Link href="/app" className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/15 px-4 py-2.5 text-sm font-semibold text-white"><ArrowLeft className="h-4 w-4" />Panele dön</Link>
        </div>
        {error.digest ? <p className="mt-4 text-xs text-white/35">Hata referansı: {error.digest}</p> : null}</div></section>
    </>
  );
}
