/**
 * "Huni ve kanallar" verisi: `platform_growth_funnel` RPC çıktısının SAF çözümleyicisi + dönem/oran yardımcıları,
 * ve tek SUNUCU okuyucusu. İlke (dashboard-rollups ile aynı): bozuk/eksik ham veri `null` olur, sıfır uydurulmaz;
 * payda 0 ise oran `null`.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { DAY_MS, trDayKey } from "@/lib/clock";
import { CHANNEL_LABEL, isChannel, type Channel } from "@/lib/measure/channel";

export type FunnelChannelKey = Channel | "bilinmiyor";

export type FunnelChannelRow = {
  channel: FunnelChannelKey;
  label: string;
  /** null: dönemde sayaç verisi yok (ölçüm başlamadan önce) ya da kanal ziyaretle ölçülemez (atıfsız kayıt). */
  visits: number | null;
  signups: number;
  activated: number;
  paid: number;
  /** Geçerli örnek yoksa null. */
  medianDaysToPaid: number | null;
  paidSamples: number;
};

export type LandingRow = { path: string; visits: number | null; signups: number; paid: number };

export type GrowthFunnel = {
  from: string;
  to: string;
  hasPageviews: boolean;
  measureStarted: string | null;
  channels: FunnelChannelRow[];
  totals: { signups: number; attributed: number; activated: number; paid: number };
  visitsTotal: number | null;
  landings: LandingRow[];
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as unknown[]).map(obj).filter((r): r is Record<string, unknown> => r !== null) : []);
/** Sayı ya da null (negatif/NaN bozuk sayılır → null). */
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const count = (v: unknown): number => numOrNull(v) ?? 0;
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Ham RPC JSON'unu güvenli tiplere çevirir. Geçerli bir nesne değilse `null`. */
export function parseGrowthFunnel(raw: unknown): GrowthFunnel | null {
  const r = obj(raw);
  if (!r) return null;
  const from = day(r.from);
  const to = day(r.to);
  if (!from || !to) return null;
  const t = obj(r.totals);
  const channels: FunnelChannelRow[] = rows(r.channels)
    .map((c) => {
      const key = c.channel === "bilinmiyor" ? "bilinmiyor" : isChannel(c.channel) ? c.channel : null;
      if (!key) return null;
      return {
        channel: key,
        label: CHANNEL_LABEL[key],
        visits: numOrNull(c.visits),
        signups: count(c.signups),
        activated: count(c.activated),
        paid: count(c.paid),
        medianDaysToPaid: numOrNull(c.median_days_to_paid),
        paidSamples: count(c.paid_samples),
      } satisfies FunnelChannelRow;
    })
    .filter((c): c is FunnelChannelRow => c !== null);
  return {
    from,
    to,
    hasPageviews: r.has_pageviews === true,
    measureStarted: day(r.measure_started),
    channels,
    totals: { signups: count(t?.signups), attributed: count(t?.attributed), activated: count(t?.activated), paid: count(t?.paid) },
    visitsTotal: numOrNull(r.visits_total),
    landings: rows(r.landings)
      .filter((l) => typeof l.path === "string" && l.path.length > 0 && l.path.length <= 120)
      .map((l) => ({ path: String(l.path), visits: numOrNull(l.visits), signups: count(l.signups), paid: count(l.paid) })),
  };
}

/** Oran (0..1); payda 0/null ya da pay null ise null. */
export function rate(num: number | null, den: number | null): number | null {
  if (num === null || den === null || !(den > 0)) return null;
  return num / den;
}

/** Yüzde metni ("%12,5"); null → "—". */
export function pctText(r: number | null): string {
  if (r === null) return "—";
  return `%${(r * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
}

export const PERIODS = [7, 28, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

export function parsePeriod(raw: string | undefined): PeriodDays {
  const n = Number(raw);
  return (PERIODS as readonly number[]).includes(n) ? (n as PeriodDays) : 28;
}

/** Bugün dahil son `days` TR günü ve hemen önceki eşit uzunluktaki dönem. */
export function periodRange(days: number, nowMs: number): { cur: { from: string; to: string }; prev: { from: string; to: string } } {
  const to = trDayKey(nowMs);
  const from = trDayKey(nowMs - (days - 1) * DAY_MS);
  const prevTo = trDayKey(nowMs - days * DAY_MS);
  const prevFrom = trDayKey(nowMs - (2 * days - 1) * DAY_MS);
  return { cur: { from, to }, prev: { from: prevFrom, to: prevTo } };
}

/** Önceki döneme göre fark; önceki yoksa/0'sa ve şimdiki de yoksa null. */
export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  return cur - prev;
}

/** Atıf kapsama oranı: kaynağı bilinen kayıt / kayıt (payda 0 → null). */
export function coverageRate(f: GrowthFunnel | null): number | null {
  return f ? rate(f.totals.attributed, f.totals.signups) : null;
}

export type FunnelRead = { ok: true; data: GrowthFunnel } | { ok: false; reason: "missing" | "error" };

/** SUNUCU: tek RPC turu. Fonksiyon yoksa (migration bekliyor) `missing`. */
export async function readGrowthFunnel(from: string, to: string): Promise<FunnelRead> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("platform_growth_funnel", { p_from: from, p_to: to });
    if (error) {
      const missing = error.code === "42883" || error.code === "PGRST202" || error.code === "42P01";
      if (!missing) console.error("readGrowthFunnel", error.message);
      return { ok: false, reason: missing ? "missing" : "error" };
    }
    const parsed = parseGrowthFunnel(data);
    return parsed ? { ok: true, data: parsed } : { ok: false, reason: "error" };
  } catch (e) {
    console.error("readGrowthFunnel", e);
    return { ok: false, reason: "error" };
  }
}
