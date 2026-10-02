"use client";

import { useEffect, useRef } from "react";
import { reportClientError } from "@/app/actions/report-error";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error("Admin route error:", error);
    // Vercel loguna ek olarak DB'ye de yaz: log satirlari toplanmiyor ve
    // aranamiyordu. Ayni hata tekrar gelirse yeni satir degil sayac artiyor.
    void reportClientError({
      message: error.message || "Bilinmeyen hata",
      digest: error.digest,
      stack: error.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error]);

  // Keep keyboard and screen-reader users at the start of the recovery UI.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[16px] bg-danger-500/10">
          <AlertTriangle className="h-8 w-8 text-danger-500" />
        </div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 font-display text-lg font-bold text-ink-950 outline-none"
        >
          Yönetim paneli hatası
        </h2>
        <p className="mt-2 text-sm text-text-muted">Bu bölüm yüklenemedi. Tekrar deneyin.</p>
        <button
          type="button"
          onClick={reset}
          className="focus-ring press mt-6 inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <RotateCcw className="h-4 w-4" /> Tekrar dene
        </button>
      </div>
    </div>
  );
}
