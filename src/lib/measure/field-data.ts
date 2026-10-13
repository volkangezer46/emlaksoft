/**
 * Saha verisi (gerçek kullanıcı hız ölçümü): `analytics_vitals_summary` histogram satırlarının SAF özeti + SUNUCU
 * okuyucusu. p75 ve "iyi" oranı burada histogramdan hesaplanır (vitals.ts); örnek yoksa null (sıfır uydurulmaz).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { METRICS, goodShare, isMetric, percentileFromHistogram, type Metric, type Percentile } from "./vitals";

export type VitalRow = { path_tpl: string; device: "mobile" | "desktop"; metric: Metric; bucket: number; static: boolean; n: number };

export function parseVitalRows(raw: unknown): VitalRow[] {
  if (!Array.isArray(raw)) return [];
  const out: VitalRow[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const n = Number(r.n);
    const bucket = Number(r.bucket);
    if (typeof r.path_tpl !== "string" || !isMetric(r.metric) || (r.device !== "mobile" && r.device !== "desktop")) continue;
    if (!Number.isInteger(bucket) || bucket < 0 || !Number.isFinite(n) || n <= 0) continue;
    out.push({ path_tpl: r.path_tpl, device: r.device, metric: r.metric, bucket, static: r.static === true, n });
  }
  return out;
}

export type MetricSummary = { metric: Metric; p75: Percentile | null; good: number | null };
export type DeviceKey = "mobile" | "desktop" | "all";

function summarize(rows: readonly VitalRow[], metric: Metric): MetricSummary {
  const h = rows.filter((r) => r.metric === metric).map((r) => ({ bucket: r.bucket, n: r.n }));
  return { metric, p75: percentileFromHistogram(metric, h), good: goodShare(metric, h) };
}

export type SiteSummary = Record<DeviceKey, Record<Metric, MetricSummary>>;

export function siteSummary(rows: readonly VitalRow[]): SiteSummary {
  const by = (pred: (r: VitalRow) => boolean) =>
    Object.fromEntries(METRICS.map((m) => [m, summarize(rows.filter(pred), m)])) as Record<Metric, MetricSummary>;
  return { all: by(() => true), mobile: by((r) => r.device === "mobile"), desktop: by((r) => r.device === "desktop") };
}

export type RouteRow = {
  path: string;
  device: "mobile" | "desktop";
  samples: number;
  lcp: MetricSummary;
  inp: MetricSummary;
  cls: MetricSummary;
  /** Statik HTML ve normal Next sayfası ayrı ayrı (LCP p75); örnek yoksa null. */
  lcpStatic: Percentile | null;
  lcpNormal: Percentile | null;
};

/** Rota × cihaz tablosu: örnek sayısına göre sıralı. */
export function routeTable(rows: readonly VitalRow[], limit = 40): RouteRow[] {
  const groups = new Map<string, VitalRow[]>();
  for (const r of rows) {
    const k = `${r.path_tpl}\u0001${r.device}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: RouteRow[] = [];
  for (const [k, g] of groups) {
    const [path, device] = k.split("\u0001") as [string, "mobile" | "desktop"];
    const lcpRows = g.filter((r) => r.metric === "LCP");
    out.push({
      path,
      device,
      samples: lcpRows.reduce((s, r) => s + r.n, 0),
      lcp: summarize(g, "LCP"),
      inp: summarize(g, "INP"),
      cls: summarize(g, "CLS"),
      lcpStatic: percentileFromHistogram("LCP", lcpRows.filter((r) => r.static)),
      lcpNormal: percentileFromHistogram("LCP", lcpRows.filter((r) => !r.static)),
    });
  }
  return out.sort((a, b) => b.samples - a.samples || a.path.localeCompare(b.path)).slice(0, limit);
}

export type VitalsRead = { ok: true; rows: VitalRow[] } | { ok: false; reason: "missing" | "error" };

/** SUNUCU: tek RPC turu (dönem toplamı SQL'de). */
export async function readVitalsSummary(from: string, to: string): Promise<VitalsRead> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("analytics_vitals_summary", { p_from: from, p_to: to });
    if (error) {
      const missing = error.code === "42883" || error.code === "PGRST202" || error.code === "42P01";
      if (!missing) console.error("readVitalsSummary", error.message);
      return { ok: false, reason: missing ? "missing" : "error" };
    }
    return { ok: true, rows: parseVitalRows(data) };
  } catch (e) {
    console.error("readVitalsSummary", e);
    return { ok: false, reason: "error" };
  }
}
