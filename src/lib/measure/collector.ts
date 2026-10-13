import { createAdminClient } from "@/lib/supabase/admin";
import { DAY_MS, now, trDayKey } from "@/lib/clock";
import { coverageRate, periodRange, readGrowthFunnel } from "@/lib/growth-analytics/funnel";
import { measureBufferStats } from "./buffer";
import { measureHealth, type HealthReport } from "./health";
import { readMeasureSettingsFresh, type MeasureSettings } from "./settings";

/**
 * Ölçüm toplayıcısı (K1, alan `olcum`) ve sağlık okuyucusu (SUNUCU).
 * K1 tipleri SP1'in `site-issues/types.ts` sözleşmesinin KOPYASIDIR (paketler birbirini import etmez); Kokpit
 * kaydı `src/lib/site-issues/collectors.ts`'tedir (bağdaştırıcı: site-issues/adapters.ts).
 */

/* ---------------------------- K1 sözleşmesi (kopya) ---------------------------- */
export type IssueArea = "seo" | "hiz" | "olcum" | "reklam" | "icerik";
export type IssueSeverity = "kritik" | "uyari" | "bilgi";
export type IssueInput = {
  area: IssueArea;
  url: string;
  code: string;
  severity: IssueSeverity;
  title: string;
  explain: string;
  href: string;
  evidence?: Record<string, unknown>;
  manualOnly?: boolean;
};
export type CollectorResult = { area: IssueArea; scanned: "all" | string[]; issues: IssueInput[] };
export type SiteIssueCollector = { id: string; area: IssueArea; label: string; collect(): Promise<CollectorResult> };
/* ------------------------------------------------------------------------------ */

const TITLES: Record<string, string> = {
  "olcum-tablo-yok": "Ziyaret sayacı kurulmadı",
  "olcum-akis-yok": "Son 24 saatte ziyaret sinyali yok",
  "olcum-sayac-kapali": "Ziyaret sayacı kapalı",
  "olcum-tampon-hata": "Ziyaret sayıları kaydedilemedi",
  "olcum-atif-kapsama": "Kayıt kaynağı kapsamı düşük",
  "olcum-atif-kapali": "Kayıt kaynağı taşıma kapalı",
};

export type MeasureHealthView = HealthReport & { settings: MeasureSettings; coverage: number | null };

/** Son 24 saat akışı: bugün ya da dün (TR) sayaç satırı var mı; bu süreçte son 24 saatte beacon kabul edildiyse de evet. */
async function flowLast24h(nowMs: number): Promise<{ flow: boolean | null; missing: boolean }> {
  const stats = measureBufferStats(nowMs);
  if (stats.lastAcceptedAt && nowMs - stats.lastAcceptedAt < DAY_MS) return { flow: true, missing: false };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("public_pageviews_daily")
      .select("day")
      .gte("day", trDayKey(nowMs - DAY_MS))
      .gt("n", 0)
      .limit(1);
    if (error) return { flow: null, missing: error.code === "42P01" || error.code === "PGRST205" };
    return { flow: (data ?? []).length > 0, missing: false };
  } catch {
    return { flow: null, missing: false };
  }
}

/** Sağlık notu için tüm girdiler paralel okunur (son 28 gün kayıt kapsaması dahil). */
export async function loadMeasureHealth(nowMs: number = now()): Promise<MeasureHealthView> {
  const { cur } = periodRange(28, nowMs);
  const [settings, flow, funnel] = await Promise.all([readMeasureSettingsFresh(), flowLast24h(nowMs), readGrowthFunnel(cur.from, cur.to)]);
  const stats = measureBufferStats(nowMs);
  const data = funnel.ok ? funnel.data : null;
  const report = measureHealth({
    tableMissing: flow.missing || stats.tableMissing || (!funnel.ok && funnel.reason === "missing"),
    pageviewsEnabled: settings.pageviews,
    flowLast24h: flow.flow,
    coverage: data ? { signups: data.totals.signups, attributed: data.totals.attributed } : null,
    attributionEnabled: settings.attribution,
    bufferError: stats.lastError && !stats.tableMissing ? stats.lastError.message : null,
  });
  return { ...report, settings, coverage: coverageRate(data) };
}

export const measureCollector: SiteIssueCollector = {
  id: "olcum",
  area: "olcum",
  label: "Ölçüm sağlığı",
  async collect(): Promise<CollectorResult> {
    const h = await loadMeasureHealth();
    return {
      area: "olcum",
      scanned: "all",
      issues: h.findings.map((f) => ({
        area: "olcum",
        url: "/",
        code: f.code,
        severity: f.severity,
        title: TITLES[f.code] ?? "Ölçüm bulgusu",
        explain: f.text.slice(0, 240),
        href: f.href,
        evidence: { grade: h.grade, score: h.score, coverage: h.coverage },
        manualOnly: true,
      })),
    };
  },
};
