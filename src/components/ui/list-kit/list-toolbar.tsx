import Link from "next/link";
import type { ReactNode } from "react";
import { Rows3, Rows4, Search, SlidersHorizontal, X } from "lucide-react";
import { buildHref, formatCount, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { cn } from "@/lib/utils";
import { densityOf, hiddenFields, type ActiveChip } from "./list-logic";
import { ViewSwitcher, type ViewOption } from "./view-switcher";

/**
 * ListToolbar — liste sayfalarının TEK araç çubuğu: görünüm anahtarı, arama,
 * "Filtreler (n)" paneli, sıralama, yoğunluk anahtarı, kayıtlı görünümler ve
 * kaldırılabilir aktif-filtre çipleri.
 *
 * Sunucu bileşenidir, JS gerektirmez. Arama ve panel alanları tek bir
 * `<form method="get">` ile URL'e yazılır; formun sahip olmadığı parametreler
 * (görünüm, sıralama, kategori, yoğunluk…) gizli alan olarak taşınır, sayfalama sıfırlanır.
 * Filtre kontratı: URL ↔ sunucu sorgusu iki yönlü; bu bileşen yalnız URL'i üretir.
 *
 * Basit sayfalar için `FilterBar` (sekme + panel) yeterlidir; görünüm anahtarı,
 * çipler ve yoğunluk gereken liste ekranları bunu kullanır.
 */
const CONTROL =
  "min-h-9 rounded-[var(--radius-control)] border border-line bg-surface text-sm text-text transition focus:border-brand-400 focus:outline-none focus:shadow-[var(--focus-gap),var(--focus-ring)]";

export function ListToolbar({
  pathname,
  params,
  views,
  activeView,
  searchName = "q",
  searchPlaceholder = "Ara…",
  searchLabel = "Ara",
  panel,
  panelParamKeys = [],
  sort,
  savedViews,
  densityParam,
  chips = [],
  resultCount,
  resultNoun = "sonuç",
  actions,
  className,
}: {
  pathname: string;
  /** Sayfanın çözümlenmiş searchParams değeri (ham). */
  params: ParamRecord;
  /** Yalnız VAR olan görünümler; < 2 ise anahtar çizilmez. */
  views?: readonly ViewOption[];
  activeView?: string;
  searchName?: string;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Filtre paneli form alanları (name'li). */
  panel?: ReactNode;
  /** Panel alanlarının param anahtarları: rozet sayısı + gizli alan ayrımı. */
  panelParamKeys?: readonly string[];
  /** Sıralama denetimi (ör. istemci select ya da link). */
  sort?: ReactNode;
  /** `<SavedViews>` gibi kayıtlı görünüm şeridi. */
  savedViews?: ReactNode;
  /** Verilirse yoğunluk anahtarı çizilir (URL paramı adı, ör. "yogunluk"). */
  densityParam?: string;
  chips?: readonly ActiveChip[];
  resultCount?: number;
  resultNoun?: string;
  /** Sağ uca ek eylemler. */
  actions?: ReactNode;
  className?: string;
}) {
  const q = typeof params[searchName] === "string" ? (params[searchName] as string) : "";
  const panelActive = panelParamKeys.filter((k) => {
    const v = params[k];
    return Array.isArray(v) ? v.some(Boolean) : Boolean(v);
  }).length;
  const hidden = hiddenFields(params, [searchName, ...panelParamKeys]);
  const density = densityParam ? densityOf(typeof params[densityParam] === "string" ? (params[densityParam] as string) : null) : null;
  const clearAll = chips.length > 0 ? pathname : null;

  return (
    <div className={cn("surface-card relative rounded-[var(--radius-panel)] p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {views && activeView ? <ViewSwitcher options={views} active={activeView} /> : null}

        <form method="get" action={pathname} role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {hidden.map(([k, v]) => (
            <input key={`${k}-${v}`} type="hidden" name={k} value={v} />
          ))}
          <label className="relative min-w-44 flex-1">
            <span className="sr-only">{searchLabel}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              type="search"
              name={searchName}
              defaultValue={q}
              placeholder={searchPlaceholder}
              className={cn(CONTROL, "w-full bg-canvas pl-9 pr-3 focus:bg-surface")}
            />
          </label>
          {panel ? (
            <details className="group relative" open={panelActive > 0 || undefined}>
              <summary
                className={cn(
                  CONTROL,
                  "focus-ring inline-flex cursor-pointer list-none items-center gap-1.5 px-3 font-semibold select-none hover:bg-canvas [&::-webkit-details-marker]:hidden",
                )}
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-text-muted" />
                Filtreler
                {panelActive > 0 ? (
                  <span className="numeric rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{panelActive}</span>
                ) : null}
              </summary>
              <div className="mt-2 grid min-w-64 gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:absolute sm:right-0 sm:z-30 sm:w-96 sm:shadow-[var(--shadow-lg)]">
                {panel}
                <button
                  type="submit"
                  className="focus-ring press min-h-9 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Filtreleri uygula
                </button>
              </div>
            </details>
          ) : null}
          <button type="submit" className="sr-only">
            Ara
          </button>
        </form>

        {sort}

        {density && densityParam ? (
          <Link
            href={buildHref(pathname, mergeParams(params, { [densityParam]: density === "kompakt" ? "" : "kompakt" }, { resetPage: false }))}
            aria-label={density === "kompakt" ? "Rahat satır yoğunluğuna geç" : "Kompakt satır yoğunluğuna geç"}
            title={density === "kompakt" ? "Rahat görünüm" : "Kompakt görünüm"}
            className={cn(CONTROL, "focus-ring press inline-grid w-9 place-items-center text-text-muted hover:bg-canvas hover:text-text", density === "kompakt" && "border-brand-300 bg-brand-600/10 text-brand-700")}
          >
            {density === "kompakt" ? <Rows4 aria-hidden="true" className="h-4 w-4" /> : <Rows3 aria-hidden="true" className="h-4 w-4" />}
          </Link>
        ) : null}

        {actions}
      </div>

      {chips.length > 0 || resultCount !== undefined ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.clearHref}
              title="Bu filtreyi kaldır"
              className="focus-ring press inline-flex min-h-8 items-center gap-1.5 rounded-full bg-brand-600/10 px-3 text-xs font-semibold text-brand-700 transition hover:bg-brand-600/15"
            >
              {c.text}
              <X aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">filtresini kaldır</span>
            </Link>
          ))}
          {clearAll ? (
            <Link href={clearAll} className="focus-ring rounded-[var(--radius-control)] px-1.5 text-xs font-semibold text-text-muted underline-offset-2 hover:text-text hover:underline">
              Tümünü temizle
            </Link>
          ) : null}
          {resultCount !== undefined ? (
            <p role="status" className="numeric ml-auto text-xs font-medium text-text-muted">
              {formatCount(resultCount)} {resultNoun}
            </p>
          ) : null}
        </div>
      ) : null}

      {savedViews ? <div className="mt-2.5">{savedViews}</div> : null}
    </div>
  );
}
