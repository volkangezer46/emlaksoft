"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ExportResult } from "@/app/actions/platform-export";

/** Sunucu aksiyonundan CSV alıp tarayıcıda indirir (Excel uyumlu, BOM'lu). */
export function ExportButton({
  action,
  label = "Dışa aktar",
  variant = "dark",
}: {
  action: () => Promise<ExportResult>;
  label?: string;
  /**
   * `dark`  → koyu hero şeridi içinde (cam buton)
   * `light` → normal sayfa yüzeyinde (surface buton)
   * Ton, token'lara bırakılamıyor: `.theme-dark` içinde `text-muted`/`surface`
   * beyaza döndüğü için açık zeminde beyaz-üstüne-beyaz olurdu.
   */
  variant?: "dark" | "light";
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
      className={`focus-ring press inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
        variant === "dark"
          ? "border-white/20 bg-white/10 text-white backdrop-blur-sm hover:border-white/35 hover:bg-white/15"
          : "border-line bg-canvas text-ink-950 hover:border-brand-400 hover:text-brand-600"
      }`}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
