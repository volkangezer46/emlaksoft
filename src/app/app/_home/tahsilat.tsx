import { ButtonLink } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { AreaChart } from "@/components/ui/viz";
import { CountUp } from "@/components/ui/count-up";
import { Skeleton } from "@/components/ui/skeleton";
import { now } from "@/lib/clock";
import { loadCommissionSummary, type HomeCtx } from "./data";
import { BRIFING_MIN } from "./brifing";
import { lastSixMonthKeys } from "./helpers";
import { collectionRatePct } from "./home-metrics";

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export function TahsilatIskelet() {
  return (
    <div role="status" aria-busy="true" className={`pm-focus ${BRIFING_MIN} p-5 sm:p-6`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-4 h-10 w-56" />
      <Skeleton className="mt-6 h-32 w-full" />
    </div>
  );
}

/**
 * MUHASEBE ODAĞI — "Tahsilat durumu": bekleyen komisyon (büyük), tahsil oranı çubuğu ve 6 aylık tahakkuk grafiği.
 * Tahsil edilen tutar ve geciken kira sağdaki metrik şeridindedir (aynı sayı iki kez gösterilmez).
 * Satış/müşteri blokları bu rolde çizilmez.
 */
export async function Tahsilat({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.canSeeCommissions) {
    return (
      <section className={`pm-focus pm-t-neutral ${BRIFING_MIN} p-5 sm:p-6`} aria-labelledby="tahsilat-baslik">
        <p className="pm-bx-eyebrow">Tahsilat durumu</p>
        <h2 id="tahsilat-baslik" className="mt-1 font-display text-xl font-bold text-ink-950">
          Komisyon bilgisi bu rol için kapalı
        </h2>
        <p className="mt-2 text-sm text-text-muted">Komisyon görüntüleme yetkisi verildiğinde tahsilat özeti burada görünür.</p>
      </section>
    );
  }
  const c = await loadCommissionSummary(ctx);
  const accrued = c.pending + c.paid;
  const rate = collectionRatePct(c.paid, accrued);
  const keys = lastSixMonthKeys(now());
  const labels = keys.map((k) => MONTHS_SHORT[Number(k.slice(5, 7)) - 1] ?? k);

  return (
    <section aria-labelledby="tahsilat-baslik" className={`pm-focus pm-t-gold ${BRIFING_MIN} flex flex-col gap-4 p-5 pl-6 sm:p-6 sm:pl-7`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="pm-bx-eyebrow">Tahsilat durumu</p>
          <h2 id="tahsilat-baslik" className="mt-1 text-sm font-semibold text-text-muted">
            Bekleyen komisyon
          </h2>
          <p className="pm-num pm-money mt-1 text-4xl leading-none">
            <CountUp value={c.pending} format="money" />
          </p>
          {rate !== null ? (
            <p className="mt-2 text-xs text-text-muted">
              6 aylık tahakkukun <span className="font-semibold tabular-nums text-ink-950">%{rate}</span> kadarı tahsil edildi
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-muted">Son 6 ayda tahakkuk eden komisyon yok.</p>
          )}
        </div>
        <ButtonLink href="/app/komisyon?durum=bekleyen" size="lg" iconRight={ArrowRight}>
          Bekleyenleri aç
        </ButtonLink>
      </div>
      {rate !== null ? (
        <div
          role="progressbar"
          aria-label="Tahsil oranı"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rate}
          className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        >
          <span className="block h-full rounded-full" style={{ width: `${rate}%`, background: "var(--pm-chart-success)" }} />
        </div>
      ) : null}
      <AreaChart
        series={[{ name: "Tahakkuk", values: c.monthTotals, tone: "gold" }]}
        pointLabels={labels}
        format="money"
        height={140}
        ariaLabel="Son 6 ay komisyon tahakkuku"
        href="/app/komisyon"
        hrefLabel="Komisyon defterini aç"
      />
    </section>
  );
}
