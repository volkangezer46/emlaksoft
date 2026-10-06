import { estimateLostCommission } from "@/lib/leak-shield";

/**
 * Anomali kartında "tahmini kaçan komisyon": Kayıp-Kaçak Kalkanı ile AYNI hesap (`estimateLostCommission`; oran yoksa
 * `commission.ts` varsayılanı, tek kaynak). Yalnız 'potansiyel kayıp işlem' için gösterilir: ilan onaylı kayıp ve CRM'de
 * kapanış yok. Bu bir TAHMİNdir (işlem doğrulanmadı); hiçbir CRM kaydı değişmez. Taban tutar liste fiyatıdır.
 */
export function anomalyLostCommission(
  type: string,
  input: { listPrice: number | null; commissionRate: number | null; defaultRate?: number },
): { amount: number; rate: number; base: number } | null {
  if (type !== "potential_lost_deal") return null;
  const r = estimateLostCommission({
    reason: "Portaldan kalktı, işlem kaydı yok",
    dealHappened: true,
    closedByUs: false,
    competitorClosed: false,
    dealAmount: null,
    listPrice: input.listPrice,
    commissionRate: input.commissionRate,
    defaultRate: input.defaultRate,
  });
  if (r.estimatedLostCommission <= 0) return null;
  return { amount: r.estimatedLostCommission, rate: r.rate, base: r.baseAmount };
}
