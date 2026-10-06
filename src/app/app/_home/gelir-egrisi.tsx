import Link from "next/link";
import { Wallet } from "lucide-react";
import { ChartCard } from "@/components/ui/chart-frame";
import { AreaTrendChart } from "@/components/ui/lazy-charts";
import { EmptyState } from "@/components/ui/empty-state";
import { computeTrend } from "@/components/ui/premium";
import { now } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { loadCommissionSummary, type HomeCtx } from "./data";
import { lastSixMonthKeys } from "./helpers";
import { revenueSeries } from "./home-metrics";

/**
 * AYLIK KOMİSYON EĞRİSİ (yönetim, komisyon görme izniyle): son 6 ay tahakkuk (`tenant_commission_aggregates`,
 * kazanç gizliliği `loadCommissionSummary`'de). Büyük değer = 6 ay toplam tahakkuk + tahsil oranı; "bu ay" KPI'da
 * olduğu için burada TEKRARLANMAZ. Eğri yalnız gerçek seri varsa (≥2 ay, sıfırdan farklı) çizilir; tahmin yok.
 */
export async function GelirEgrisi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.canSeeCommissions) return null;
  const c = await loadCommissionSummary(ctx);
  const keys = lastSixMonthKeys(now());
  const series = revenueSeries(keys, c.monthTotals);
  const accrued = c.paid + c.pending;
  const paidPct = accrued > 0 ? Math.round((c.paid / accrued) * 100) : null;
  const first3 = c.monthTotals.slice(0, 3).reduce((s, v) => s + v, 0);
  const last3 = c.monthTotals.slice(3).reduce((s, v) => s + v, 0);
  const trend = computeTrend(last3, first3);
  const trendTone = trend ? (trend.dir === "new" ? "gold" : trend.good === null ? "neutral" : trend.good ? "success" : "danger") : "neutral";

  return (
    <ChartCard
      as="h2"
      title="Komisyon geliri"
      subtitle="Son 6 ay aylık tahakkuk ve tahsilat durumu"
      icon={Wallet}
      tone="gold"
      href="/app/komisyon"
      hrefLabel="Komisyon ayrıntısı"
      height={0}
      className="h-full"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/app/komisyon" className="focus-ring flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)]">
            <span className="ds-num ds-money">{moneyTry(accrued)}</span>
            {trend ? (
              <span className={`ds-pill pm-t-${trendTone}`}>
                <span aria-hidden="true">{trend.label}</span>
                <span className="sr-only">Son üç ay, önceki üç aya göre: {trend.sr}</span>
              </span>
            ) : null}
          </Link>
          <p className="mt-1.5 text-sm tabular-nums text-text-muted">6 ay toplam tahakkuk · son 3 ay önceki 3 aya göre</p>
        </div>
        {paidPct !== null ? (
          <Link href="/app/komisyon?durum=tahsil" className="ds-tile ds-lift focus-ring pm-t-success min-w-40">
            <span className="text-xs text-text-muted">Tahsil edilen</span>
            <span className="ds-num text-lg">
              {moneyTry(c.paid)} <span className="text-sm font-semibold text-text-muted">· %{paidPct}</span>
            </span>
          </Link>
        ) : null}
      </div>
      <div className="mt-4 h-56">
        {series ? (
          <AreaTrendChart
            data={series}
            tone="gold"
            format="money"
            name="Komisyon tahakkuku"
            animationKey={ctx.scopeMine ? "ben" : "ofis"}
            ariaLabel="Son 6 ay aylık komisyon tahakkuku"
          />
        ) : (
          <EmptyState
            variant="compact"
            illustration="rapor"
            title="Gelir eğrisi için veri birikiyor"
            description="Komisyon kaydı oluştukça aylık eğri burada çizilir."
            action={{ href: "/app/komisyon", label: "Komisyonları aç" }}
          />
        )}
      </div>
    </ChartCard>
  );
}
