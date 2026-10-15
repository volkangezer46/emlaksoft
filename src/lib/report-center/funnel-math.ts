/**
 * Satış hunisi hesapları (SAF). Kaynak: `report_sales_funnel` (20261018080002) — dönemde gelen müşteri KOHORTU:
 * müşteri → randevu (iptal hariç) → teklif (taslak hariç) → kazanılan anlaşma → komisyon.
 * Sıfıra bölme yok: payda 0 ise oran null döner ve ekranda "—" yazılır (sahte %0 yok).
 */

export type FunnelCounts = {
  customers: number;
  appointments: number;
  offers: number;
  won: number;
};

export type FunnelStep = {
  key: keyof FunnelCounts;
  label: string;
  value: number;
  /** Bir önceki basamaktan geçiş oranı (%); ilk basamakta null. */
  stepPct: number | null;
  /** İlk basamağa göre oran (%). */
  overallPct: number | null;
  /** Bir önceki basamakta kalan (düşen) kayıt. */
  dropped: number;
};

export const FUNNEL_STEP_LABELS: Record<keyof FunnelCounts, string> = {
  customers: "Yeni müşteri",
  appointments: "Randevu",
  offers: "Teklif",
  won: "Kazanılan",
};

export function pct(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function funnelSteps(c: FunnelCounts): FunnelStep[] {
  const keys: (keyof FunnelCounts)[] = ["customers", "appointments", "offers", "won"];
  return keys.map((key, i) => {
    const value = Math.max(0, Number(c[key]) || 0);
    const prev = i === 0 ? null : Math.max(0, Number(c[keys[i - 1]]) || 0);
    return {
      key,
      label: FUNNEL_STEP_LABELS[key],
      value,
      stepPct: prev === null ? null : pct(value, prev),
      overallPct: i === 0 ? (value > 0 ? 100 : null) : pct(value, Math.max(0, Number(c.customers) || 0)),
      dropped: prev === null ? 0 : Math.max(0, prev - value),
    };
  });
}

/** En çok kayıp veren geçiş (en düşük basamak oranı); veri yoksa null. */
export function weakestStep(steps: readonly FunnelStep[]): FunnelStep | null {
  let worst: FunnelStep | null = null;
  for (const s of steps) {
    if (s.stepPct === null) continue;
    if (!worst || (worst.stepPct ?? 101) > s.stepPct) worst = s;
  }
  return worst;
}

export type SourceRoi = {
  /** Müşteri başına maliyet (TL); maliyet ya da müşteri yoksa null. */
  costPerCustomer: number | null;
  /** Kazanılan anlaşma başına maliyet (TL). */
  costPerWon: number | null;
  /** Komisyon / maliyet katı (ör. 3.2×); maliyet 0 ya da komisyon görünmüyorsa null. */
  roiMultiple: number | null;
};

export function sourceRoi(input: { customers: number; won: number; cost: number | null; commission: number | null }): SourceRoi {
  const cost = input.cost != null && input.cost > 0 ? input.cost : null;
  return {
    costPerCustomer: cost !== null && input.customers > 0 ? Math.round(cost / input.customers) : null,
    costPerWon: cost !== null && input.won > 0 ? Math.round(cost / input.won) : null,
    roiMultiple: cost !== null && input.commission != null ? Math.round((input.commission / cost) * 10) / 10 : null,
  };
}
