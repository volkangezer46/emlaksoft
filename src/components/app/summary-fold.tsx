import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sade görünümde "önce iş, sonra rakam" (sadeleştirme planı ilke 3): KPI şeridi, grafik ve politika/analiz kartları
 * sade modda kapalı bir "Özet" bölümüne katlanır; tam modda ("Tüm özellikleri göster") olduğu gibi çizilir.
 * Hiçbir şey silinmez, yalnız katlanır. Sunucu bileşeni (yerel `<details>`, JS yok).
 *
 *   const { simple } = await getUiPrefs();
 *   <SummaryFold simple={simple}><KpiGrid>…</KpiGrid></SummaryFold>
 */
export function SummaryFold({
  simple,
  label = "Özet",
  hint,
  children,
  className,
  testId = "summary-fold",
}: {
  simple: boolean;
  label?: string;
  /** Kapalı başlığın yanında tek satır açıklama (ör. "Bu ayın rakamları"). */
  hint?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  if (!simple) return <>{children}</>;
  return (
    <details data-testid={testId} className={cn("group rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]", className)}>
      <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-semibold text-text select-none [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-text-muted transition group-open:rotate-180" />
        {label}
        {hint ? <span className="truncate font-normal text-text-muted">· {hint}</span> : null}
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-3 sm:p-4">{children}</div>
    </details>
  );
}
