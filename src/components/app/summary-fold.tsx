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
 *
 * `foldOnPhone`: tam modda da telefonda (md altı) katlı gelir, md ve üstünde açık çizilir (başlık gizli). İşi bir karar
 * kuyruğu olan sayfalar içindir (ör. Onaylar, C21): ilk satır telefonda ilk ekranda başlar. Saf CSS (`data-fold-phone`,
 * a11y.css); `::details-content` desteklemeyen tarayıcıda masaüstünde de katlı kalır (açılabilir, içerik kaybolmaz).
 */
export function SummaryFold({
  simple,
  label = "Özet",
  hint,
  children,
  className,
  testId = "summary-fold",
  foldOnPhone = false,
}: {
  simple: boolean;
  label?: string;
  /** Kapalı başlığın yanında tek satır açıklama (ör. "Bu ayın rakamları"). */
  hint?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  /** Tam modda yalnız telefonda katla (md ve üstünde açık). */
  foldOnPhone?: boolean;
}) {
  if (!simple && !foldOnPhone) return <>{children}</>;
  if (!simple) {
    return (
      <details
        data-testid={testId}
        data-fold-phone=""
        className={cn(
          "group max-md:rounded-[var(--radius-panel)] max-md:border max-md:border-line max-md:bg-surface max-md:shadow-[var(--shadow-xs)]",
          className,
        )}
      >
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-semibold text-text select-none [&::-webkit-details-marker]:hidden">
          <ChevronDown aria-hidden="true" className="h-4 w-4 text-text-muted transition group-open:rotate-180" />
          {label}
          {hint ? <span className="truncate font-normal text-text-muted">· {hint}</span> : null}
        </summary>
        <div className="flex flex-col gap-4 max-md:border-t max-md:border-line max-md:p-3">{children}</div>
      </details>
    );
  }
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
