import Form from "next/form";
import Link from "@/components/ui/smart-link";
import type { ReactNode } from "react";
import { Rows3, Rows4, Search, SlidersHorizontal, X } from "lucide-react";
import { buildHref, formatCount, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { cn } from "@/lib/utils";
import { densityOf, hiddenFields, type ActiveChip } from "./list-logic";
import { ListSearchInput } from "./list-search-input";
import { PanelSearchCarry, SheetClose } from "./sheet-close";
import { ViewSwitcher, type ViewOption } from "./view-switcher";

/**
 * ListToolbar — liste sayfalarının TEK araç çubuğu: görünüm anahtarı, arama,
 * "Filtreler (n)" paneli, sıralama, yoğunluk anahtarı, kayıtlı görünümler ve
 * kaldırılabilir aktif-filtre çipleri.
 *
 * Sunucu bileşenidir (istemci adaları: arama kutusu, alt sayfanın kapat düğmesi). Arama ve panel alanları iki ayrı
 * `next/form` (GET) ile URL'e yazılır: gönderim İSTEMCİ gezinmesidir (B058; eskiden yerel `<form method="get">` tam belge
 * yüklemesi yapıyordu: kabuk yeniden kuruluyor, realtime yeniden katılıyordu, sonuç ~550 ms). Arama kutusu ayrıca yazmayı
 * bırakınca 300 ms sonra `router.replace` yapar (Enter gerekmez). Formun sahip olmadığı parametreler (görünüm, sıralama,
 * kategori, yoğunluk, öteki formun alanları…) gizli alan olarak taşınır, sayfalama sıfırlanır. JS yüklenmeden gönderilirse
 * form yine yerel GET olarak çalışır.
 * Filtre kontratı: URL ↔ sunucu sorgusu iki yönlü; bu bileşen yalnız URL'i üretir.
 *
 * Mobil (<640 px): üstte yalnız arama + "Filtreler" kalır; panel alanları, görünüm anahtarı, sıralama, yoğunluk,
 * `sheetExtras` ve kayıtlı görünümler TEK alt sayfada (`.lk-sheet`, list-page.css) açılır — liste ilk ekranda başlar.
 * Masaüstü görünüm değişmez.
 *
 * Basit sayfalar için `FilterBar` (sekme + panel) yeterlidir; görünüm anahtarı,
 * çipler ve yoğunluk gereken liste ekranları bunu kullanır.
 */
const CONTROL =
  "min-h-9 touch:min-h-11 rounded-[var(--radius-control)] border border-line bg-surface text-sm text-text transition focus:border-brand-400 focus:outline-none focus:shadow-[var(--focus-gap),var(--focus-ring)]";

const FILTER_BADGE = "numeric rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white";

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
  sheetExtras,
  sheetParamKeys = [],
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
  /**
   * Yalnız dar ekranda (<640 px) filtre alt sayfasında çizilen hızlı süzgeçler (bağlantı çipleri, özel alan formu…).
   * Sayfa aynı öğelerin geniş ekran kopyasını `max-sm:hidden` ile saklar; böylece telefonda liste ilk ekranda başlar.
   */
  sheetExtras?: ReactNode;
  /**
   * Alt sayfaya taşınan hızlı süzgeçlerin/sıralamanın param anahtarları (ör. tip, sıcaklık, sıralama): telefonda
   * "Filtreler" rozeti bunları da sayar (dış kopyalar gizli olduğundan etkin süzgeç başka türlü görünmez).
   */
  sheetParamKeys?: readonly string[];
  className?: string;
}) {
  const q = typeof params[searchName] === "string" ? (params[searchName] as string) : "";
  const isActive = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v.some(Boolean) : Boolean(v);
  };
  const panelActive = panelParamKeys.filter(isActive).length;
  // Telefon rozeti: panel + alt sayfadaki hızlı süzgeçler (aynı anahtar iki listede olsa da bir kez sayılır).
  const sheetActive = [...new Set([...panelParamKeys, ...sheetParamKeys])].filter(isActive).length;
  // Arama formu panel alanlarını, panel formu aramayı gizli alan olarak taşır.
  const searchHidden = hiddenFields(params, [searchName]);
  const panelHidden = hiddenFields(params, panelParamKeys);
  const density = densityParam ? densityOf(typeof params[densityParam] === "string" ? (params[densityParam] as string) : null) : null;
  const clearAll = chips.length > 0 ? pathname : null;
  const hasViews = Boolean(views && activeView && views.length > 1);
  // Dar ekranda görünüm anahtarı, sıralama, yoğunluk, hızlı süzgeçler ve kayıtlı görünümler alt sayfaya taşınır.
  const mobileExtras = hasViews || Boolean(sort) || Boolean(density) || Boolean(sheetExtras) || Boolean(savedViews);
  const showSheet = Boolean(panel) || mobileExtras;

  const densityLink =
    density && densityParam ? (
      <Link
        href={buildHref(pathname, mergeParams(params, { [densityParam]: density === "kompakt" ? "" : "kompakt" }, { resetPage: false }))}
        aria-label={density === "kompakt" ? "Rahat satır yoğunluğuna geç" : "Kompakt satır yoğunluğuna geç"}
        title={density === "kompakt" ? "Rahat görünüm" : "Kompakt görünüm"}
        className={cn(CONTROL, "focus-ring press surface-interactive inline-grid w-9 touch:w-11 place-items-center text-text-muted hover:text-text", density === "kompakt" && "border-brand-300 bg-surface-selected text-brand-700")}
      >
        {density === "kompakt" ? <Rows4 aria-hidden="true" className="h-4 w-4" /> : <Rows3 aria-hidden="true" className="h-4 w-4" />}
      </Link>
    ) : null;

  return (
    <div className={cn("surface-card relative rounded-[var(--radius-panel)] p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {hasViews ? <ViewSwitcher options={views!} active={activeView!} className="max-sm:hidden" /> : null}

        {/* prefetch kapalı: hedef aynı liste yolu (rota ağacı zaten istemcide); dinamik sayfayı boşuna çizdirmez. */}
        <Form action={pathname} prefetch={false} role="search" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {searchHidden.map(([k, v]) => (
            <input key={`${k}-${v}`} type="hidden" name={k} value={v} />
          ))}
          <label className="relative min-w-44 flex-1">
            <span className="sr-only">{searchLabel}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <ListSearchInput
              name={searchName}
              label={searchLabel}
              value={q}
              pathname={pathname}
              placeholder={searchPlaceholder}
              className={cn(CONTROL, "w-full bg-canvas pl-9 pr-3 focus:bg-surface")}
            />
          </label>
          {/* Ekran okuyucu için gönder düğmesi; Tab sırasında 1x1 px görünmez durak OLMASIN (B173): Enter zaten gönderir. */}
          <button type="submit" tabIndex={-1} className="sr-only">
            Ara
          </button>
        </Form>

        {showSheet ? (
          // key: URL değişince yeniden kurulur → uygulanan alt sayfa açık kalmaz (`open`, React'in yönetmediği DOM durumu).
          <details key={JSON.stringify(params)} className={cn("lk-filter group relative", !panel && "sm:hidden")}>
            <summary
              className={cn(
                CONTROL,
                "focus-ring surface-interactive inline-flex cursor-pointer list-none items-center gap-1.5 px-3 font-semibold select-none [&::-webkit-details-marker]:hidden",
              )}
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-text-muted" />
              Filtreler
              {panelActive > 0 ? (
                <span className={cn(FILTER_BADGE, sheetActive !== panelActive && "max-sm:hidden")}>{panelActive}</span>
              ) : null}
              {sheetActive > 0 && sheetActive !== panelActive ? <span className={cn(FILTER_BADGE, "sm:hidden")}>{sheetActive}</span> : null}
            </summary>
            <div
              role="group"
              aria-label="Filtreler"
              className="lk-sheet mt-2 grid min-w-64 gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:absolute sm:right-0 sm:z-30 sm:w-96 sm:shadow-[var(--shadow-lg)]"
            >
              <div className="flex items-center justify-between gap-2 sm:hidden">
                <p className="text-base font-semibold text-text">Filtreler</p>
                <SheetClose />
              </div>
              {mobileExtras ? (
                <div className="grid gap-3 sm:hidden">
                  {hasViews || sort || densityLink ? (
                    <div className="grid gap-1.5">
                      <p className="text-xs font-semibold text-text-muted">Görünüm ve sıralama</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {hasViews ? <ViewSwitcher options={views!} active={activeView!} /> : null}
                        {sort}
                        {densityLink}
                      </div>
                    </div>
                  ) : null}
                  {sheetExtras}
                  {savedViews}
                </div>
              ) : null}
              {panel ? (
                <Form action={pathname} prefetch={false} className="grid gap-3">
                  {panelHidden.map(([k, v]) => (
                    <input key={`${k}-${v}`} type="hidden" name={k} value={v} />
                  ))}
                  <PanelSearchCarry name={searchName} />
                  {panel}
                  <button
                    type="submit"
                    className="focus-ring press min-h-9 touch:min-h-11 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-accent-hover"
                  >
                    Filtreleri uygula
                  </button>
                </Form>
              ) : null}
            </div>
          </details>
        ) : null}

        {sort ? <div className="hidden sm:contents">{sort}</div> : null}

        {densityLink ? <div className="hidden sm:contents">{densityLink}</div> : null}

        {actions}
      </div>

      {chips.length > 0 || resultCount !== undefined ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.clearHref}
              title="Bu filtreyi kaldır"
              className="focus-ring press inline-flex min-h-8 touch:min-h-11 surface-interactive items-center gap-1.5 rounded-full bg-surface-selected px-3 text-xs font-semibold text-brand-700 transition"
            >
              {c.text}
              <X aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only">filtresini kaldır</span>
            </Link>
          ))}
          {clearAll ? (
            <Link
              href={clearAll}
              className="focus-ring inline-flex items-center touch:min-h-11 rounded-[var(--radius-control)] px-1.5 text-xs font-semibold text-text-muted underline-offset-2 hover:text-text hover:underline"
            >
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

      {savedViews ? <div className="mt-2.5 max-sm:hidden">{savedViews}</div> : null}
    </div>
  );
}
