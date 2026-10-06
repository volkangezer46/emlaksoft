import { buildDedupeKey } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { dayMs } from "@/lib/insights/rules/common";

/**
 * Kural: anomaly — haftalık seride ani düşüş/artış (robust z-skor: medyan + MAD).
 *
 * DÜRÜSTLÜK SINIRLARI (kod sözleşmesi, testli):
 *  - Test edilen hafta = son TAMAMLANMIŞ hafta (kısmi hafta kullanılmaz).
 *  - Geçmiş en az MIN_HISTORY_WEEKS tamamlanmış hafta olmalı; altında null (boş vaat yok).
 *  - Geçmiş medyanı en az MIN_MEDIAN_VOLUME olmalı (küçük hacimde gürültü alarm üretmesin).
 *  - |robust z| >= Z_THRESHOLD VE göreli değişim >= MIN_RELATIVE_CHANGE.
 *  - Şiddet DAİMA "bilgi" (ilk sürümde yüksek şiddet yok); tek hafta için kesin hüküm değil, gözlemdir.
 * Olgu: `insight_weekly_series` RPC'si (ofis geneli, TR haftası, boş haftalar 0).
 */

export const ANOMALY_RULE_ID = "anomaly@1";
export const MIN_HISTORY_WEEKS = 8;
export const MIN_MEDIAN_VOLUME = 5;
export const Z_THRESHOLD = 3.5;
export const MIN_RELATIVE_CHANGE = 0.4;

export type AnomalyMetric = "customers" | "demands" | "appointments";

export type WeeklyPoint = { weekStart: string; value: number; isCurrent: boolean };
export type WeeklySeriesFact = { metric: AnomalyMetric; points: readonly WeeklyPoint[] };

const META: Record<AnomalyMetric, { label: string; href: string }> = {
  customers: { label: "Yeni müşteri", href: "/app/musteriler" },
  demands: { label: "Yeni talep", href: "/app/talepler" },
  appointments: { label: "Yeni randevu", href: "/app/randevular" },
};

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Medyan mutlak sapma. */
export function mad(values: readonly number[], med: number = median(values)): number {
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * Robust z-skor. MAD=0 (neredeyse sabit seri) için ölçek en az 1 alınır; böylece sıfır bölme ve
 * "sonsuz z" alarmı oluşmaz.
 */
export function robustZ(value: number, med: number, madValue: number): number {
  const sigma = Math.max(1.4826 * madValue, 1);
  return (value - med) / sigma;
}

export type AnomalyResult = {
  tested: WeeklyPoint;
  med: number;
  z: number;
  change: number;
  historyWeeks: number;
  direction: "dusus" | "artis";
};

/** Saf istatistik: eşik altında/yetersiz veride null. */
export function detectAnomaly(points: readonly WeeklyPoint[]): AnomalyResult | null {
  const complete = points.filter((p) => !p.isCurrent).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  if (complete.length < MIN_HISTORY_WEEKS + 1) return null;
  const tested = complete[complete.length - 1];
  const history = complete.slice(0, -1).map((p) => p.value);
  if (history.length < MIN_HISTORY_WEEKS) return null;
  const med = median(history);
  if (med < MIN_MEDIAN_VOLUME) return null;
  const z = robustZ(tested.value, med, mad(history, med));
  const change = (tested.value - med) / med;
  if (Math.abs(z) < Z_THRESHOLD || Math.abs(change) < MIN_RELATIVE_CHANGE) return null;
  return { tested, med, z, change, historyWeeks: history.length, direction: change < 0 ? "dusus" : "artis" };
}

export function evaluateAnomalies(series: readonly WeeklySeriesFact[], nowMs: number): InsightDraft[] {
  const out: InsightDraft[] = [];
  for (const s of series) {
    const r = detectAnomaly(s.points);
    if (!r) continue;
    const m = META[s.metric];
    const pct = Math.round(Math.abs(r.change) * 100);
    out.push({
      kind: "anomaly",
      ruleId: ANOMALY_RULE_ID,
      severity: "bilgi",
      title: r.direction === "dusus" ? `${m.label} sayısı son haftalara göre düştü` : `${m.label} sayısı son haftalara göre arttı`,
      why:
        `Geçen hafta ${r.tested.value}, önceki ${r.historyWeeks} haftanın medyanı ${Math.round(r.med)} (%${pct} ${r.direction === "dusus" ? "düşük" : "yüksek"}). ` +
        `Tek haftalık sapma kesin sonuç değildir; tatil ve kampanya etkisini göz önünde bulundurun.`,
      evidence: [
        { label: "Geçen hafta", value: String(r.tested.value) },
        { label: "Medyan", value: String(Math.round(r.med)) },
        { label: "Geçmiş", value: `${r.historyWeeks} hafta` },
      ],
      href: m.href,
      entityType: null,
      entityId: null,
      isForecast: false,
      confidence: "dusuk",
      dedupeKey: buildDedupeKey("anomaly", s.metric, r.tested.weekStart),
      validUntilMs: nowMs + dayMs(7),
      audience: { type: "management" },
      urgencyDays: null,
      impact: 2,
    });
  }
  return out;
}
