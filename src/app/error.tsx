"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertTriangle, LayoutDashboard, RotateCcw, ShieldCheck } from "lucide-react";
import { reportClientError } from "@/app/actions/report-error";

/**
 * Kök hata sınırı — segment render'ı patladığında görünür. Hata mesajı
 * kullanıcıya gösterilmez (yalnızca digest kodu); detay error-log'a düşer.
 */
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error("Root route error:", error);
    // Vercel loguna ek olarak DB'ye de yaz: log satirlari toplanmiyor ve
    // aranamiyordu. Ayni hata tekrar gelirse yeni satir degil sayac artiyor.
    void reportClientError({
      message: error.message || "Bilinmeyen hata",
      digest: error.digest,
      stack: error.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error]);

  // Erişilebilirlik: hata durumunda odağı başlığa taşı — ekran okuyucular duyurur.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-16">
      {/* Hafif dekor: grid + tek yumuşak glow */}
      <div className="pointer-events-none absolute inset-0 grid-overlay opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-[-140px] h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-brand-600/12 blur-[100px]" />

      <main className="relative w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[16px] border border-danger-500/15 bg-danger-500/10">
          <AlertTriangle className="h-8 w-8 text-danger-500" aria-hidden="true" />
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-5 font-display text-2xl font-extrabold text-ink-950 outline-none sm:text-3xl"
        >
          Bir şeyler ters gitti
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-muted">
          Sayfa yüklenirken beklenmeyen bir hata oluştu. Tekrar denemek çoğu zaman sorunu çözer.
        </p>

        {error.digest ? (
          <p className="mt-3 text-xs text-text-muted">
            Hata kodu:{" "}
            <code className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-950">
              {error.digest}
            </code>
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:bg-brand-700"
          >
            <RotateCcw className="h-4 w-4" /> Tekrar dene
          </button>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-[11px] border border-line-strong bg-surface px-6 py-3 text-sm font-semibold text-ink-950 transition hover:border-brand-400"
          >
            <LayoutDashboard className="h-4 w-4 text-brand-600" /> Panele dön
          </Link>
        </div>

        <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-mint-500/20 bg-mint-500/8 px-3.5 py-1.5 text-xs font-semibold text-mint-700">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Ekibimiz haberdar — hata otomatik olarak kayıt altına alındı.
        </p>
      </main>
    </div>
  );
}
