"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[16px] bg-danger-500/10">
          <AlertTriangle className="h-8 w-8 text-danger-500" />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Yönetim paneli hatası</h2>
        <p className="mt-2 text-sm text-text-muted">Bu bölüm yüklenemedi. Tekrar deneyin.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <RotateCcw className="h-4 w-4" /> Tekrar dene
        </button>
      </div>
    </div>
  );
}
