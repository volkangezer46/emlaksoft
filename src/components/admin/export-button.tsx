"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ExportResult } from "@/app/actions/platform-export";

/** Sunucu aksiyonundan CSV alıp tarayıcıda indirir (Excel uyumlu, BOM'lu). */
export function ExportButton({
  action,
  label = "Dışa aktar",
}: {
  action: () => Promise<ExportResult>;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const res = await action();
      if (res.error || !res.csv) {
        alert(res.error ?? "Dışa aktarılacak veri yok.");
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename ?? "export.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
