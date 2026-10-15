/**
 * Destek BI hesapları (SAF): ilk yanıt ve çözüm süresi medyanı/p90'ı, SLA uyum oranı (+ haftalık trend),
 * temsilci bazlı hacim, CSAT trendi, kategori ve etiket kırılımı. Girdi: dönem içinde AÇILAN biletler.
 * Süreler takvim saatidir (hedefler iş saatine göre DB'de tutulur; uyum, kalıcı hedefe göre ölçülür).
 */

export type DeskTicketRow = {
  id: string;
  created_at: string;
  status: string;
  category: string;
  priority: string;
  assigned_staff_id: string | null;
  tags?: string[] | null;
  first_response_at: string | null;
  first_response_due_at: string | null;
  first_response_breached_at: string | null;
  resolved_at: string | null;
  resolution_due_at: string | null;
  resolution_breached_at: string | null;
};

export type DeskCsatRow = { score: number; created_at: string };

export type DurationStats = { count: number; medianHours: number | null; p90Hours: number | null };
export type ComplianceStats = { measured: number; met: number; rate: number | null };
export type WeekBucket = { weekStart: string; tickets: number; compliance: number | null; csatAverage: number | null; csatCount: number };
export type BreakdownRow = { key: string; count: number; open: number };

export type DeskReport = {
  total: number;
  open: number;
  firstResponse: DurationStats;
  resolution: DurationStats;
  firstResponseSla: ComplianceStats;
  resolutionSla: ComplianceStats;
  /** İlk yanıt + çözüm hedeflerinin birlikte ölçülen uyumu (rapor kartındaki tek oran). */
  overallSla: ComplianceStats;
  csat: { count: number; average: number | null };
  weeks: WeekBucket[];
  byAgent: BreakdownRow[];
  byCategory: BreakdownRow[];
  byTag: BreakdownRow[];
};

const HOUR = 3_600_000;
const OPEN = new Set(["open", "in_progress", "waiting"]);

/** Doğrusal ara değerli yüzdelik (0-1). Boş = null. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

function durationStats(hours: number[]): DurationStats {
  const round = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  return { count: hours.length, medianHours: round(percentile(hours, 0.5)), p90Hours: round(percentile(hours, 0.9)) };
}

function compliance(measured: number, met: number): ComplianceStats {
  return { measured, met, rate: measured > 0 ? Math.round((met / measured) * 1000) / 10 : null };
}

/** Pazartesi başlangıçlı hafta anahtarı (UTC+3 yerel gün). */
export function weekStartOf(iso: string): string {
  const local = Date.parse(iso) + 3 * HOUR;
  const d = new Date(local);
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - (day - 1) * 24 * HOUR;
  return new Date(monday).toISOString().slice(0, 10);
}

/**
 * Hedefe göre ölçüm: ilk yanıt verildiyse (ya da hedef geçtiyse) ölçülür. `nowMs` dışarıdan verilir (saf).
 * Hedef yoksa (eski kayıt) ölçüme girmez.
 */
function firstResponseOutcome(row: DeskTicketRow, nowMs: number): "met" | "missed" | null {
  const due = ms(row.first_response_due_at);
  if (due == null) return null;
  const at = ms(row.first_response_at);
  if (row.first_response_breached_at) return "missed";
  if (at != null) return at <= due ? "met" : "missed";
  return nowMs > due ? "missed" : null;
}

function resolutionOutcome(row: DeskTicketRow, nowMs: number): "met" | "missed" | null {
  const due = ms(row.resolution_due_at);
  if (due == null) return null;
  const at = ms(row.resolved_at);
  if (row.resolution_breached_at) return "missed";
  if (at != null) return at <= due ? "met" : "missed";
  return nowMs > due ? "missed" : null;
}

function breakdown(rows: readonly DeskTicketRow[], keysOf: (row: DeskTicketRow) => string[]): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const row of rows) {
    for (const key of keysOf(row)) {
      const entry = map.get(key) ?? { key, count: 0, open: 0 };
      entry.count += 1;
      if (OPEN.has(row.status)) entry.open += 1;
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "tr-TR"));
}

