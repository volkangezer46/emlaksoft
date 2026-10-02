/**
 * "Bugün" ana ekranı — saf yardımcılar (DB'ye ve React'e bağımlı değil; vitest kapsamında).
 */
import { DAY_MS, msSince, trDayKey, trParts } from "@/lib/clock";

export type TrendInfo = { label: string; dir: "up" | "down" | "flat" | "new"; good?: boolean };

/**
 * Dönem karşılaştırma rozeti — "%+12" / "%-8" / "%0"; önceki dönem 0 ise
 * oran anlamsız olduğundan "yeni" döner. `invert` kayıp gibi "artışı kötü"
 * metriklerde iyi/kötü rengini çevirir (ok yönü gerçek yönü gösterir).
 */
export function calcTrend(current: number, previous: number, invert = false): TrendInfo {
  if (previous <= 0) {
    return current > 0 ? { label: "yeni", dir: "new" } : { label: "%0", dir: "flat" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { label: "%0", dir: "flat" };
  const up = pct > 0;
  return {
    label: `%${up ? "+" : "-"}${Math.abs(pct)}`,
    dir: up ? "up" : "down",
    good: invert ? !up : up,
  };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Tarihten bu yana tam gün; değer yoksa 999 (hiç teyit/etkinlik yok → en eski sayılır). */
export function daysSince(value: string | null): number {
  if (!value) return 999;
  return Math.floor(msSince(value) / DAY_MS);
}

/** Son `weeks` haftanın haftalık sayaç kovaları (en eski → en yeni). */
export function weekBuckets(dates: string[], nowMs: number, weeks = 7): number[] {
  const buckets = Array.from({ length: weeks }, () => 0);
  const weekMs = 7 * DAY_MS;
  dates.forEach((iso) => {
    const idx = weeks - 1 - Math.floor((nowMs - new Date(iso).getTime()) / weekMs);
    if (idx >= 0 && idx < weeks) buckets[idx] += 1;
  });
  return buckets;
}

/** Günün saatine göre tek selamlama (saat: 0-23, Türkiye saati). */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Günaydın";
  if (hour >= 12 && hour < 18) return "İyi günler";
  if (hour >= 18 && hour < 22) return "İyi akşamlar";
  return "İyi geceler";
}

export const SEVEN_DAY_STALE = 7;

/** Komisyon ödenmiş/tahsil edilmiş mi. */
export function isCollected(status: string | null | undefined): boolean {
  return status === "paid" || status === "collected";
}

export type CommissionRow = { gross_amount: number | string | null; status: string | null; created_at: string | null };

export function commissionTotals(rows: CommissionRow[]) {
  let paid = 0;
  let pending = 0;
  for (const c of rows) {
    const amount = Number(c.gross_amount || 0);
    if (isCollected(c.status)) paid += amount;
    else pending += amount;
  }
  return { paid, pending };
}

/** Son 6 ayın (bu ay dahil) "YYYY-AA" anahtarları, eskiden yeniye. */
export function lastSixMonthKeys(nowMs: number): string[] {
  const keys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    // Türkiye ayına göre; Date.UTC ay taşmasını (31 → kısa ay) kendisi çözer.
    const p = trParts(nowMs);
    const d = new Date(Date.UTC(p.year, p.month - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export function monthTotalsFor(rows: CommissionRow[], keys: string[]): number[] {
  const totals = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const c of rows) {
    const key = c.created_at ? trDayKey(c.created_at).slice(0, 7) : "";
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + Number(c.gross_amount || 0));
  }
  return keys.map((k) => totals.get(k) ?? 0);
}

export function chartGeometry(monthTotals: number[]) {
  const maxMonth = Math.max(1, ...monthTotals);
  const last = Math.max(1, monthTotals.length - 1);
  const pts = monthTotals.map((v, i) => ({ x: (i / last) * 700, y: 200 - (v / maxMonth) * 160 }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return { pts, line, area: `${line} L700 220 L0 220 Z`, last: pts[pts.length - 1] ?? null };
}

export type DemandCounts = { new: number; active: number; matched: number };
export type DealRow = { stage: string; deal_value: number | string | null; assigned_to: string | null; updated_at: string | null };

export function pipelineStats(demand: DemandCounts, deals: DealRow[]) {
  const dealWon = deals.filter((d) => d.stage === "won").length;
  const openDeals = deals.filter((d) => !["won", "lost"].includes(d.stage)).length;
  const demandTotal = demand.new + demand.active + demand.matched;
  const conversion =
    demandTotal > 0 ? Math.round((dealWon / Math.max(1, demandTotal + dealWon)) * 1000) / 10 : 0;
  return { dealWon, openDeals, conversion };
}

/** Atanmış anlaşma değerine göre ilk 5 danışman. */
export function teamLeaders(
  deals: DealRow[],
  profiles: { id: string; full_name: string | null; role: string | null }[],
) {
  const byAdvisor = new Map<string, number>();
  deals.forEach((d) => {
    if (!d.assigned_to) return;
    byAdvisor.set(d.assigned_to, (byAdvisor.get(d.assigned_to) ?? 0) + Number(d.deal_value || 0));
  });
  return [...byAdvisor.entries()]
    .map(([id, value]) => {
      const p = profiles.find((x) => x.id === id);
      return {
        id,
        name: p?.full_name ?? "Danışman",
        role: p?.role ?? "advisor",
        value,
        initials: initials(p?.full_name ?? "ES"),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

export type ListingRow = { id: string; portal_name: string; portal_listing_id: string | null; last_confirmed_at: string | null };

export function overdueListingsOf(rows: ListingRow[]): ListingRow[] {
  return rows.filter((r) => daysSince(r.last_confirmed_at) >= SEVEN_DAY_STALE);
}

export function portalHealth(rows: ListingRow[]) {
  const map = new Map<string, { live: number; overdue: number }>();
  rows.forEach((l) => {
    const cur = map.get(l.portal_name) ?? { live: 0, overdue: 0 };
    cur.live += 1;
    if (daysSince(l.last_confirmed_at) >= SEVEN_DAY_STALE) cur.overdue += 1;
    map.set(l.portal_name, cur);
  });
  const portals = [...map.entries()]
    .map(([name, v]) => ({
      name,
      live: v.live,
      healthy: v.live - v.overdue,
      tone: v.overdue ? "bg-amber-400" : "bg-mint-500",
    }))
    .sort((a, b) => b.live - a.live)
    .slice(0, 5);
  const overdue = overdueListingsOf(rows).length;
  const pct = rows.length === 0 ? 100 : Math.round(((rows.length - overdue) / rows.length) * 100);
  return { portals, pct };
}

export function sumLost(rows: { estimated_lost_commission: number | string | null }[]): number {
  return rows.reduce((sum, row) => sum + Number(row.estimated_lost_commission || 0), 0);
}

/** `tenant_commission_aggregates` dönüşünün ana ekranın kullandığı kısmı. */
export type CommissionAggregate = {
  monthly: { month_start: string; accrued: number | string | null; paid: number | string | null }[];
};

/**
 * Son 6 ay (bu ay dahil) tahakkuk/tahsil özeti — eski 500 satırlık JS toplamıyla
 * aynı anlam: tahsil = paid|collected, bekleyen = diğer tüm durumlar (tahakkuk - tahsil).
 * `monthly` RPC'de her zaman 6 ay (eskiden yeniye) döner; eksikse sıfırla doldurulur.
 */
export function commissionSummaryFromAggregate(agg: CommissionAggregate | null | undefined) {
  const monthly = agg?.monthly ?? [];
  const last6 = monthly.slice(-6);
  const monthTotals = Array.from({ length: 6 }, (_, i) => Number(last6[last6.length - 6 + i]?.accrued ?? 0));
  const paid = last6.reduce((s, m) => s + Number(m.paid ?? 0), 0);
  const accrued = monthTotals.reduce((s, v) => s + v, 0);
  return { paid, pending: accrued - paid, monthTotals };
}
