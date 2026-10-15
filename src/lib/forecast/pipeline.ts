/**
 * Pipeline (satış hattı) komisyon tahmini (SAF). Ekranda her zaman "tahmin" etiketiyle gösterilir.
 *
 * YÖNTEM (şeffaf, ekranda da yazılır):
 *  - Kazanma oranı: son 12 ayda KAPANAN (won + lost) anlaşmalarda won / (won + lost), işlem türüne göre (satış/kiralama).
 *    Türde en az MIN_CLOSED kapanış yoksa o türün açık anlaşmaları tahmine GİRMEZ (veri yetersiz). Hiç tür yeterli
 *    değilse tahmin hiç gösterilmez.
 *  - Beklenen komisyon = açık anlaşma tutarı × komisyon oranı (ofis varsayılanı) × kazanma oranı.
 *    Tutarı girilmemiş anlaşma sayılmaz (sayısı ayrıca söylenir).
 *  - Ay dağılımı: anlaşmada BEKLENEN KAPANIŞ TARİHİ (deals.expected_close_date, SP1) varsa o ay; yoksa kazanılan
 *    anlaşmaların medyan kapanış süresi (açılış → kapanış anı `closed_at`, yoksa son güncelleme) ile tahmin edilen ay.
 *    Tarihi geçmiş açık anlaşmalar bu aya yazılır. En çok 3 ay gösterilir, kalanı "sonrası".
 *  - Aşamaya özel olasılık (SP1): çağıran `stageWinRates` verirse (aşama geçmişinden, aşama başına en az MIN_CLOSED
 *    sonuçlanmış anlaşma; `deal_stage_velocity`), açık anlaşmanın aşamasının oranı tür oranının yerine kullanılır.
 *    Verilmezse ya da aşamada yeterli geçmiş yoksa tür oranı geçerlidir.
 */

export const MIN_CLOSED = 10;
export const LOOKBACK_DAYS = 365;

export type ForecastDeal = {
  dealType: "sale" | "rent" | string;
  stage: string;
  dealValue: number | null;
  createdAt: string;
  updatedAt: string;
  /** Kazanma/kayıp anı (SP1); yoksa updatedAt vekili. */
  closedAt?: string | null;
  /** Beklenen kapanış tarihi (YYYY-AA-GG). */
  expectedCloseDate?: string | null;
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
      /** Aşamaya özel oran kullanılan açık anlaşma sayısı. */
      stageRateCount: number;
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

const closedAtOf = (d: ForecastDeal) => d.closedAt ?? d.updatedAt;

export function buildPipelineForecast(
  deals: readonly ForecastDeal[],
  nowMs: number,
  commissionRatePct: number,
  stageWinRates?: Readonly<Partial<Record<string, number>>>,
): ForecastResult {
  const since = nowMs - LOOKBACK_DAYS * 86_400_000;
  const closedRecent = deals.filter((d) => CLOSED.has(d.stage) && Date.parse(closedAtOf(d)) >= since);
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
    .filter((d) => d.stage === "won" && Date.parse(closedAtOf(d)) >= since)
    .map((d) => (Date.parse(closedAtOf(d)) - Date.parse(d.createdAt)) / 86_400_000)
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
  let stageRateCount = 0;
  for (const d of open) {
    const stageRate = stageWinRates?.[d.stage];
    const useStage = typeof stageRate === "number" && Number.isFinite(stageRate) && stageRate >= 0 && stageRate <= 1;
    const rate = useStage ? stageRate : rateOf.get(d.dealType);
    if (rate === undefined) {
      excludedLowData += 1;
      continue;
    }
    if (d.dealValue == null || !(d.dealValue > 0)) {
      excludedNoValue += 1;
      continue;
    }
    valuedCount += 1;
    if (useStage) stageRateCount += 1;
    const expected = d.dealValue * (commissionRatePct / 100) * rate;
    total += expected;
    const expectedMs = d.expectedCloseDate && /^\d{4}-\d{2}-\d{2}$/.test(d.expectedCloseDate) ? Date.parse(`${d.expectedCloseDate}T12:00:00+03:00`) : NaN;
    const closeMs = Number.isFinite(expectedMs)
      ? Math.max(nowMs, expectedMs)
      : medianCycleDays != null
        ? Math.max(nowMs, Date.parse(d.createdAt) + medianCycleDays * 86_400_000)
        : nowMs;
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
    stageRateCount,
    months: monthKeys.map((key) => ({ key, amount: Math.round(months.get(key) ?? 0) })),
    later: Math.round(later),
    commissionRatePct,
  };
}
