/**
 * Canlı hız bütçesi ve "sakin sunucu" tanımı (SK1/B179-B181). Saf modül: scripts/perf/measure-live.mts (yayın sonrası
 * bekçi) ve sözleşme testleri (src/lib/perf-budget-contract.test.ts, scripts/perf/live-budget.test.ts) içe aktarır.
 * Değerler saha konseyi kararındaki hedef bütçelerle (decisions[0]) ve SK1 kabul ölçütleriyle aynıdır:
 *   - oturumlu TTFB p50 (sakin sunucu, 20 örnek): /app ≤60 ms, /admin ≤70 ms;
 *   - başka ekrandaki değişikliğin commit'ten olaya gelişi: tek değişiklikte p95 <1 sn (20 örnek);
 *   - "sakin sunucu" = load1 <4 ve yayın kapısı (fast.sh / vitest) koşmuyor;
 *   - p95 en az 20, medyan en az 5 örnekle hesaplanır.
 * Bekçi (scripts/sunucu/deploy.sh) art arda 3 yeşil koşuya kadar yalnız uyarır; sonra kırmızıda önceki sürüme döner.
 */

export const LIVE_BUDGETS = {
  /** Oturumlu sayfa TTFB medyanı (ms). */
  ttfbP50Ms: { "/app": 60, "/admin": 70 } as Readonly<Record<string, number>>,
  ttfbSamples: 20,
  /** Tam açılış DOMContentLoaded medyanı (ms; masaüstü, ağ kısıtsız, tarayıcı Playwright Chromium). */
  dclP50Ms: 1000,
  dclSamples: 5,
  /** Realtime: tek değişiklikte INSERT isteğinin başından abone soketteki olaya kadar p95 (ms). */
  realtimeP95Ms: 1000,
  realtimeSamples: 20,
  /** Tek olay için en çok bekleme (ms); gelmeyen olay bütçe aşımı sayılır. */
  realtimeEventTimeoutMs: 5000,
  quietLoad1: 4,
  minSamplesForMedian: 5,
  minSamplesForP95: 20,
  consecutiveGreensBeforeRollback: 3,
} as const;

/** En yakın sıra yöntemi (nearest-rank). Boş dizide null. Sonsuz değerler (gelmeyen olay) sıralamada en sona düşer. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

export const median = (values: readonly number[]) => percentile(values, 50);

export type QuietInput = { load1: number | null; gateRunning: boolean };

/** Sakin değilse nedeni; sakinse null. load1 okunamıyorsa (Linux değil) yalnız kapı koşusu belirleyicidir. */
export function quietServerReason(input: QuietInput): string | null {
  if (input.gateRunning) return "yayın kapısı (fast.sh / vitest) koşuyor";
  if (input.load1 !== null && input.load1 >= LIVE_BUDGETS.quietLoad1) {
    return `load1 ${input.load1.toFixed(2)} ≥ ${LIVE_BUDGETS.quietLoad1}`;
  }
  return null;
}

export type LiveMeasurement =
  | { kind: "ttfb"; path: string; values: number[] }
  | { kind: "dcl"; path: string; values: number[] }
  | { kind: "realtime"; values: number[] };

export type BudgetReport = { ok: boolean; lines: string[]; violations: string[] };

const fmt = (v: number | null) => (v === null ? "—" : Number.isFinite(v) ? `${Math.round(v)} ms` : "olay gelmedi");

/**
 * Ölçümleri bütçeyle karşılaştırır. Bütçesi olmayan yol yalnız raporlanır. Yetersiz örnek bütçe aşımı DEĞİLDİR
 * (ölçülemedi), ama satırda yazılır.
 */
export function evaluateBudgets(measurements: readonly LiveMeasurement[]): BudgetReport {
  const lines: string[] = [];
  const violations: string[] = [];
  for (const m of measurements) {
    if (m.kind === "ttfb" || m.kind === "dcl") {
      const p50 = median(m.values);
      const budget = m.kind === "ttfb" ? LIVE_BUDGETS.ttfbP50Ms[m.path] : LIVE_BUDGETS.dclP50Ms;
      const label = `${m.kind.toUpperCase()} ${m.path} p50 ${fmt(p50)} (${m.values.length} örnek)`;
      if (budget === undefined) {
        lines.push(`${label} — bütçe yok`);
      } else if (m.values.length < LIVE_BUDGETS.minSamplesForMedian || p50 === null) {
        lines.push(`${label} — yetersiz örnek (en az ${LIVE_BUDGETS.minSamplesForMedian}); ölçülemedi`);
      } else if (p50 > budget) {
        lines.push(`${label} > ${budget} ms — AŞIM`);
        violations.push(`${m.kind} ${m.path}: p50 ${Math.round(p50)} ms > ${budget} ms`);
      } else {
        lines.push(`${label} ≤ ${budget} ms`);
      }
      continue;
    }
    const p95 = percentile(m.values, 95);
    const p50 = median(m.values);
    const label = `REALTIME commit→olay p50 ${fmt(p50)} p95 ${fmt(p95)} (${m.values.length} örnek)`;
    if (m.values.length < LIVE_BUDGETS.minSamplesForP95 || p95 === null) {
      lines.push(`${label} — yetersiz örnek (en az ${LIVE_BUDGETS.minSamplesForP95}); ölçülemedi`);
    } else if (p95 >= LIVE_BUDGETS.realtimeP95Ms) {
      lines.push(`${label} ≥ ${LIVE_BUDGETS.realtimeP95Ms} ms — AŞIM`);
      violations.push(`realtime: p95 ${fmt(p95)} ≥ ${LIVE_BUDGETS.realtimeP95Ms} ms`);
    } else {
      lines.push(`${label} < ${LIVE_BUDGETS.realtimeP95Ms} ms`);
    }
  }
  return { ok: violations.length === 0, lines, violations };
}

export type WatchdogAction = "ok" | "warn" | "rollback";

/**
 * Bekçi kararı: yeşilde seri bir artar; kırmızıda seri sıfırlanır ve seri eşiğe (3) ulaşmışsa geri dönülür,
 * ulaşmamışsa yalnız uyarılır. scripts/sunucu/deploy.sh aynı kuralı uygular (WATCHDOG_GREENS).
 */
export function watchdogDecision(streak: number, green: boolean): { nextStreak: number; action: WatchdogAction } {
  if (green) return { nextStreak: streak + 1, action: "ok" };
  return { nextStreak: 0, action: streak >= LIVE_BUDGETS.consecutiveGreensBeforeRollback ? "rollback" : "warn" };
}
