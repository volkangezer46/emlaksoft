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
      /* Koyu hero şeritleri içinde duruyor (tenants/billing/satis). token'lar
         (text-muted/surface) .theme-dark'ta beyaza döner → beyaz-üstüne-beyaz.
         Bu yüzden koyu zemine sabit cam-buton stili: her koşulda okunur. */
      className="inline-flex items-center gap-2 rounded-[10px] border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:border-white/35 hover:bg-white/15 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
