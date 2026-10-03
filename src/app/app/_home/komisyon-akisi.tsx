import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { now } from "@/lib/clock";
import { BarColumns, EmptyArt, TrendPill, computeTrend } from "@/components/ui/premium";
import { OdometerNumber } from "../odometer-number";
import { Widget } from "../dashboard-widgets";
import { loadCommissionSummary, type HomeCtx } from "./data";
import { lastSixMonthKeys } from "./helpers";

const MONTH_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Kısa para etiketi (sütun üstü): 1,2 Mn / 480 B / 950; tam değer title'da. */
function moneyShort(v: number): string {
  if (v >= 1_000_000) return `₺${(v / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} Mn`;
  if (v >= 1_000) return `₺${Math.round(v / 1_000).toLocaleString("tr-TR")} B`;
  return `₺${Math.round(v).toLocaleString("tr-TR")}`;
}

/**
 * Birincil para bloğu: bekleyen komisyon (altın) + tahsil edilen + son 6 ayın GERÇEK
 * aylık komisyon çubukları (tenant_commission_aggregates). Seri boşsa grafik çizilmez,
 * yerine boş durum çizimi + ipucu gösterilir (sayı uydurulmaz).
 */
export async function KomisyonAkisi({ ctx }: { ctx: HomeCtx }) {
  const { paid, pending, monthTotals } = await loadCommissionSummary(ctx);
  const keys = lastSixMonthKeys(now());
  const monthLabels = keys.map((k) => MONTH_SHORT[Number(k.split("-")[1]) - 1] ?? "");
  const hasData = monthTotals.some((v) => v > 0);
  const thisMonth = monthTotals[5] ?? 0;
  const prevMonth = monthTotals[4] ?? 0;

  return (
    <Widget id="komisyon" className="h-full">
      <section className="pm-bx relative h-full overflow-hidden p-5 md:p-6" aria-labelledby="komisyon-baslik">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <Link
            href="/app/komisyon?durum=bekleyen"
            className="focus-ring group block min-w-0 rounded-[var(--radius-control)]"
            aria-label={`Bekleyen komisyon ${moneyTry(pending)}`}
          >
            <p className="pm-bx-eyebrow flex items-center gap-1">
              <span id="komisyon-baslik">Bekleyen komisyon</span>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--text-faint)] group-hover:text-[var(--accent-text)]" aria-hidden="true" />
            </p>
            <p className="pm-num pm-money mt-1 text-4xl leading-[1.1]">
              <OdometerNumber value={moneyTry(pending)} />
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
              {hasData ? <TrendPill trend={computeTrend(thisMonth, prevMonth)} /> : null}
              <span className="tabular-nums">{hasData ? `Bu ay oluşan ${moneyTry(thisMonth)} · önceki ay ${moneyTry(prevMonth)}` : "Tahsil bekleyen toplam"}</span>
            </p>
          </Link>
          <Link
            href="/app/komisyon?durum=tahsil"
            className="focus-ring block min-w-[10rem] rounded-[var(--pm-r)] border border-[var(--hairline)] bg-[var(--surface-sunken,transparent)] px-4 py-3 text-right hover:border-[var(--hairline-strong)]"
          >
            <p className="pm-bx-eyebrow">Tahsil edilen</p>
            <p className="pm-num mt-1 text-2xl">
              <OdometerNumber value={moneyTry(paid)} />
            </p>
          </Link>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="pm-bx-title">Aylık komisyon</h2>
            <span className="text-xs text-[var(--text-muted)]">Son 6 ay · gerçek kayıtlar</span>
          </div>
          {hasData ? (
            <BarColumns
              values={monthTotals}
              labels={monthLabels}
              format={moneyShort}
              ariaLabel={`Son 6 ay aylık komisyon: ${monthLabels.map((l, i) => `${l} ${moneyTry(monthTotals[i] ?? 0)}`).join(", ")}`}
            />
          ) : (
            <div className="pm-empty rounded-[var(--radius-card)] border border-dashed border-[var(--hairline-strong)]" style={{ minHeight: 190 }}>
              <EmptyArt kind="chart" />
              <p className="font-semibold text-[var(--text)]">Henüz komisyon serisi yok</p>
              <p>İlk komisyon kaydında aylık grafik burada oluşur.</p>
            </div>
          )}
        </div>
      </section>
    </Widget>
  );
}
