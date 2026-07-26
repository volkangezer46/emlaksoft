"use client";

import { useEffect } from "react";
import { reportClientError } from "@/app/actions/report-error";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[16px] bg-danger-500/10">
          <AlertTriangle className="h-8 w-8 text-danger-500" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-extrabold text-ink-950">Bir şeyler ters gitti</h1>
        <p className="mt-2 text-sm text-text-muted">
          Sayfa yüklenirken beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <RotateCcw className="h-4 w-4" /> Tekrar dene
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-[11px] border border-line-strong bg-surface px-6 py-3 text-sm font-semibold text-ink-950 transition hover:border-brand-400"
          >
            Ana sayfaya dön
          </Link>
        </div>
      </div>
    </div>
  );
}
