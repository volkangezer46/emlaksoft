/**
 * Rapor önizleme grafiği — SAF (DG4). Önizleme tablosundan (ek sorgu YOK) basit bir sütun grafiği verisi çıkarır:
 * kategori = ilk metin ya da tarih sütunu, değer = ilk toplanabilir para/sayı sütunu (yoksa kayıt sayısı).
 * Tarih sütununda aya (kısa aralıkta güne) göre kronolojik; metinde en büyük 8 + "Diğer". Anlamlı grafik yoksa null
 * (tek kategori, boş tablo): sahte grafik çizilmez.
 */
import type { CellValue, ReportTable } from "./types";

export type ReportChartBar = { label: string; value: number };
export type ReportChart = { categoryLabel: string; valueLabel: string; format: "money" | "number"; bars: ReportChartBar[] };

const TOP = 8;
const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function num(v: CellValue): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

export function reportChartFromTable(table: Pick<ReportTable, "columns" | "rows">): ReportChart | null {
  if (table.rows.length < 2) return null;
  const cols = table.columns;
  const catIdx = cols.findIndex((c) => c.type === "text" || c.type === "date" || c.type === "datetime");
  if (catIdx < 0) return null;
  const cat = cols[catIdx]!;
  const valIdx = (() => {
    const totals = cols.findIndex((c) => c.total && (c.type === "money" || c.type === "number"));
    return totals >= 0 ? totals : cols.findIndex((c) => c.type === "money" || c.type === "number");
  })();
  const val = valIdx >= 0 ? cols[valIdx]! : null;
  const valueOf = (row: CellValue[]) => (val ? num(row[valIdx]) : 1);

  const isDate = cat.type === "date" || cat.type === "datetime";
  const groups = new Map<string, number>();
  if (isDate) {
    const days = table.rows.map((r) => String(r[catIdx] ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (days.length === 0) return null;
    const spanDays = (Date.parse(days[days.length - 1]!) - Date.parse(days[0]!)) / 86_400_000;
    const byDay = spanDays <= 31;
    for (const r of table.rows) {
      const d = String(r[catIdx] ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const key = byDay ? d : d.slice(0, 7);
      groups.set(key, (groups.get(key) ?? 0) + valueOf(r));
    }
    const bars = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: k.length === 10 ? `${k.slice(8, 10)}.${k.slice(5, 7)}` : `${MONTHS[Number(k.slice(5, 7)) - 1] ?? k.slice(5, 7)} ${k.slice(2, 4)}`, value: v }));
    if (bars.length < 2) return null;
    return { categoryLabel: cat.label, valueLabel: val?.label ?? "Kayıt sayısı", format: val?.type === "money" ? "money" : "number", bars: bars.slice(-12) };
  }

  for (const r of table.rows) {
    const key = String(r[catIdx] ?? "").trim() || "Belirtilmemiş";
    groups.set(key, (groups.get(key) ?? 0) + valueOf(r));
  }
  if (groups.size < 2) return null;
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const bars: ReportChartBar[] = sorted.slice(0, TOP).map(([label, value]) => ({ label: label.slice(0, 24), value }));
  const rest = sorted.slice(TOP).reduce((s, [, v]) => s + v, 0);
  if (sorted.length > TOP) bars.push({ label: "Diğer", value: rest });
  return { categoryLabel: cat.label, valueLabel: val?.label ?? "Kayıt sayısı", format: val?.type === "money" ? "money" : "number", bars };
}
