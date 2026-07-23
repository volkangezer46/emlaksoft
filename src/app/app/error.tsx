"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[16px] bg-danger-500/10">
          <AlertTriangle className="h-8 w-8 text-danger-500" />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Bu sayfa yüklenemedi</h2>
        <p className="mt-2 text-sm text-text-muted">
          Beklenmeyen bir hata oluştu. Tekrar deneyebilir veya panele geri dönebilirsiniz.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <RotateCcw className="h-4 w-4" /> Tekrar dene
          </button>
          <a
            href="/app"
            className="inline-flex items-center gap-2 rounded-[11px] border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:border-brand-300"
          >
            Panele dön
          </a>
        </div>
      </div>
    </div>
  );
}
