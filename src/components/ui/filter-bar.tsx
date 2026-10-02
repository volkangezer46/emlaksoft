import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  buildHref,
  countActiveFilters,
  formatCount,
  mergeParams,
  type ParamRecord,
} from "@/lib/ui/filter-params";

/**
 * FilterBar — arama + sekme/segment + açılır "Filtreler" paneli + sağda sonuç sayısı.
 * Sunucu bileşeni, JS gerektirmez: arama ve panel alanları <form method="get"> ile URL'e
 * yazılır; sekmeler link'tir (mevcut parametreleri korur, sayfalamayı sıfırlar).
 * Sayfa searchParams'ı `params` olarak verir; sunucu sorgusu aynı değerleri okur.
 */
export type FilterTab = { label: string; value: string; count?: number };

const CONTROL =
  "min-h-9 rounded-[var(--radius-control)] border border-line bg-surface text-sm text-text transition focus:border-brand-400 focus:outline-none focus:shadow-[var(--focus-gap),var(--focus-ring)]";

export function FilterBar({
  pathname,
  params,
  searchName = "q",
  searchPlaceholder = "Ara…",
  searchLabel = "Ara",
  tabs,
  tabParam = "durum",
  allTabLabel = "Tümü",
  panel,
  panelParamKeys = [],
  resultCount,
  resultNoun = "sonuç",
  className,
}: {
  pathname: string;
  /** Sayfanın mevcut searchParams değeri. */
  params: ParamRecord;
  searchName?: string;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Verilirse "Tümü" + bu sekmeler gösterilir. */
  tabs?: FilterTab[];
  tabParam?: string;
  allTabLabel?: string;
  /** "Filtreler" panelinin form alanları (Select/DateRangeField vb., name'li). */
  panel?: ReactNode;
  /** Paneldeki param anahtarları: etkin sayı rozeti ve gizli alan ayrımı için. */
  panelParamKeys?: readonly string[];
  resultCount?: number;
  resultNoun?: string;
  className?: string;
}) {
  const q = typeof params[searchName] === "string" ? (params[searchName] as string) : "";
  const activeTab = typeof params[tabParam] === "string" ? (params[tabParam] as string) : "";
  const activeCount = countActiveFilters(params, panelParamKeys);
  const hasAny = Boolean(q) || Boolean(activeTab) || activeCount > 0;

  // Form, kendi alanları dışındaki parametreleri (sekme vb.) gizli alan olarak taşır.
  const ownKeys = new Set([searchName, "page", ...panelParamKeys]);
  const hidden: Array<readonly [string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (ownKeys.has(k)) continue;
    for (const x of Array.isArray(v) ? v : [v]) if (x) hidden.push([k, x]);
  }

  const tabHref = (value: string) => buildHref(pathname, mergeParams(params, { [tabParam]: value }));
  const allTabs: FilterTab[] = [{ label: allTabLabel, value: "" }, ...(tabs ?? [])];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <form method="get" action={pathname} role="search" className="flex flex-wrap items-center gap-2">
        {hidden.map(([k, v], i) => (
          <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
        ))}
        <label className="min-w-48 flex-1">
          <span className="sr-only">{searchLabel}</span>
          <input
            type="search"
            name={searchName}
            defaultValue={q}
            placeholder={searchPlaceholder}
            className={cn(CONTROL, "w-full px-3")}
          />
        </label>
        {panel ? (
          <details className="relative" open={activeCount > 0 || undefined}>
            <summary
              className={cn(
                CONTROL,
                "focus-ring inline-flex cursor-pointer list-none items-center gap-1.5 px-3 font-medium select-none [&::-webkit-details-marker]:hidden",
              )}
            >
              Filtreler
              {activeCount > 0 ? (
                <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                  {activeCount}
                </span>
              ) : null}
            </summary>
            <div className="mt-2 grid min-w-64 gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:absolute sm:right-0 sm:z-20 sm:w-80 sm:shadow-lg">
              {panel}
            </div>
          </details>
        ) : null}
        <button
          type="submit"
          className="focus-ring min-h-9 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Uygula
        </button>
        {hasAny ? (
          <Link
            href={pathname}
            className="focus-ring inline-flex min-h-9 items-center rounded-[var(--radius-control)] px-2 text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Temizle
          </Link>
        ) : null}
        {resultCount !== undefined ? (
          <p role="status" className="ml-auto text-sm text-text-muted tabular-nums">
            {formatCount(resultCount)} {resultNoun}
          </p>
        ) : null}
      </form>

      {tabs && tabs.length > 0 ? (
        <nav aria-label="Durum" className="flex flex-wrap gap-1">
          {allTabs.map((t) => {
            const on = t.value === activeTab;
            return (
              <Link
                key={t.value || "all"}
                href={tabHref(t.value)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition",
                  on ? "bg-brand-600 text-white" : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {t.label}
                {t.count !== undefined ? (
                  <span className={cn("text-xs tabular-nums", on ? "text-white/80" : "text-text-faint")}>
                    {formatCount(t.count)}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
