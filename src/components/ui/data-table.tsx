"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  SearchX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "./badge";
import { Checkbox } from "./checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { EmptyStateV3 } from "./empty-state";
import { Skeleton } from "./skeleton";
import { Table, TableFrame, TBody, TD, TFoot, TH, THead, TR } from "./table";
import {
  ariaSortFor,
  checkState,
  DENSITY_META,
  DENSITY_ORDER,
  nextRowIndex,
  nextSort,
  normalizeText,
  parseStoredDensity,
  parseStoredHidden,
  pruneSelection,
  readStorageRaw,
  selectionLabel,
  splitByPriority,
  writeStorageRaw,
  type ColumnPriority,
  type Density,
  type SortDir,
} from "./data-table-logic";

/**
 * DataTable — arama + sıralama + sayfalama içeren paylaşılan liste tablosu.
 *
 * MİMARİ NOTU (önemli): Bu bir Client Component olduğu için props'ların
 * serileştirilebilir olması gerekir — bu yüzden kolonlar `render` fonksiyonu
 * DEĞİL, bildirimsel bir `format` alanı taşır. Böylece tablo, panel genelindeki
 * Server Component sayfalardan doğrudan çağrılabilir; sayfayı client'a
 * çevirmeye ve veri çekmeyi tarayıcıya taşımaya gerek kalmaz.
 *
 * Hücrede tamamen özel bir görünüm gerekiyorsa (avatar + rozet + alt satır gibi)
 * `table.tsx` primitive'leriyle elle kurulum yapılır; DataTable "düz liste"
 * sayfaları içindir — giderler, teklifler, sözleşmeler, kampanyalar…
 *
 * PREMIUM ÖZELLİKLER (hepsi opt-in; hiçbiri verilmezse eski davranış birebir):
 *  - `densityToggle`  : Rahat 44 / Normal 40 / Sıkı 32px; `storageKey` ile kalıcı
 *  - `columnMenu`     : sütun görünürlüğü menüsü; `storageKey` ile kalıcı
 *  - `stickyHeader`   : başlık, tablo kabında yapışır
 *  - `selectable`     : satır seçimi + toplu eylem çubuğu (`bulkActions`)
 *  - `keyboardNav`    : ok/j/k gezinme, Enter açar, Space seçer
 *  - `revealRowActions`: satır eylemleri yalnız hover/odakta görünür
 *  - `mobileCards`    : ≤640px'de kart listesi (`column.priority` ile)
 *  - `loading`        : iskelet satırlar
 */

export type DataTableFormat =
  | "text"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "percent"
  | "badge"
  /** Satır sonu aksiyon linki — etiket `linkLabel`, hedef `hrefKey` ya da `_href` */
  | "link";

export type DataTableColumn = {
  /** Satır nesnesindeki alan adı. */
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  /** Başlığa tıklayarak sıralama. Sayısal/metin ayrımı otomatik yapılır. */
  sortable?: boolean;
  /** Arama kutusunun bu kolonu taraması. Varsayılan: metin kolonları taranır. */
  searchable?: boolean;
  format?: DataTableFormat;
  /** `format: "badge"` için değer → etiket + ton eşlemesi. */
  badges?: Record<string, { label?: string; variant?: BadgeVariant }>;
  /** Dar ekranlarda gizle — yatay kaydırmayı azaltır. */
  hideBelow?: "sm" | "md" | "lg";
  /** Alt toplam satırında bu kolonu topla (number/money/percent). */
  total?: boolean;
  /**
   * İkinci, soluk satır (ör. başlığın altında portföy adı).
   * Serileştirilebilir kalmak için render fonksiyonu değil, alan adı.
   * Aramada bu alan da taranır.
   */
  subtitleKey?: string;
  /** `format: "link"` için buton etiketi. */
  linkLabel?: string;
  /** `format: "link"` için hedefi taşıyan alan; verilmezse satırın `_href`i. */
  hrefKey?: string;
  /**
   * Mobil kart görünümündeki rol (`mobileCards` açıkken):
   * "primary" kart başlığı (varsayılan: ilk kolon), "secondary" etiketli satır
   * (varsayılan: diğerleri), "hidden" mobilde hiç gösterilmez.
   */
  priority?: ColumnPriority;
  /** Sütun menüsünde gizlenemesin (ilk kolon her zaman gizlenemez). */
  pinned?: boolean;
};

