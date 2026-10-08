import Link from "@/components/ui/smart-link";
import { FileSpreadsheet } from "lucide-react";
import { reportCenterHref } from "@/lib/report-center/links";
import type { ReportScope } from "@/lib/report-center/types";
import { cn } from "@/lib/utils";

/**
 * "Raporlarda aç" — sayfa içi indirme düğmelerinin yerini alan küçük bağlantı. Raporu Rapor merkezinde AÇAR
 * (Excel / PDF / CSV orada indirilir); sayfadaki liste filtreleri sorgu parametresi olarak taşınır.
 * Kasıtlı olarak indirme yapmaz: tüm dışa aktarma tek yerde (denetim izi, kapsam kuralları, satır tavanı).
 */
export function ReportOpenLink({
  report,
  scope = "tenant",
  filters,
  label = "Raporlarda aç",
  className,
}: {
  report: string;
  scope?: ReportScope;
  filters?: Record<string, string | undefined | null>;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={reportCenterHref(scope, report, filters ?? {})}
      className={cn(
        "focus-ring press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-xs font-semibold text-text-muted transition hover:bg-surface-hover hover:text-accent-text sm:min-h-8",
        className,
      )}
    >
      <FileSpreadsheet className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
