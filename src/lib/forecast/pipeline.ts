/**
 * Pipeline (satış hattı) komisyon tahmini (SAF). Ekranda her zaman "tahmin" etiketiyle gösterilir.
 *
 * YÖNTEM (şeffaf, ekranda da yazılır):
 *  - Kazanma oranı: son 12 ayda KAPANAN (won + lost) anlaşmalarda won / (won + lost), işlem türüne göre (satış/kiralama).
 *    Türde en az MIN_CLOSED kapanış yoksa o türün açık anlaşmaları tahmine GİRMEZ (veri yetersiz). Hiç tür yeterli
 *    değilse tahmin hiç gösterilmez.
 *  - Beklenen komisyon = açık anlaşma tutarı × komisyon oranı (ofis varsayılanı) × kazanma oranı.
 *    Tutarı girilmemiş anlaşma sayılmaz (sayısı ayrıca söylenir).
 *  - Ay dağılımı: kazanılan anlaşmaların medyan kapanış süresi (açılış → son güncelleme) ile beklenen kapanış ayı;
 *    süresi geçmiş açık anlaşmalar bu aya yazılır. En çok 3 ay gösterilir, kalanı "sonrası".
 * Aşama bazlı olasılık KULLANILMAZ: anlaşmaların aşama geçmişi tutulmadığı için aşama başına oran ölçülemez.
 */

export const MIN_CLOSED = 10;
export const LOOKBACK_DAYS = 365;

export type ForecastDeal = {
  dealType: "sale" | "rent" | string;
  stage: string;
  dealValue: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ForecastResult =
  | { ok: false; reason: string; closed: number }
  | {
      ok: true;
      total: number;
      openCount: number;
      valuedCount: number;
      excludedNoValue: number;
      excludedLowData: number;
      winRates: { dealType: string; rate: number; closed: number }[];
      medianCycleDays: number | null;
      months: { key: string; amount: number }[];
      later: number;
      commissionRatePct: number;
    };

const CLOSED = new Set(["won", "lost"]);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function monthKeyOf(ms: number): string {
  return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 7);
}

export function buildPipelineForecast(deals: readonly ForecastDeal[], nowMs: number, commissionRatePct: number): ForecastResult {
  const since = nowMs - LOOKBACK_DAYS * 86_400_000;
  const closedRecent = deals.filter((d) => CLOSED.has(d.stage) && Date.parse(d.updatedAt) >= since);
  const byType = new Map<string, { won: number; closed: number }>();
  for (const d of closedRecent) {
    const t = byType.get(d.dealType) ?? { won: 0, closed: 0 };
    t.closed += 1;
    if (d.stage === "won") t.won += 1;
    byType.set(d.dealType, t);
  }
  const winRates = [...byType.entries()]
    .filter(([, v]) => v.closed >= MIN_CLOSED)
    .map(([dealType, v]) => ({ dealType, rate: v.won / v.closed, closed: v.closed }));
  if (winRates.length === 0) {
    return { ok: false, reason: `Tahmin için son 12 ayda en az ${MIN_CLOSED} kapanmış (kazanılan veya kaybedilen) anlaşma gerekir.`, closed: closedRecent.length };
  }
  const rateOf = new Map(winRates.map((w) => [w.dealType, w.rate]));
  const cycles = deals
    .filter((d) => d.stage === "won" && Date.parse(d.updatedAt) >= since)
    .map((d) => (Date.parse(d.updatedAt) - Date.parse(d.createdAt)) / 86_400_000)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const medianCycleDays = median(cycles);

  const open = deals.filter((d) => !CLOSED.has(d.stage));
  const thisMonth = monthKeyOf(nowMs);
  const monthKeys = [0, 1, 2].map((i) => {
    const d = new Date(Date.parse(`${thisMonth}-01T00:00:00Z`));
    d.setUTCMonth(d.getUTCMonth() + i);
    return d.toISOString().slice(0, 7);
  });
  const months = new Map(monthKeys.map((k) => [k, 0]));
  let total = 0;
  let later = 0;
  let valuedCount = 0;
  let excludedNoValue = 0;
  let excludedLowData = 0;
  for (const d of open) {
    const rate = rateOf.get(d.dealType);
    if (rate === undefined) {
      excludedLowData += 1;
      continue;
    }
    if (d.dealValue == null || !(d.dealValue > 0)) {
      excludedNoValue += 1;
      continue;
    }
    valuedCount += 1;
    const expected = d.dealValue * (commissionRatePct / 100) * rate;
    total += expected;
    const closeMs = medianCycleDays != null ? Math.max(nowMs, Date.parse(d.createdAt) + medianCycleDays * 86_400_000) : nowMs;
    const key = monthKeyOf(closeMs);
    if (months.has(key)) months.set(key, (months.get(key) ?? 0) + expected);
    else later += expected;
  }
  return {
    ok: true,
    total: Math.round(total),
    openCount: open.length,
    valuedCount,
    excludedNoValue,
    excludedLowData,
    winRates,
    medianCycleDays: medianCycleDays != null ? Math.round(medianCycleDays) : null,
    months: monthKeys.map((key) => ({ key, amount: Math.round(months.get(key) ?? 0) })),
    later: Math.round(later),
    commissionRatePct,
  };
}
