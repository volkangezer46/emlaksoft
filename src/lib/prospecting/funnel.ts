import { FSBO_LOST_REASONS, FSBO_STATUSES, type FsboLostReason, type FsboStatus } from "./types";

/**
 * "Sahibinden ilan hunisi" toplulaştırması (SAF). Girdi telefonsuz/adsız ham satırlardır; çıktı danışman başına
 * durum adetleri, dönüşüm oranı ve kayıp nedenleridir. Kişisel veri kolonu YOKTUR.
 */
export type FunnelLead = { assigned_to: string | null; status: string; lost_reason: string | null };

export type FunnelRow = {
  /** Danışman kimliği; sahipsiz kayıtlar için "sahipsiz". */
  advisorId: string;
  total: number;
  byStatus: Record<FsboStatus, number>;
  byReason: Record<FsboLostReason, number>;
  /** Portföye dönen / toplam, yüzde (toplam 0 ise null). */
  conversionPct: number | null;
  /** "Yetki alındı veya sonrası" / toplam, yüzde. */
  authorityPct: number | null;
  topReason: FsboLostReason | null;
};

const emptyStatus = (): Record<FsboStatus, number> => Object.fromEntries(FSBO_STATUSES.map((s) => [s, 0])) as Record<FsboStatus, number>;
const emptyReason = (): Record<FsboLostReason, number> => Object.fromEntries(FSBO_LOST_REASONS.map((r) => [r, 0])) as Record<FsboLostReason, number>;
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function buildFunnel(leads: readonly FunnelLead[]): FunnelRow[] {
  const map = new Map<string, FunnelRow>();
  for (const l of leads) {
    const key = l.assigned_to ?? "sahipsiz";
    let row = map.get(key);
    if (!row) {
      row = { advisorId: key, total: 0, byStatus: emptyStatus(), byReason: emptyReason(), conversionPct: null, authorityPct: null, topReason: null };
      map.set(key, row);
    }
    row.total += 1;
    if ((FSBO_STATUSES as readonly string[]).includes(l.status)) row.byStatus[l.status as FsboStatus] += 1;
    if (l.status === "kayip" && l.lost_reason && (FSBO_LOST_REASONS as readonly string[]).includes(l.lost_reason)) row.byReason[l.lost_reason as FsboLostReason] += 1;
  }
  for (const row of map.values()) {
    row.conversionPct = pct(row.byStatus.portfoye_donustu, row.total);
    row.authorityPct = pct(row.byStatus.yetki_alindi + row.byStatus.portfoye_donustu, row.total);
    let best: FsboLostReason | null = null;
    for (const r of FSBO_LOST_REASONS) if (row.byReason[r] > 0 && (best === null || row.byReason[r] > row.byReason[best])) best = r;
    row.topReason = best;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.advisorId.localeCompare(b.advisorId));
}