export type DataTableRow = Record<string, string | number | boolean | null | undefined>;

/** Satırı tıklanabilir yapmak için satır nesnesine eklenen ayrılmış alan. */
export const ROW_HREF = "_href";

export type DataTableEmpty = {
  title?: string;
  description?: string;
  /** Örn. `<Inbox />` — verilmezse arama ikonu. */
  icon?: ReactNode;
  /** Birincil eylem (Button/Link düğümü). Arama boşluğunda "Aramayı temizle" otomatik gelir. */
  action?: ReactNode;
};

/** `bulkActions` içindeki client bileşenleri seçili id'lere buradan ulaşır. */
const SelectionContext = createContext<{ selectedIds: string[]; clear: () => void }>({
  selectedIds: [],
  clear: () => {},
});

export function useDataTableSelection() {
  return useContext(SelectionContext);
}

const hideClass = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;

const collator = new Intl.Collator("tr", { numeric: true, sensitivity: "base" });

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("tr-TR");

/**
 * Bir hücrenin arama/sıralama için kullanılacak metin karşılığı.
 * Rozet kolonlarında ham değer değil ekranda görünen Türkçe etiket esas alınır —
 * böylece kullanıcı "kabul" yazdığında `accepted` satırı bulunur.
 */
function displayText(col: DataTableColumn | undefined, value: DataTableRow[string]) {
  if (value === null || value === undefined) return "";
  if (col?.format === "badge") return col.badges?.[String(value)]?.label ?? String(value);
  return String(value);
}

function formatCell(value: DataTableRow[string], format: DataTableFormat = "text") {
  if (value === null || value === undefined || value === "") return "—";

  switch (format) {
    case "money":
      return tryFormatter.format(Number(value));
    case "number":
      return numberFormatter.format(Number(value));
    case "percent":
      return `%${numberFormatter.format(Number(value))}`;
    case "date":
    case "datetime": {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        ...(format === "datetime" ? { hour: "2-digit", minute: "2-digit" } : {}),
      });
    }
    default:
      return String(value);
  }
}

/* ── Kalıcı tercih (localStorage) — SSR/hydration uyumlu ───────────────── */

const PREF_EVENT = "datatable-pref";

function subscribePref(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(PREF_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PREF_EVENT, callback);
  };
}

/**
 * `key` verilirse tercih localStorage'da kalıcıdır (useSyncExternalStore:
 * sunucuda/hydration'da null, sonra gerçek değer — uyumsuzluk uyarısı yok).
 * localStorage kapalıysa yerel state'e düşer.
 */
function usePersistedRaw(key: string | undefined): [string | null, (value: string) => void] {
  const stored = useSyncExternalStore(
    subscribePref,
    () => (key ? readStorageRaw(key) : null),
    () => null,
  );
  const [local, setLocal] = useState<string | null>(null);
  const set = useCallback(
    (value: string) => {
      setLocal(value);
      if (key) {
        writeStorageRaw(key, value);
        window.dispatchEvent(new Event(PREF_EVENT));
      }
    },
    [key],
  );
  return [local ?? stored, set];
}

/* ── Hücre içeriği (tablo + kart ortak) ───────────────────────────────── */

