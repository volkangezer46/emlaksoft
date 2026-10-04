import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCount, type ParamRecord } from "@/lib/ui/filter-params";
import { pageHrefOf, type PageWindow } from "./list-logic";

const BTN =
  "focus-ring press surface-interactive inline-flex min-h-9 touch:min-h-11 items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition";
const BTN_OFF =
  "inline-flex min-h-9 touch:min-h-11 items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

/**
 * ListPager — gerçek sayfalama şeridi ("X–Y / Toplam Z", Önceki/Sonraki).
 * Filtre kontratı: linkler mevcut searchParams'ı korur, yalnız `sayfa` değişir.
 * Toplam 0 ise hiçbir şey çizilmez.
 */
export function ListPager({
  pathname,
  params,
  window: w,
  total,
}: {
  pathname: string;
  params: ParamRecord;
  window: PageWindow;
  total: number;
}) {
  if (total <= 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="numeric text-text-muted">
        {formatCount(w.rangeStart)}–{formatCount(w.rangeEnd)} / Toplam {formatCount(total)}
      </p>
      <div className="flex items-center gap-1.5">
        {w.hasPrev ? (
          <Link href={pageHrefOf(pathname, params, w.page - 1)} className={BTN}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Önceki
          </Link>
        ) : (
          <span className={BTN_OFF} aria-disabled="true">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Önceki
          </span>
        )}
        <span className="numeric px-1 text-text-faint">
          {Math.min(w.page, w.totalPages)} / {w.totalPages}
        </span>
        {w.hasNext ? (
          <Link href={pageHrefOf(pathname, params, w.page + 1)} className={BTN}>
            Sonraki <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        ) : (
          <span className={BTN_OFF} aria-disabled="true">
            Sonraki <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  );
}
