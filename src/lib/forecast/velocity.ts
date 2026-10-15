/**
 * Satış hızı (SAF). Standart formül (Pipedrive / HubSpot "sales velocity"):
 *   hız (₺/gün) = açık anlaşma sayısı × kazanma oranı × ortalama kazanılan anlaşma tutarı ÷ ortalama satış döngüsü (gün)
 * Ekranda 30 güne ölçeklenir ve "tahmin" etiketiyle gösterilir. Girdilerden biri yoksa / sıfırsa null (sahte sayı yok).
 * Kaynak: `deal_stage_velocity` (20261018080000) — kapanış anı `deals.closed_at`, aşama süreleri `deal_stage_events`.
 */

export type VelocityInput = {
  openCount: number;
  won: number;
  lost: number;
  wonValue: number;
  avgCycleDays: number | null;
};

export type VelocityResult = {
  winRate: number | null;
  avgDealValue: number | null;
  perDay: number | null;
  per30Days: number | null;
};

/** Hız hesabı için dönemde en az bu kadar sonuçlanan (kazanılan + kaybedilen) anlaşma gerekir. */
export const MIN_CLOSED_FOR_VELOCITY = 3;

export function salesVelocity(i: VelocityInput): VelocityResult {
  const closed = Math.max(0, i.won) + Math.max(0, i.lost);
  const winRate = closed > 0 ? i.won / closed : null;
  const avgDealValue = i.won > 0 && i.wonValue > 0 ? i.wonValue / i.won : null;
  const cycle = i.avgCycleDays != null && i.avgCycleDays > 0 ? Math.max(1, i.avgCycleDays) : null;
  if (closed < MIN_CLOSED_FOR_VELOCITY || winRate === null || avgDealValue === null || cycle === null || !(i.openCount > 0)) {
    return { winRate, avgDealValue, perDay: null, per30Days: null };
  }
  const perDay = (i.openCount * winRate * avgDealValue) / cycle;
  return { winRate, avgDealValue, perDay, per30Days: Math.round(perDay * 30) };
}

export type StageVelocityRow = {
  stage: string;
  entered: number;
  exited: number;
  advanced: number;
  lost: number;
  avg_days: number | null;
  median_days: number | null;
  open_now: number;
  open_value: number;
  open_avg_age_days: number | null;
  hist_won: number;
  hist_closed: number;
};

/** Aşamadan çıkanların ilerleme oranı (%; ilerleyen / (ilerleyen + kaybedilen)). Veri yoksa null. */
export function stageConversionPct(r: Pick<StageVelocityRow, "advanced" | "lost">): number | null {
  const d = r.advanced + r.lost;
  return d > 0 ? Math.round((r.advanced / d) * 100) : null;
}

/** Bu aşamaya girmiş ve sonuçlanmış anlaşmalarda tarihsel kazanma oranı (aşamaya özel olasılık); az veride null. */
export function stageHistoricalWinRate(r: Pick<StageVelocityRow, "hist_won" | "hist_closed">, minClosed = 10): number | null {
  return r.hist_closed >= minClosed ? r.hist_won / r.hist_closed : null;
}