const CellContent = memo(function CellContent({
  col,
  row,
  hideSubtitle,
}: {
  col: DataTableColumn;
  row: DataTableRow;
  hideSubtitle?: boolean;
}) {
  const value = row[col.key];
  if (col.format === "badge") {
    if (value == null || value === "") return <>—</>;
    const badge = col.badges?.[String(value)];
    return (
      <Badge variant={badge?.variant ?? "default"} size="sm">
        {badge?.label ?? String(value)}
      </Badge>
    );
  }
  if (col.format === "link") {
    const target = col.hrefKey ? row[col.hrefKey] : row[ROW_HREF];
    if (typeof target !== "string" || target === "") return null;
    return (
      <Link
        href={target}
        // relative + z-10: satırı kaplayan görünmez bağlantının
        // üstünde kalsın, tıklama buraya gelsin
        className="focus-ring press relative z-10 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] surface-interactive border border-hairline bg-surface px-3 py-1.5 touch:min-h-11 text-xs font-semibold text-brand-700 shadow-[var(--elev-1)] transition"
      >
        {col.linkLabel ?? "Aç"}
      </Link>
    );
  }
  return (
    <>
      {formatCell(value, col.format)}
      {!hideSubtitle && col.subtitleKey && row[col.subtitleKey] ? (
        <span className="mt-0.5 block text-xs font-normal text-text-faint">
          {String(row[col.subtitleKey])}
        </span>
      ) : null}
    </>
  );
});

/* ── Tablo satırı (memo) ────────────────────────────────────────────────── */

type RowViewProps = {
  row: DataTableRow;
  index: number;
  id: string | null;
  href: string | null;
  isSelected: boolean;
  keyboardNav: boolean;
  /** Roving tabindex: bu satır klavye odağının giriş noktası mı? */
  roving: boolean;
  density: Density;
  densityMeta: { rowClass: string; cellClass: string };
  revealRowActions: boolean;
  showSelect: boolean;
  hasActions: boolean;
  visibleColumns: DataTableColumn[];
  action: ReactNode;
  onToggle: (id: string) => void;
  onFocusRow: (index: number) => void;
};

/**
 * Satır bileşeni `memo` ile: arama yazarken, sıralarken, sayfa değiştirirken ya da bir satır seçilirken yalnız
 * prop'u değişen satırlar yeniden çizilir (seçim/odak diğer 24 satırı tekrar üretmez). Davranış aynıdır;
 * `onToggle`/`onFocusRow` kararlı referanslardır (useCallback / state setter).
 */
const DataTableRowView = memo(function DataTableRowView({
  row,
  index,
  id,
  href,
  isSelected,
  keyboardNav,
  roving,
  density,
  densityMeta,
  revealRowActions,
  showSelect,
  hasActions,
  visibleColumns,
  action,
  onToggle,
  onFocusRow,
}: RowViewProps) {
  return (
    <TR
      interactive={Boolean(href)}
      data-row-index={keyboardNav ? index : undefined}
      data-row-id={keyboardNav && id ? id : undefined}
      data-selected={isSelected || undefined}
      tabIndex={keyboardNav ? (roving ? 0 : -1) : undefined}
      onFocus={
        keyboardNav
          ? (e) => {
              if (e.target === e.currentTarget) onFocusRow(index);
            }
          : undefined
      }
      className={cn(
        densityMeta.rowClass,
        (revealRowActions || keyboardNav) && "group",
        isSelected && "bg-surface-selected",
        keyboardNav &&
          "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]",
      )}
    >
      {showSelect ? (
        <TD className={cn("w-px pr-0", densityMeta.cellClass)}>
          {/* relative + z-10: satır bağlantısı katmanının üstünde kalsın */}
          <Checkbox
            aria-label="Satırı seç"
            className="relative z-10"
            checked={isSelected}
            disabled={id === null}
            tabIndex={keyboardNav ? -1 : undefined}
            onChange={() => id !== null && onToggle(id)}
          />
        </TD>
      ) : null}
      {visibleColumns.map((col, colIndex) => (
        <TD
          key={col.key}
          align={col.align}
          className={cn(
            densityMeta.cellClass,
            col.hideBelow ? hideClass[col.hideBelow] : undefined,
            colIndex === 0 && "font-semibold text-ink-950",
          )}
        >
          {/* Satır linki: ilk hücrede tüm satırı kaplayan görünmez bağlantı —
              panelde zaten kullanılan desen, iç içe <a> üretmez. */}
          {href && colIndex === 0 ? (
            <Link
              href={href}
              data-row-link=""
              tabIndex={keyboardNav ? -1 : undefined}
              className="absolute inset-0"
              aria-label={`${String(row[col.key] ?? "Kayıt")} detayları`}
            />
          ) : null}
          <CellContent col={col} row={row} hideSubtitle={density === "compact"} />
        </TD>
      ))}
      {hasActions ? (
        <TD align="right" className={cn("whitespace-nowrap", densityMeta.cellClass)}>
          {/* relative + z-10: satırı kaplayan görünmez bağlantının
              üstünde kalsın, tıklama aksiyona gelsin */}
          <span
            className={cn(
              "relative z-10 inline-flex items-center gap-1 transition-opacity",
              revealRowActions &&
                "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
            )}
          >
            {action}
          </span>
        </TD>
      ) : null}
    </TR>
  );
});

