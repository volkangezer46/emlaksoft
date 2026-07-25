"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "./badge";
import { Table, TableEmptyRow, TableFrame, TBody, TD, TFoot, TH, THead, TR } from "./table";

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
};

export type DataTableRow = Record<string, string | number | boolean | null | undefined>;

/** Satırı tıklanabilir yapmak için satır nesnesine eklenen ayrılmış alan. */
export const ROW_HREF = "_href";

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

/** Türkçe arama: küçült + diyakritikleri sadeleştir ("sisli" → "Şişli" bulur). */
function normalize(value: string) {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

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
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  searchPlaceholder?: string;
  searchable?: boolean;
  /** 0 verilirse sayfalama kapanır. */
  pageSize?: number;
  showTotals?: boolean;
  minWidth?: number;
  empty?: { title?: string; description?: string };
  className?: string;
  /** Arama kutusunun yanına konacak ek kontroller (filtre menüsü, CSV vb.). */
  toolbar?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const searchColumns = useMemo(
    () =>
      columns.filter((c) =>
        c.searchable ?? (c.format === undefined || c.format === "text" || c.format === "badge"),
      ),
    [columns],
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return rows;
    return rows.filter((row) =>
      searchColumns.some((col) => {
        const text = displayText(col, row[col.key]);
        if (text !== "" && normalize(text).includes(q)) return true;
        // Alt satır da aranabilir olmalı: kullanıcı portföy adıyla sözleşme arıyor
        if (col.subtitleKey) {
          const sub = row[col.subtitleKey];
          if (sub != null && normalize(String(sub)).includes(q)) return true;
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
    for (const col of columns) {
      if (!col.total) continue;
      acc[col.key] = sorted.reduce((sum, row) => sum + Number(row[col.key] ?? 0), 0);
    }
    return acc;
  }, [showTotals, columns, sorted]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  const colCount = columns.length;

  return (
    <div className={cn("space-y-3", className)}>
      {searchable || toolbar ? (
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
              className="focus-ring surface-sunken w-full max-w-xs rounded-[10px] border border-hairline px-3 py-2 text-sm outline-none transition focus:bg-surface"
            />
          ) : null}
          {toolbar}
          <span
            className="numeric ml-auto text-[11px] font-medium tracking-wide text-text-faint"
            aria-live="polite"
          >
            {sorted.length} kayıt
            {sorted.length !== rows.length ? ` · ${rows.length} içinden` : ""}
          </span>
        </div>
      ) : null}

      <TableFrame minWidth={minWidth}>
        <Table>
          <THead>
            <TR>
              {columns.map((col) => {
                const active = sortKey === col.key;
                const SortIcon = !active ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <TH
                    key={col.key}
                    align={col.align}
                    className={col.hideBelow ? hideClass[col.hideBelow] : undefined}
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "focus-ring inline-flex items-center gap-1.5 rounded-[6px] px-0.5 uppercase tracking-[0.04em] transition hover:text-ink-950",
                          active && "text-brand-700",
                        )}
                      >
                        {col.header}
                        <SortIcon
                          className={cn("h-3.5 w-3.5", active ? "text-brand-600" : "text-text-faint")}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </TH>
                );
              })}
            </TR>
          </THead>

          <TBody>
            {visible.length === 0 ? (
              <TableEmptyRow colSpan={colCount}>
                <span className="inline-flex flex-col items-center gap-2">
                  <SearchX className="h-7 w-7 text-text-faint" />
                  <span className="font-semibold text-ink-950">
                    {empty?.title ?? (query ? "Aramanızla eşleşen kayıt yok" : "Kayıt yok")}
                  </span>
                  {empty?.description ? (
                    <span className="max-w-sm text-text-muted">{empty.description}</span>
                  ) : null}
                </span>
              </TableEmptyRow>
            ) : (
              visible.map((row, index) => {
                const href = typeof row[ROW_HREF] === "string" ? (row[ROW_HREF] as string) : null;
                return (
                  <TR key={String(row.id ?? index)} interactive={Boolean(href)}>
                    {columns.map((col, colIndex) => {
                      const value = row[col.key];
                      const badge = col.format === "badge" && value != null
                        ? col.badges?.[String(value)]
                        : undefined;
                      return (
                        <TD
                          key={col.key}
                          align={col.align}
                          className={cn(
                            col.hideBelow ? hideClass[col.hideBelow] : undefined,
                            colIndex === 0 && "font-semibold text-ink-950",
                          )}
                        >
                          {/* Satır linki: ilk hücrede tüm satırı kaplayan görünmez bağlantı —
                              panelde zaten kullanılan desen, iç içe <a> üretmez. */}
                          {href && colIndex === 0 ? (
                            <Link
                              href={href}
                              className="absolute inset-0"
                              aria-label={`${String(value ?? "Kayıt")} detayları`}
                            />
                          ) : null}
                          {col.format === "badge" ? (
                            value == null || value === "" ? (
                              "—"
                            ) : (
                              <Badge variant={badge?.variant ?? "default"} size="sm">
                                {badge?.label ?? String(value)}
                              </Badge>
                            )
                          ) : col.format === "link" ? (
                            (() => {
                              const target = col.hrefKey ? row[col.hrefKey] : row[ROW_HREF];
                              if (typeof target !== "string" || target === "") return null;
                              return (
                                <Link
                                  href={target}
                                  // relative + z-10: satırı kaplayan görünmez
                                  // bağlantının üstünde kalsın, tıklama buraya gelsin
                                  className="focus-ring press relative z-10 inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-[var(--elev-1)] transition hover:bg-brand-600/5"
                                >
                                  {col.linkLabel ?? "Aç"}
                                </Link>
                              );
                            })()
                          ) : (
                            <>
                              {formatCell(value, col.format)}
                              {col.subtitleKey && row[col.subtitleKey] ? (
                                <span className="mt-0.5 block text-[11px] font-normal text-text-faint">
                                  {String(row[col.subtitleKey])}
                                </span>
                              ) : null}
                            </>
                          )}
                        </TD>
                      );
                    })}
                  </TR>
                );
              })
            )}
          </TBody>

          {totals ? (
            <TFoot>
              <TR>
                {columns.map((col, index) => (
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
              </TR>
            </TFoot>
          ) : null}
        </Table>
      </TableFrame>

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
              className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Önceki
            </button>
            <span className="px-1 text-text-faint">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas disabled:pointer-events-none disabled:opacity-40"
            >
              Sonraki <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
