/**
 * Rapor hücre değerleri: tek biçimleme kaynağı (CSV, PDF, önizleme ve XLSX seri sayıları).
 * Saf modül. Tarihler Türkiye saatiyle (Europe/Istanbul) yazılır; sayılar tr-TR gösterimidir
 * (binlik nokta, ondalık virgül) ve Intl'e bağlı olmadığı için ortamdan bağımsızdır.
 */
import { DAY_MS, trParts } from "@/lib/clock";
import type { CellValue, ColumnType, ReportColumn } from "./types";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toNumber(value: CellValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** 1234567.891, 2 → "1.234.567,89" */
export function formatNumberTr(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [intPart, frac] = fixed.split(".");
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = frac ? `${grouped},${frac}` : grouped;
  return n < 0 && Number(fixed) !== 0 ? `-${body}` : body;
}

type DateParts = { y: number; m: number; d: number; hh: number; mm: number; dateOnly: boolean };

function dateParts(value: CellValue): DateParts | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  const only = DATE_ONLY.exec(s);
  if (only) return { y: Number(only[1]), m: Number(only[2]), d: Number(only[3]), hh: 0, mm: 0, dateOnly: true };
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  const p = trParts(t);
  return { y: p.year, m: p.month + 1, d: p.day, hh: p.hour, mm: p.minute, dateOnly: false };
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function formatDateTr(value: CellValue): string {
  const p = dateParts(value);
  return p ? `${p2(p.d)}.${p2(p.m)}.${p.y}` : "";
}

export function formatDateTimeTr(value: CellValue): string {
  const p = dateParts(value);
  if (!p) return "";
  return p.dateOnly ? `${p2(p.d)}.${p2(p.m)}.${p.y}` : `${p2(p.d)}.${p2(p.m)}.${p.y} ${p2(p.hh)}:${p2(p.mm)}`;
}

/** Excel seri günü (1900 sistemi). Zaman damgası Türkiye duvar saatidir. */
export function excelSerial(value: CellValue, withTime: boolean): number | null {
  const p = dateParts(value);
  if (!p) return null;
  const day = Date.UTC(p.y, p.m - 1, p.d) / DAY_MS + 25569;
  if (!withTime || p.dateOnly) return day;
  return day + (p.hh * 60 + p.mm) / 1440;
}

type DisplayCol = Pick<ReportColumn, "type" | "decimals">;

const DEFAULT_DECIMALS: Record<ColumnType, number> = { text: 0, date: 0, datetime: 0, money: 2, number: 0, percent: 1, bool: 0 };

export function columnDecimals(col: DisplayCol): number {
  return col.decimals ?? DEFAULT_DECIMALS[col.type];
}

/** Dosya ve ekran gösterimi (CSV/PDF/önizleme). Boş değer "" döner. */
export function displayValue(value: CellValue, col: DisplayCol): string {
  if (value === null || value === undefined || value === "") return "";
  switch (col.type) {
    case "date":
      return formatDateTr(value);
    case "datetime":
      return formatDateTimeTr(value);
    case "money":
    case "number": {
      const n = toNumber(value);
      return n === null ? String(value) : formatNumberTr(n, columnDecimals(col));
    }
    case "percent": {
      const n = toNumber(value);
      return n === null ? String(value) : `%${formatNumberTr(n, columnDecimals(col))}`;
    }
    case "bool":
      return value === true || value === "true" || value === 1 || value === "1" ? "Evet" : "Hayır";
    default:
      return String(value);
  }
}

/** Toplam satırı: yalnız `total: true` sayısal sütunlar toplanır. */
export function computeTotals(
  columns: readonly Pick<ReportColumn, "type" | "total">[],
  rows: readonly CellValue[][],
): (number | null)[] {
  return columns.map((c, i) => {
    if (!c.total || (c.type !== "money" && c.type !== "number")) return null;
    let sum = 0;
    let any = false;
    for (const r of rows) {
      const n = toNumber(r[i]);
      if (n !== null) {
        sum += n;
        any = true;
      }
    }
    return any ? Math.round(sum * 100) / 100 : null;
  });
}

/** Dosya adı için güvenli (ASCII) parça: Türkçe karakterler sadeleştirilir. */
export function safeFileSlug(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", I: "i", Ö: "o", Ş: "s", Ü: "u" };
  return text
    .replace(/[çğıöşüÇĞİIÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