const pagerButton =
  "focus-ring press surface-interactive inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 touch:min-h-11 font-medium text-ink-950 shadow-[var(--elev-1)] transition disabled:pointer-events-none disabled:opacity-40";

export function DataTable({
  columns,
  rows,
  searchPlaceholder = "Tabloda ara…",
  searchable = true,
  pageSize = 25,
  showTotals = false,
  minWidth = 760,
  empty,
  className,
  toolbar,
  rowActions,
  actionsHeader,
  loading = false,
  loadingRows = 6,
  densityToggle = false,
  defaultDensity = "normal",
  storageKey,
  columnMenu = false,
  stickyHeader = false,
  selectable = false,
  bulkActions,
  keyboardNav = false,
  revealRowActions = false,
  mobileCards = false,
  caption,
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  searchPlaceholder?: string;
  searchable?: boolean;
  /** 0 verilirse sayfalama kapanır. */
  pageSize?: number;
  showTotals?: boolean;
  minWidth?: number;
  empty?: DataTableEmpty;
  className?: string;
  /** Arama kutusunun yanına konacak ek kontroller (filtre menüsü, CSV vb.). */
  toolbar?: ReactNode;
  /**
   * Satır başına etkileşimli aksiyonlar (düzenle/sil/gönder düğmeleri).
   *
   * Neden `Record<id, ReactNode>` ve dizi değil: tablo sıralanıp filtrelendiği
   * için indeks hizası bozulur; id ile eşleme sırayla birlikte kayar.
   *
   * Neden serileştirme sorunu YOK: Server Component'ten Client Component'e
   * FONKSİYON geçirilemez ama React ELEMENTİ geçirilebilir (RSC payload'ında
   * taşınır). Sunucu sayfası aksiyon bileşenlerini kendisi render edip buraya
   * verir; DataTable yalnızca yerleştirir.
   */
  rowActions?: Record<string, ReactNode>;
  /** Aksiyon kolonunun başlığı (varsayılan: gizli). */
  actionsHeader?: string;
  /** true: gövde yerine iskelet satırlar (aria-busy). */
  loading?: boolean;
  loadingRows?: number;
  /** Rahat 44 / Normal 40 / Sıkı 32 anahtarını araç çubuğuna ekler. */
  densityToggle?: boolean;
  defaultDensity?: Density;
  /**
   * Kullanıcı tercihlerini (yoğunluk, gizli sütunlar) localStorage'da saklar;
   * `${storageKey}:density` / `${storageKey}:columns`. Tabloya özgü benzersiz ad ver.
   */
  storageKey?: string;
  /** Sütun görünürlüğü menüsü. */
  columnMenu?: boolean;
  /** Başlığı yapıştır. `true` → tablo kabı 70vh; string → özel max-height ("60vh"). */
  stickyHeader?: boolean | string;
  /** Satır seçimi (id'si olan satırlar). Toplu çubuk için `bulkActions` ver. */
  selectable?: boolean;
  /**
   * Seçim varken çıkan çubuğa konan eylemler. Server Component'ten ELEMENT
   * olarak verilir; seçili id'lere `useDataTableSelection()` ile ulaşılır.
   */
  bulkActions?: ReactNode;
  /** Ok tuşları / j-k ile satır gezinme; Enter satırı açar, Space seçer. */
  keyboardNav?: boolean;
  /** Satır eylemleri yalnız hover/odak/dokunmatikte görünür (Attio tarzı). */
  revealRowActions?: boolean;
  /** ≤640px'de tabloyu kart listesine çevir (`column.priority`). */
  mobileCards?: boolean;
  /** Ekran okuyucu için tablo başlığı (görsel olarak gizli). */
  caption?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string | null; dir: SortDir }>({
    key: null,
    dir: "asc",
  });
  const sortKey = sort.key;
  const sortDir = sort.dir;
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [densityRaw, setDensityRaw] = usePersistedRaw(
    storageKey ? `${storageKey}:density` : undefined,
  );
  const density = parseStoredDensity(densityRaw, defaultDensity);
  const densityMeta = DENSITY_META[density];

  const [hiddenRaw, setHiddenRaw] = usePersistedRaw(
    storageKey ? `${storageKey}:columns` : undefined,
  );
  const hiddenKeys = useMemo(() => new Set(parseStoredHidden(hiddenRaw)), [hiddenRaw]);

  const visibleColumns = useMemo(
    () => columns.filter((c, i) => i === 0 || !hiddenKeys.has(c.key)),
    [columns, hiddenKeys],
  );

  const searchColumns = useMemo(
    () =>
      columns.filter((c) =>
        c.searchable ?? (c.format === undefined || c.format === "text" || c.format === "badge"),
      ),
    [columns],
  );

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return rows;
    return rows.filter((row) =>
      searchColumns.some((col) => {
        const text = displayText(col, row[col.key]);
        if (text !== "" && normalizeText(text).includes(q)) return true;
        // Alt satır da aranabilir olmalı: kullanıcı portföy adıyla sözleşme arıyor
        if (col.subtitleKey) {
          const sub = row[col.subtitleKey];
          if (sub != null && normalizeText(String(sub)).includes(q)) return true;
        }
        return false;
      }),
    );
  }, [rows, query, searchColumns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    const factor = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // boşlar her zaman sonda
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      // Rozet kolonlarında görünen Türkçe etikete göre sırala — ham enum değerine
      // ("accepted", "countered") göre sıralamak kullanıcıya rastgele görünür.
      return collator.compare(displayText(col, av), displayText(col, bv)) * factor;
    });
  }, [filtered, columns, sortKey, sortDir]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const visible =
    pageSize > 0 ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  const totals = useMemo(() => {
    if (!showTotals) return null;
    const acc: Record<string, number> = {};
    for (const col of visibleColumns) {
      if (!col.total) continue;
      acc[col.key] = sorted.reduce((sum, row) => sum + Number(row[col.key] ?? 0), 0);
    }
    return acc;
  }, [showTotals, visibleColumns, sorted]);

  /* Seçim: yalnız görünür (filtre sonrası) satırlar geçerli sayılır. */
  const rowId = (row: DataTableRow) => (row.id != null ? String(row.id) : null);
  const selectableIds = useMemo(
    () =>
      new Set(
        sorted.map((r) => (r.id != null ? String(r.id) : null)).filter((x): x is string => x !== null),
      ),
    [sorted],
  );
  const effectiveSelected = useMemo(
    () => (selectable ? pruneSelection(selected, selectableIds) : selected),
    [selectable, selected, selectableIds],
  );
  const pageIds = visible.map(rowId).filter((x): x is string => x !== null);
  const pageSelectedCount = pageIds.filter((id) => effectiveSelected.has(id)).length;
  const headCheck = checkState(pageSelectedCount, pageIds.length);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (headCheck === "all") pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const selectionValue = useMemo(
    () => ({ selectedIds: [...effectiveSelected], clear: clearSelection }),
    [effectiveSelected, clearSelection],
  );

  function toggleSort(key: string) {
    setSort((cur) => nextSort(cur, key));
  }

  function setHidden(key: string, hide: boolean) {
    const next = new Set(hiddenKeys);
    if (hide) next.add(key);
    else next.delete(key);
    setHiddenRaw(JSON.stringify([...next]));
  }

  /* Klavye gezinme (roving tabindex): yalnız SATIRIN KENDİSİ odaktayken. */
  const focusRow = useCallback((index: number) => {
    setActiveIndex(index);
    wrapperRef.current
      ?.querySelector<HTMLElement>(`tr[data-row-index="${index}"]`)
      ?.focus();
  }, []);

  function onTableKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!keyboardNav || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.dataset.rowIndex === undefined) return;
    const index = Number(target.dataset.rowIndex);

    if (event.key === "Enter") {
      const link = target.querySelector<HTMLAnchorElement>("a[data-row-link]");
      if (link) {
        event.preventDefault();
        link.click();
      }
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      if (!selectable) return;
      const id = target.dataset.rowId;
      if (id) {
        event.preventDefault();
        toggleOne(id);
      }
      return;
    }
    if (event.key === "Escape" && effectiveSelected.size > 0) {
      event.preventDefault();
      clearSelection();
      return;
    }
    const next = nextRowIndex(index, event.key, visible.length);
    if (next !== null) {
      event.preventDefault();
      focusRow(next);
    }
  }

  const hasActions = Boolean(rowActions);
  const showSelect = selectable;
  const colCount = visibleColumns.length + (hasActions ? 1 : 0) + (showSelect ? 1 : 0);
  const rovingIndex = Math.min(activeIndex, Math.max(0, visible.length - 1));
  const stickyMax =
    typeof stickyHeader === "string" ? stickyHeader : stickyHeader ? "70vh" : undefined;
  const showToolbar = searchable || toolbar || columnMenu || densityToggle;

  const emptyTitle = empty?.title ?? (query ? "Aramanızla eşleşen kayıt yok" : "Kayıt yok");
  const emptyAction =
    empty?.action ??
    (query ? (
      <button
        type="button"
        onClick={() => setQuery("")}
        className="focus-ring press surface-interactive inline-flex h-8 touch:h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline bg-surface px-3 text-xs font-semibold text-ink-950 shadow-[var(--elev-1)] transition"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" /> Aramayı temizle
      </button>
    ) : undefined);
  const emptyNode = (
    <EmptyStateV3
      bare
      title={emptyTitle}
      description={empty?.description}
      icon={empty?.icon ?? <SearchX />}
      action={emptyAction}
      className="py-10"
    />
  );

  const hideableColumns = columns.filter((c, i) => i !== 0 && !c.pinned);
  const cardParts = mobileCards ? splitByPriority(visibleColumns) : null;

  return (
    <SelectionContext.Provider value={selectionValue}>
      <div className={cn("space-y-3", className)}>
        {showToolbar ? (
          <div className="flex flex-wrap items-center gap-2">
            {searchable ? (
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="focus-ring surface-sunken w-full max-w-xs rounded-[var(--radius-control)] border border-hairline px-3 py-2 text-sm outline-none transition focus:bg-surface"
              />
            ) : null}
            {toolbar}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span
                className="numeric text-xs font-medium tracking-wide text-text-faint"
                aria-live="polite"
              >
                {sorted.length} kayıt
                {sorted.length !== rows.length ? ` · ${rows.length} içinden` : ""}
              </span>
              {columnMenu && hideableColumns.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="focus-ring press surface-interactive inline-flex h-8 touch:h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 text-xs font-semibold text-ink-950 shadow-[var(--elev-1)] transition"
                    >
                      <Columns3 className="h-3.5 w-3.5" aria-hidden="true" /> Sütunlar
                      {hiddenKeys.size > 0 ? (
                        <span className="numeric text-text-faint">
                          {visibleColumns.length}/{columns.length}
                        </span>
                      ) : null}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Görünen sütunlar</DropdownMenuLabel>
                    {hideableColumns.map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={!hiddenKeys.has(col.key)}
                        onCheckedChange={(checked) => setHidden(col.key, !checked)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {col.header}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {densityToggle ? (
                <div
                  role="group"
                  aria-label="Satır yoğunluğu"
                  className="inline-flex rounded-[var(--radius-control)] border border-hairline bg-surface p-0.5 shadow-[var(--elev-1)]"
                >
                  {DENSITY_ORDER.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={density === d}
                      title={`${DENSITY_META[d].label} · ${DENSITY_META[d].height}px satır`}
                      onClick={() => setDensityRaw(d)}
                      className={cn(
                        "focus-ring inline-flex h-7 touch:h-11 items-center rounded-[var(--radius-chip)] px-2.5 text-xs font-semibold transition",
                        density === d
                          ? "bg-brand-600/10 text-brand-700"
                          : "text-text-muted hover:text-ink-950",
                      )}
                    >
                      {DENSITY_META[d].label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Kart listesi (≤640px) */}
        {cardParts ? (
          <div className="sm:hidden" aria-busy={loading || undefined}>
            {loading ? (
              <ul className="space-y-2" aria-hidden="true">
                {Array.from({ length: Math.min(loadingRows, 4) }).map((_, i) => (
                  <li key={i} className="surface-card space-y-2 rounded-[var(--radius-card)] p-4">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </li>
                ))}
              </ul>
            ) : visible.length === 0 ? (
              <div className="surface-card rounded-[var(--radius-card)]">{emptyNode}</div>
            ) : (
              <ul className="list-stagger space-y-2">
                {visible.map((row, index) => {
                  const href = typeof row[ROW_HREF] === "string" ? (row[ROW_HREF] as string) : null;
                  const id = rowId(row);
                  const title = cardParts.primary[0];
                  return (
                    <li
                      key={String(row.id ?? index)}
                      className={cn(
                        "surface-card relative space-y-2 rounded-[var(--radius-card)] p-4",
                        href && "surface-interactive hover-lift",
                      )}
                    >
                      {href ? (
                        <Link
                          href={href}
                          className="focus-ring absolute inset-0 rounded-[var(--radius-card)]"
                          aria-label={`${String(title ? (row[title.key] ?? "Kayıt") : "Kayıt")} detayları`}
                        />
                      ) : null}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 font-semibold text-ink-950">
                          {cardParts.primary.map((col) => (
                            <div key={col.key} className="break-words">
                              <CellContent col={col} row={row} />
                            </div>
                          ))}
                        </div>
                        {hasActions && id ? (
                          <span className="relative z-10 inline-flex shrink-0 items-center gap-1">
                            {rowActions?.[id] ?? null}
                          </span>
                        ) : null}
                      </div>
                      {cardParts.secondary.length > 0 ? (
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                          {cardParts.secondary.map((col) => (
                            <div key={col.key} className="contents">
                              <dt className="text-xs font-medium text-text-faint">{col.header}</dt>
                              <dd className="min-w-0 break-words text-right text-text">
                                <CellContent col={col} row={row} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {/* Tablo */}
        <div
          ref={wrapperRef}
          onKeyDown={onTableKeyDown}
          className={cardParts ? "hidden sm:block" : undefined}
        >
          <TableFrame minWidth={minWidth} maxHeight={stickyMax}>
            <Table aria-busy={loading || undefined} data-density={density}>
              {caption ? <caption className="sr-only">{caption}</caption> : null}
              <THead
                className={cn(
                  stickyMax && "[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-canvas",
                )}
              >
                <TR>
                  {showSelect ? (
                    <TH className="w-px pr-0">
                      <Checkbox
                        aria-label="Bu sayfadaki tüm satırları seç"
                        checked={headCheck === "all"}
                        disabled={pageIds.length === 0}
                        ref={(el: HTMLInputElement | null) => {
                          if (el) el.indeterminate = headCheck === "some";
                        }}
                        onChange={togglePage}
                      />
                    </TH>
                  ) : null}
                  {visibleColumns.map((col) => {
                    const active = sortKey === col.key;
                    const SortIcon = !active ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <TH
                        key={col.key}
                        align={col.align}
                        className={col.hideBelow ? hideClass[col.hideBelow] : undefined}
                        aria-sort={ariaSortFor(active, sortDir)}
                      >
                        {col.sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              "focus-ring inline-flex items-center gap-1.5 rounded-md px-0.5 uppercase tracking-[0.04em] transition hover:text-ink-950",
                              active && "text-brand-700",
                            )}
                          >
                            {col.header}
                            <SortIcon
                              aria-hidden="true"
                              className={cn("h-3.5 w-3.5", active ? "text-brand-600" : "text-text-faint")}
                            />
                          </button>
                        ) : (
                          col.header
                        )}
                      </TH>
                    );
                  })}
                  {hasActions ? (
                    <TH align="right" className="w-px">
                      {actionsHeader ? actionsHeader : <span className="sr-only">İşlemler</span>}
                    </TH>
                  ) : null}
                </TR>
              </THead>

              <TBody>
                {loading ? (
                  Array.from({ length: loadingRows }).map((_, r) => (
                    <TR key={`sk-${r}`} className={densityMeta.rowClass} aria-hidden="true">
                      {Array.from({ length: colCount }).map((__, c) => (
                        <TD key={c} className={densityMeta.cellClass}>
                          <Skeleton className={cn("h-3.5", c === 0 ? "w-4/5" : "w-1/2")} />
                        </TD>
                      ))}
                    </TR>
                  ))
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-4 text-center text-sm text-text-muted">
                      {emptyNode}
                    </td>
                  </tr>
                ) : (
                  visible.map((row, index) => {
                    const href = typeof row[ROW_HREF] === "string" ? (row[ROW_HREF] as string) : null;
                    const id = rowId(row);
                    return (
                      <DataTableRowView
                        key={String(row.id ?? index)}
                        row={row}
                        index={index}
                        id={id}
                        href={href}
                        isSelected={id !== null && effectiveSelected.has(id)}
                        keyboardNav={keyboardNav}
                        roving={index === rovingIndex}
                        density={density}
                        densityMeta={densityMeta}
                        revealRowActions={revealRowActions}
                        showSelect={showSelect}
                        hasActions={hasActions}
                        visibleColumns={visibleColumns}
                        action={rowActions?.[String(row.id ?? "")] ?? null}
                        onToggle={toggleOne}
                        onFocusRow={setActiveIndex}
                      />
                    );
                  })
                )}
              </TBody>

              {totals ? (
                <TFoot>
                  <TR>
                    {showSelect ? <TD /> : null}
                    {visibleColumns.map((col, index) => (
                      <TD
                        key={col.key}
                        align={col.align}
                        className={col.hideBelow ? hideClass[col.hideBelow] : undefined}
                      >
                        {index === 0
                          ? "Toplam"
                          : col.total
                            ? formatCell(totals[col.key], col.format)
                            : null}
                      </TD>
                    ))}
                    {hasActions ? <TD /> : null}
                  </TR>
                </TFoot>
              ) : null}
            </Table>
          </TableFrame>
        </div>

        {pageSize > 0 && totalPages > 1 ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="numeric text-text-muted">
              {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} /{" "}
              {sorted.length}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className={pagerButton}
              >
                <ChevronLeft className="icon-nudge-back h-4 w-4" aria-hidden="true" /> Önceki
              </button>
              <span className="px-1 text-text-faint">
                {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className={pagerButton}
              >
                Sonraki <ChevronRight className="icon-nudge h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {/* Toplu eylem çubuğu */}
        {selectable && effectiveSelected.size > 0 ? (
          <div
            role="region"
            aria-label="Toplu eylemler"
            className="surface-card motion-enter sticky bottom-4 z-30 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] px-4 py-2.5 shadow-[var(--elev-3)]"
          >
            <p className="numeric text-sm font-semibold text-ink-950" aria-live="polite">
              {selectionLabel(effectiveSelected.size)}
            </p>
            <div className="flex flex-wrap items-center gap-2">{bulkActions}</div>
            <button
              type="button"
              onClick={clearSelection}
              className="focus-ring press ml-auto inline-flex h-8 touch:h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-xs font-semibold text-text-muted transition hover:bg-surface-hover hover:text-ink-950 active:bg-surface-pressed"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Seçimi temizle
            </button>
          </div>
        ) : null}
      </div>
    </SelectionContext.Provider>
  );
}
