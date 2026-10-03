import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AreaChart, EmptyArt, TrendPill, bucketCountFor, bucketDates, computeTrend, type AreaSeries } from "@/components/ui/premium";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { Widget } from "../dashboard-widgets";
import { loadPeriodStats, type HomeCtx } from "./data";

/**
 * Seçili dönemde (7/30/90) yeni müşteri + yeni talep alan grafiği. Seriler
 * `loadPeriodStats` içindeki GERÇEK kayıt tarihlerinden kovalanır; satır sınırına
 * çarpan (kırpık) seri `null` gelir ve hiç çizilmez. Her başlık sayısı filtreli
 * listeye gider. Hiç seri yoksa boş durum çizimi gösterilir.
 */
export async function DonemTrend({ ctx }: { ctx: HomeCtx }) {
  const stats = await loadPeriodStats(ctx);
  const nowMs = now();
  const buckets = bucketCountFor(ctx.period);
  const from = trDayKey(daysAgoIso(ctx.period));
  const to = trDayKey(nowMs);

  const series: AreaSeries[] = [];
  if (stats.customerDates) series.push({ name: "Yeni müşteri", values: bucketDates(stats.customerDates, nowMs, ctx.period, buckets), tone: "brand" });
  if (stats.demandDates) series.push({ name: "Yeni talep", values: bucketDates(stats.demandDates, nowMs, ctx.period, buckets), tone: "success" });

  return (
    <Widget id="donem-trend" className="h-full">
      <section className="pm-bx h-full p-5 md:p-6" aria-labelledby="donem-trend-baslik">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div>
            <p className="pm-bx-eyebrow">Son {ctx.period} gün</p>
            <h2 id="donem-trend-baslik" className="pm-bx-title mt-0.5 text-lg">
              Yeni müşteri ve talep akışı
            </h2>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href={`/app/musteriler?from=${from}&to=${to}`} className="focus-ring group rounded-[var(--radius-control)]">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" /> Yeni müşteri
                <ChevronRight className="h-3 w-3 text-[var(--text-faint)] group-hover:text-[var(--accent-text)]" aria-hidden="true" />
              </p>
              <p className="mt-0.5 flex items-center gap-2">
                <span className="pm-num text-2xl">{stats.customers}</span>
                <TrendPill trend={computeTrend(stats.customers, stats.customersPrev)} />
              </p>
            </Link>
            <Link href="/app/talepler" className="focus-ring group rounded-[var(--radius-control)]">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                <span className="h-2 w-2 rounded-full bg-[var(--pm-chart-success)]" aria-hidden="true" /> Yeni talep
                <ChevronRight className="h-3 w-3 text-[var(--text-faint)] group-hover:text-[var(--accent-text)]" aria-hidden="true" />
              </p>
              <p className="mt-0.5 flex items-center gap-2">
                <span className="pm-num text-2xl">{stats.demands}</span>
                <TrendPill trend={computeTrend(stats.demands, stats.demandsPrev)} />
              </p>
            </Link>
          </div>
        </div>
        <div className="mt-5">
          {series.length > 0 && (stats.customers > 0 || stats.demands > 0) ? (
            <AreaChart
              series={series}
              labels={[`${ctx.period} gün önce`, "Bugün"]}
              unit="dilim"
              ariaLabel={`Son ${ctx.period} gün: ${stats.customers} yeni müşteri, ${stats.demands} yeni talep`}
            />
          ) : (
            <div className="pm-empty rounded-[var(--radius-card)] border border-dashed border-[var(--hairline-strong)]" style={{ minHeight: 200 }}>
              <EmptyArt kind="chart" />
              <p className="font-semibold text-[var(--text)]">Bu dönemde yeni kayıt yok</p>
              <p>Müşteri ve talep geldikçe akış grafiği burada çizilir.</p>
            </div>
          )}
        </div>
      </section>
    </Widget>
  );
}
