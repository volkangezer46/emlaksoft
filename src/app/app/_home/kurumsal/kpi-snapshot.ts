/**
 * Ana ekran KPI anlık görüntüsü — SAF ayrıştırıcılar (DB'ye bağımlı değil; vitest: kpi-snapshot.test.ts, SQL eşdeğerliği
 * home-kpi-snapshot-sql-exec.test.ts). RPC'ler: `home_kpi_snapshot` (KPI satırı) ve `home_sales_windows` (satış
 * performansı), migration 20261027020000. RPC yoksa/hata verirse yükleyiciler eski sorgularına düşer (sahte sıfır yok).
 */
import { AVG_DAYS_EMPTY_NOTE } from "@/lib/trend";
import { deltaOf, salesSeriesWindows, salesWindow, type SalesRange, type SalesRow } from "./core";

/** Bir varlığın KPI sayımları: bu ay (talepte son 30 gün), geçen ayın eş dönemi, haftalık kovalar, toplam. */
export type KpiEntity = { total: number; thisMonth: number; prevMonth: number; weekly: number[]; open?: number };

export type KpiSnapshot = {
  sampleIncluded: boolean;
  customers: KpiEntity;
  deals: KpiEntity & { open: number };
  demands: KpiEntity;
  calls: KpiEntity;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function entity(raw: unknown, weeks: number): KpiEntity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const total = num(r.total);
  const thisMonth = num(r.this_month);
  const prevMonth = num(r.prev_month);
  const weekly = Array.isArray(r.weekly) ? r.weekly.map((x) => num(x)) : null;
  if (total === null || thisMonth === null || prevMonth === null || !weekly || weekly.some((x) => x === null) || weekly.length !== weeks) return null;
  const open = r.open === undefined ? undefined : num(r.open);
  if (open === null) return null;
  return { total, thisMonth, prevMonth, weekly: weekly as number[], ...(open !== undefined ? { open } : {}) };
}

/** RPC çıktısı → KPI görüntüsü; biçim beklenenden farklıysa null (yükleyici eski yola düşer). */
export function parseKpiSnapshot(raw: unknown, weeks: number): KpiSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || typeof r.sample_included !== "boolean") return null;
  const customers = entity(r.customers, weeks);
  const deals = entity(r.deals, weeks);
  const demands = entity(r.demands, weeks);
  const calls = entity(r.calls, weeks);
  if (!customers || !deals || deals.open === undefined || !demands || !calls) return null;
  return { sampleIncluded: r.sample_included, customers, deals: { ...deals, open: deals.open }, demands, calls };
}

/* ------------------------------ Satış pencereleri ------------------------------ */

export type SalesWindowAgg = { sum: number; count: number; durDays: number; durN: number };

/** RPC'ye giden pencere listesi: [cari, önceki, ...seri pencereleri] (epoch ms, [a, b)). */
export function salesRpcWindows(range: SalesRange, nowMs: number): { windows: [number, number][]; labels: string[] } {
  const w = salesWindow(range, nowMs);
  const series = salesSeriesWindows(range, nowMs);
  return { windows: [w.cur, w.prev, ...series.map((s) => s.win)], labels: series.map((s) => s.label) };
}

export function parseSalesWindows(raw: unknown, expected: number): SalesWindowAgg[] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.windows) || r.windows.length !== expected) return null;
  const out: SalesWindowAgg[] = [];
  for (const x of r.windows) {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    const sum = num(o.sum);
    const count = num(o.count);
    const durDays = num(o.dur_days);
    const durN = num(o.dur_n);
    if (sum === null || count === null || durDays === null || durN === null) return null;
    out.push({ sum, count, durDays, durN });
  }
  return out;
}

/** `averageDays` ile aynı kural: ortalama 1 günün altındaysa null, aksi halde yuvarlanır. */
function avgFromAgg(a: SalesWindowAgg): number | null {
  if (a.durN <= 0) return null;
  const avg = a.durDays / a.durN;
  return avg < 1 ? null : Math.round(avg);
}

/** Pencere toplamlarından `salesSummary` + `salesSeries` ile AYNI biçim (parite: kpi-snapshot.test.ts). */
export function salesFromWindowAggs(aggs: readonly SalesWindowAgg[], labels: readonly string[]) {
  const [cur, prev, ...series] = aggs;
  if (!cur || !prev) return null;
  const curAvg = avgFromAgg(cur);
  const prevAvg = avgFromAgg(prev);
  return {
    summary: {
      total: cur.sum,
      totalDelta: deltaOf(cur.sum, prev.sum),
      count: cur.count,
      countDelta: deltaOf(cur.count, prev.count),
      avgDays: curAvg,
      avgNote: curAvg == null ? AVG_DAYS_EMPTY_NOTE : null,
      avgDelta: curAvg != null && prevAvg != null ? deltaOf(curAvg, prevAvg, true) : null,
    },
    series: labels.map((label, i) => ({ label, value: series[i]?.sum ?? 0 })),
  };
}

/** Test referansı: satırlardan pencere toplamı (SQL `home_sales_windows` ile aynı tanım). */
export function aggregateSalesRows(rows: readonly SalesRow[], windows: readonly [number, number][]): SalesWindowAgg[] {
  return windows.map(([a, b]) => {
    const inside = rows.filter((r) => {
      const t = r.closedAt ? Date.parse(r.closedAt) : NaN;
      return Number.isFinite(t) && t >= a && t < b;
    });
    let durDays = 0;
    let durN = 0;
    for (const r of inside) {
      if (!r.createdAt || !r.closedAt) continue;
      const s = Date.parse(r.createdAt);
      const e = Date.parse(r.closedAt);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      durDays += (e - s) / 86_400_000;
      durN += 1;
    }
    return { sum: inside.reduce((t, r) => t + r.value, 0), count: inside.length, durDays, durN };
  });
}
