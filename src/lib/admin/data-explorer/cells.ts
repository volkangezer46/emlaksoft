/**
 * Veri gezgini hücre biçimi — saf. Maskeli sütun HER ZAMAN `maskValue`'dan geçer (biçimden önce); diğerleri türüne göre
 * Türkçe biçimlenir. Dönen değer düz metindir (React kaçışlar); null = boş hücre.
 */
import { formatDateTimeTr, formatDateTr, formatTry } from "@/lib/format";
import { maskValue } from "./mask";
import type { ExplorerColumn } from "./registry";

const TEXT_MAX = 200;

export function formatCell(col: ExplorerColumn, value: unknown): string | null {
  if (col.mask) return maskValue(col.mask, value);
  if (value === null || value === undefined || value === "") return null;
  switch (col.kind) {
    case "bool":
      return value === true ? "Evet" : value === false ? "Hayır" : String(value);
    case "money": {
      const n = Number(value);
      return Number.isFinite(n) ? formatTry(n) : String(value);
    }
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : String(value);
    }
    case "date":
      return typeof value === "string" ? formatDateTr(value) : String(value);
    case "datetime":
      return typeof value === "string" ? formatDateTimeTr(value) : String(value);
    case "array":
      return Array.isArray(value) ? value.map(String).join(", ") || null : String(value);
    default: {
      const s = typeof value === "object" ? JSON.stringify(value) : String(value);
      return s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}…` : s;
    }
  }
}

/** Satırın tüm kayıtlı sütunlarını biçimler (maskeler uygulanmış). Ham satır bu fonksiyondan sonra kullanılmaz. */
export function formatRow(columns: readonly ExplorerColumn[], row: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(columns.map((c) => [c.key, formatCell(c, row[c.key])]));
}
