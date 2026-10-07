"use client";

import { Download } from "lucide-react";
import { toCsv } from "@/lib/export-entities";
import { downloadCsv } from "@/lib/download-csv";
import { useToast } from "@/components/app/toast-provider";
import { PrintButton } from "@/components/ui/print-button";

/**
 * Rapor sayfası dışa aktarma çubuğu: ekranda gösterilen TOPLULAŞTIRILMIŞ satırların CSV'si +
 * yazdır / "PDF olarak kaydet" (tarayıcı; global `@media print` kuralları menüyü ve `.no-print`'i gizler).
 * Satırlar sunucuda hesaplanıp prop olarak gelir; kişisel veri İÇERMEMELİDİR (rapor özeti), bu yüzden
 * kayıt düzeyindeki listelerin onay kapılı `actions/export.ts` yolundan ayrıdır. Hücreler formül
 * enjeksiyonuna karşı `toCsv` → `csvCell` ile kaçışlanır.
 */
export function ReportExportBar({
  rows,
  filename,
  className = "",
}: {
  rows: Record<string, string | number | null>[];
  filename: string;
  className?: string;
}) {
  const { push } = useToast();
  return (
    <div className={`no-print flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        disabled={rows.length === 0}
        onClick={() => {
          if (rows.length === 0) return push("İndirilecek satır yok", "err");
          downloadCsv(toCsv(rows), filename);
          push("Rapor CSV olarak indirildi", "ok");
        }}
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
      >
        <Download className="h-4 w-4" /> CSV
      </button>
      <PrintButton tone="outline" size="sm" />
    </div>
  );
}
