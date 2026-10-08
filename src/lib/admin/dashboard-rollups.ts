/**
 * /admin kontrol paneli — SQL toplulaştırma (`platform_dashboard_rollups` RPC) çıktısının SAF çözümleyicisi.
 * Önceden panel audit/tenant/abonelik/defter satırlarını sayfalı çekip JS'te sayıyordu; sayılar artık SQL'de
 * hesaplanır, burada yalnız tiplenir. İlke: bozuk/eksik ham veri `null` olur, uydurma sıfır üretilmez.
 */
import { trMonthKey } from "@/lib/clock";
import {
  monthShortOfKey,
  type ActivationFunnel,
  type ChurnReason,
  type MonthlyUsage,
  type TrialConversion,
} from "@/lib/admin/platform-metrics";

export type DashboardRollups = {
  /** Ofis başına son 14 gün denetim hareketi. */
  activity: { officeId: string; events: number; lastAt: string }[];
  /** Gün x etkin ofis sayısı (TR günü, eskiden yeniye). */
  activityDays: { day: string; events: number; tenants: number }[];
  funnel: ActivationFunnel | null;
  trial: TrialConversion | null;
  cancelReasons: ChurnReason[];
  ledgerMonths: { unit: string; month: string; total: number }[];
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Biten/dönüşen sayılarından oran; payda 0 ise oran `null` (yüzde uydurulmaz). */
export function trialConversionFromCounts(ended: number, converted: number): TrialConversion {
  return { ended, converted, rate: ended > 0 ? Math.round((converted / ended) * 100) : null };
}

/** Ham RPC JSON'unu güvenli tiplere çevirir. Geçerli bir nesne değilse `null`. */
export function parseDashboardRollups(raw: unknown): DashboardRollups | null {
  const r = obj(raw);
  if (!r) return null;
  const f = obj(r.funnel);
  const t = obj(r.trial);
  return {
    activity: rows(r.activity)
      .filter((a) => typeof a.tenant_id === "string")
      .map((a) => ({ officeId: String(a.tenant_id), events: num(a.events), lastAt: String(a.last_at ?? "") })),
    activityDays: rows(r.activity_days).map((d) => ({ day: String(d.day ?? ""), events: num(d.events), tenants: num(d.tenants) })),
    funnel: f ? { registered: num(f.registered), withProperty: num(f.with_property), withDeal: num(f.with_deal) } : null,
    trial: t ? trialConversionFromCounts(num(t.ended), num(t.converted)) : null,
    cancelReasons: rows(r.cancel_reasons).map((c) => ({ reason: String(c.reason ?? "Neden belirtilmedi"), count: num(c.count) })),
    ledgerMonths: rows(r.ledger_months).map((m) => ({ unit: String(m.unit ?? ""), month: String(m.month ?? ""), total: num(m.total) })),
  };
}

/** SQL'de ay x birim toplamlanmış defter için `monthlyUsage` karşılığı (son `count` TR ayı). */
export function monthlyUsageFromSums(
  sums: readonly { unit: string; month: string; total: number }[],
  units: readonly string[],
  nowMs: number,
  count = 6,
): MonthlyUsage {
  const months = Array.from({ length: count }, (_, i) => {
    const key = trMonthKey(nowMs, i - (count - 1));
    return { key, label: monthShortOfKey(key) };
  });
  const index = new Map(months.map((m, i) => [m.key, i]));
  const byUnit: Record<string, number[]> = Object.fromEntries(units.map((u) => [u, months.map(() => 0)]));
  let total = 0;
  for (const s of sums) {
    const bucket = byUnit[s.unit];
    const i = index.get(s.month);
    if (!bucket || i === undefined || !Number.isFinite(s.total)) continue;
    bucket[i] = Math.round((bucket[i]! + s.total) * 100) / 100;
    total += s.total;
  }
  return { months, byUnit, total: Math.round(total * 100) / 100 };
}
