"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import type { ExportResult } from "@/app/actions/export";
import { isFullExportEntity } from "@/lib/export-entities";

export function ExportCsvButton({
  label = "CSV",
  action,
  className,
  iconOnly = false,
}: {
  label?: string;
  action: () => Promise<ExportResult>;
  className?: string;
  iconOnly?: boolean;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [fullEntity, setFullEntity] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    try {
      const res = await action();
      if (res.error) {
        push(res.error, "err");
        return;
      }
      if (!res.csv) {
        push("İndirilecek kayıt yok", "err");
        return;
      }
      const blob = new Blob(["\uFEFF" + res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename ?? "export.csv";
      a.click();
      URL.revokeObjectURL(url);
      if (res.truncated) {
        if (isFullExportEntity(res.entity)) {
          setFullEntity(res.entity ?? null);
          push(`Hızlı dışa aktarma ilk ${res.rowCount ?? 0} kayıtla sınırlı. Yanındaki "Tümünü indir" ile eksiksiz dosyayı alın.`, "err");
        } else {
          push(`Yalnızca ilk ${res.rowCount ?? 0} kayıt indirildi (üst sınır). Tamamı için filtreyi daraltın.`, "err");
        }
      } else {
        push("CSV indirildi", "ok");
      }
    } catch {
      push("Dışa aktarma hatası", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    {fullEntity ? (
      <a
        href={`/api/export/${fullEntity}`}
        download
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-brand-300 bg-surface px-3 py-2 text-xs font-semibold text-brand-600 transition hover:bg-brand-50"
      >
        <Download className="h-4 w-4" />
        Tümünü indir
      </a>
    ) : null}
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      className={
        className ??
        (iconOnly
          ? "grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
          : "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50")
      }
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {!iconOnly ? label : null}
    </button>
    </>
  );
}
