/**
 * Hedef gerçekleşmesi — canlı veriden hesap.
 *
 * `targets.actual_deals` / `actual_revenue` sütunlarını uygulama hiçbir yerde güncellemiyor
 * (yalnız demo seed yazar), bu yüzden gerçek ofiste hep 0 görünürdü. Gerçekleşme artık
 * danışman karnesiyle (`advisor-metrics.ts`) AYNI tanımla hesaplanır:
 *  - anlaşma = kabul edilen teklif (offers.created_by'a göre),
 *  - gelir (kişi hedefi) = DANIŞMANIN KOMİSYON PAYI, tahsil edilmiş (advisor-share.ts),
 *  - ofis geneli hedef (profil yok) = "Ofis komisyonu (brüt)": tahsil edilmiş brüt komisyon toplamı.
 */
import { summarizeAdvisorEarning, isPaid, type ShareOptions, type ShareRow } from "@/lib/team/advisor-share";

export type TargetLike = {
  id: string;
  period: string;
  period_start: string;
  profile_id: string | null;
};

export type AcceptedOffer = { created_by: string | null; created_at: string };
export type ActualCommission = ShareRow & { created_at: string };

const TR_OFFSET_MS = 180 * 60_000;

/** Dönem aralığı [start, end) — Türkiye gece yarısı sınırlarıyla. */
export function targetPeriodRange(periodStart: string, period: string): { start: number; end: number } {
  const start = Date.parse(`${periodStart.slice(0, 10)}T00:00:00+03:00`);
  const months = period === "yearly" ? 12 : period === "quarterly" ? 3 : 1;
  const shifted = new Date(start + TR_OFFSET_MS);
  const end = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + months, shifted.getUTCDate()) - TR_OFFSET_MS;
  return { start, end };
}

export function computeTargetActuals(
  targets: readonly TargetLike[],
  offers: readonly AcceptedOffer[],
  commissions: readonly ActualCommission[],
  /** Profil id -> tam ad (etiket eşleşmesi için; advisor-share kuralı). */
  names: ReadonlyMap<string, string> = new Map(),
  shareOpts: ShareOptions = {},
): Map<string, { deals: number; revenue: number }> {
  const out = new Map<string, { deals: number; revenue: number }>();
  for (const t of targets) {
    const { start, end } = targetPeriodRange(t.period_start, t.period);
    let deals = 0;
    for (const o of offers) {
      const at = Date.parse(o.created_at);
      if (at < start || at >= end) continue;
      if (t.profile_id && o.created_by !== t.profile_id) continue;
      deals += 1;
    }
    const inRange = commissions.filter((c) => {
      const at = Date.parse(c.created_at);
      return at >= start && at < end;
    });
    let revenue = 0;
    if (t.profile_id) {
      revenue = summarizeAdvisorEarning(inRange, names.get(t.profile_id) ?? null, t.profile_id, shareOpts).collected;
    } else {
      for (const c of inRange) if (isPaid(c.status)) revenue += Number(c.gross_amount) || 0;
    }
    out.set(t.id, { deals, revenue });
  }
  return out;
}
