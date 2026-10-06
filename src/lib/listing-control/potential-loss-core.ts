import { anomalyLostCommission } from "@/lib/listing-control/lost-commission";

/**
 * Potansiyel kayıp (SAF). Tek kaynak listing_anomalies; tutar kuralı:
 *  - `closure_loss`: kapanış formundaki tahmini kaçan komisyon (`details.estimated_lost_commission`, formda hesaplanmış).
 *  - `potential_lost_deal`: liste fiyatı × komisyon oranı (`anomalyLostCommission`, Kayıp-Kaçak hesabıyla AYNI). TAHMİN.
 */
export const POTENTIAL_LOSS_TYPES = ["closure_loss", "potential_lost_deal"] as const;

export type PotentialLossRow = { id: string; type: string; at: string; propertyId: string; amount: number };

export function potentialLossAmount(
  type: string,
  details: Record<string, unknown> | null | undefined,
  input: { listPrice: number | null; commissionRate: number | null; defaultRate?: number },
): number {
  if (type === "closure_loss") {
    const v = Number(details?.estimated_lost_commission ?? 0);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }
  const r = anomalyLostCommission(type, {
    listPrice: input.listPrice != null ? Number(input.listPrice) : null,
    commissionRate: input.commissionRate != null ? Number(input.commissionRate) : null,
    defaultRate: input.defaultRate,
  });
  return r ? r.amount : 0;
}

/** Ay başından itibaren / tümü toplamları ve 8 haftalık kova (en eski → en yeni). */
export function summarizeLosses(rows: readonly PotentialLossRow[], nowMs: number, monthStartMs: number) {
  const weekMs = 7 * 86_400_000;
  const weeks = Array.from({ length: 8 }, () => 0);
  let month = 0;
  let all = 0;
  let closure = 0;
  let portal = 0;
  for (const r of rows) {
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) continue;
    all += r.amount;
    if (t >= monthStartMs) month += r.amount;
    if (r.type === "closure_loss") closure += 1;
    else portal += 1;
    const idx = 7 - Math.floor((nowMs - t) / weekMs);
    if (idx >= 0 && idx < 8) weeks[idx] += r.amount;
  }
  return { month, all, weeks, closureCount: closure, portalCount: portal };
}
