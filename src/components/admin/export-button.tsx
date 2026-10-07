"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ExportResult } from "@/app/actions/platform-export";
import { buttonClass } from "@/components/ui/button";

/**
 * Sunucu aksiyonundan CSV alıp tarayıcıda indirir (Excel uyumlu, BOM'lu).
 * Hata/boş sonuç düğmenin yanında satır içi mesajdır (tarayıcı uyarı penceresi yok).
 */
export function ExportButton({
  action,
  label = "Dışa aktar",
  variant = "light",
}: {
  action: () => Promise<ExportResult>;
  label?: string;
  /**
   * `light` → normal yüzeyde premium çerçeveli düğme (Button `outline`).
   * `dark`  → koyu şerit içinde cam düğme (eski koyu başlıklar için korunur).
   */
  variant?: "dark" | "light";
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await action();
      if (res.error || !res.csv) {
        setMessage(res.error ?? "Dışa aktarılacak veri yok.");
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

  const Icon = pending ? Loader2 : Download;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        aria-busy={pending || undefined}
        className={
          variant === "dark"
            ? "focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:border-white/35 hover:bg-white/15 disabled:opacity-60"
            : buttonClass({ variant: "outline", size: "lg" })
        }
      >
        <Icon className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
        {label}
      </button>
      {message ? (
        <span role="alert" className="text-xs font-semibold text-danger-600">
          {message}
        </span>
      ) : null}
    </span>
  );
}