export function computeDeskReport(rows: readonly DeskTicketRow[], csat: readonly DeskCsatRow[], nowMs: number): DeskReport {
  const firstHours: number[] = [];
  const resolutionHours: number[] = [];
  let frMeasured = 0;
  let frMet = 0;
  let rsMeasured = 0;
  let rsMet = 0;
  const weeks = new Map<string, { tickets: number; measured: number; met: number; csatSum: number; csatCount: number }>();
  const week = (key: string) => {
    const w = weeks.get(key) ?? { tickets: 0, measured: 0, met: 0, csatSum: 0, csatCount: 0 };
    weeks.set(key, w);
    return w;
  };

  for (const row of rows) {
    const created = ms(row.created_at);
    if (created == null) continue;
    const fr = ms(row.first_response_at);
    if (fr != null && fr >= created) firstHours.push((fr - created) / HOUR);
    const rs = ms(row.resolved_at);
    if (rs != null && rs >= created) resolutionHours.push((rs - created) / HOUR);

    const w = week(weekStartOf(row.created_at));
    w.tickets += 1;
    const frOutcome = firstResponseOutcome(row, nowMs);
    if (frOutcome) {
      frMeasured += 1;
      w.measured += 1;
      if (frOutcome === "met") {
        frMet += 1;
        w.met += 1;
      }
    }
    const rsOutcome = resolutionOutcome(row, nowMs);
    if (rsOutcome) {
      rsMeasured += 1;
      w.measured += 1;
      if (rsOutcome === "met") {
        rsMet += 1;
        w.met += 1;
      }
    }
  }

  let csatSum = 0;
  for (const c of csat) {
    if (!Number.isFinite(c.score)) continue;
    csatSum += c.score;
    const w = week(weekStartOf(c.created_at));
    w.csatSum += c.score;
    w.csatCount += 1;
  }

  const weekRows: WeekBucket[] = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => ({
      weekStart,
      tickets: w.tickets,
      compliance: w.measured ? Math.round((w.met / w.measured) * 1000) / 10 : null,
      csatAverage: w.csatCount ? Math.round((w.csatSum / w.csatCount) * 100) / 100 : null,
      csatCount: w.csatCount,
    }));

  return {
    total: rows.length,
    open: rows.filter((r) => OPEN.has(r.status)).length,
    firstResponse: durationStats(firstHours),
    resolution: durationStats(resolutionHours),
    firstResponseSla: compliance(frMeasured, frMet),
    resolutionSla: compliance(rsMeasured, rsMet),
    overallSla: compliance(frMeasured + rsMeasured, frMet + rsMet),
    csat: { count: csat.length, average: csat.length ? Math.round((csatSum / csat.length) * 100) / 100 : null },
    weeks: weekRows,
    byAgent: breakdown(rows, (r) => [r.assigned_staff_id ?? "atanmadi"]),
    byCategory: breakdown(rows, (r) => [r.category]),
    byTag: breakdown(rows, (r) => (r.tags ?? []).filter(Boolean)),
  };
}

export function formatDurationHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} dk`;
  if (hours < 48) return `${hours.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sa`;
  return `${(hours / 24).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün`;
}

// ---- PA-7: makaleyle çözülen (açılmayan) talepler ------------------------------------------

export type DeflectionRow = { kind: string; slug: string };
export type DeflectionStats = {
  count: number;
  /** Makaleyle çözülen / (çözülen + açılan talep); talep ve çözülen yoksa null. */
  rate: number | null;
  top: { kind: string; slug: string; count: number }[];
};

/** Dönemde "Bu sorunumu çözdü" kayıtları: sayı, saptırma oranı ve en çok çözen 3 makale. */
export function deflectionStats(rows: readonly DeflectionRow[], ticketsOpened: number): DeflectionStats {
  const byArticle = new Map<string, { kind: string; slug: string; count: number }>();
  for (const r of rows) {
    const key = `${r.kind}:${r.slug}`;
    const cur = byArticle.get(key) ?? { kind: r.kind, slug: r.slug, count: 0 };
    cur.count++;
    byArticle.set(key, cur);
  }
  const denom = rows.length + Math.max(0, ticketsOpened);
  return {
    count: rows.length,
    rate: denom > 0 ? Math.round((rows.length / denom) * 1000) / 10 : null,
    top: [...byArticle.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug)).slice(0, 3),
  };
}
