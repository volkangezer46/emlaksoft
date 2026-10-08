/**
 * CSV yazıcı — Excel-TR uyumlu: UTF-8 BOM, `;` ayraç, CRLF, ondalık virgül ve gg.aa.yyyy tarih.
 * Her hücre `escapeCsvCell` ile tırnaklanır ve formül enjeksiyonuna (= + - @ önekleri) karşı korunur.
 */
import { escapeCsvCell } from "@/lib/csv";
import { displayValue } from "../values";
import type { ReportMeta, ReportTable } from "../types";

export const CSV_BOM = "﻿";

export function buildCsv(meta: Pick<ReportMeta, "truncated">, table: ReportTable): string {
  const lines: string[] = [];
  lines.push(table.columns.map((c) => escapeCsvCell(c.label)).join(";"));
  for (const row of table.rows) {
    lines.push(table.columns.map((c, i) => escapeCsvCell(displayValue(row[i], c))).join(";"));
  }
  if (meta.truncated) {
    lines.push(escapeCsvCell("UYARI: Güvenlik sınırı nedeniyle kayıtların yalnızca ilk bölümü dışa aktarıldı. Tamamı için filtreyi daraltın."));
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
