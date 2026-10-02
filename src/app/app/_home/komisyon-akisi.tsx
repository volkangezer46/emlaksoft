import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { now } from "@/lib/clock";
import { OdometerNumber } from "../odometer-number";
import { Widget } from "../dashboard-widgets";
import { loadCommissions, type HomeCtx } from "./data";
import { chartGeometry, commissionTotals, lastSixMonthKeys, monthTotalsFor } from "./helpers";

export async function KomisyonAkisi({ ctx }: { ctx: HomeCtx }) {
  const commissions = await loadCommissions(ctx);
  const { paid, pending } = commissionTotals(commissions);
  const keys = lastSixMonthKeys(now());
  const monthTotals = monthTotalsFor(commissions, keys);
  const chart = chartGeometry(monthTotals);
  const monthLabels = keys.map((k) => {
    const [y, m] = k.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("tr-TR", { month: "short" });
  });

  return (
    <Widget id="komisyon" className="h-full">
      <section className="dashboard-panel surface-card relative h-full overflow-hidden rounded-[var(--radius-panel)] p-5 md:p-6">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
              <BarChart3 className="h-4 w-4" /> Finansal görünüm
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink-950">Komisyon akışı</h2>
            <p className="mt-1 text-xs text-text-muted">Son 6 ay · gerçek kayıtlar</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/app/komisyon?durum=tahsil"
              className="focus-ring press block rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-right transition hover:bg-mint-500/20"
            >
              <p className="text-xs font-semibold text-mint-600">TAHSİL</p>
              <p className="font-display text-lg font-extrabold text-ink-950">
                <OdometerNumber value={moneyTry(paid)} />
              </p>
            </Link>
            <Link
              href="/app/komisyon?durum=bekleyen"
              className="focus-ring press block rounded-[var(--radius-control)] bg-amber-400/12 px-3 py-2 text-right transition hover:bg-amber-400/25"
            >
              <p className="text-xs font-semibold text-amber-500">BEKLEYEN</p>
              <p className="font-display text-lg font-extrabold text-ink-950">
                <OdometerNumber value={moneyTry(pending)} />
              </p>
            </Link>
          </div>
        </div>
        <div className="relative mt-5">
          {monthTotals.every((v) => v === 0) ? (
            <div className="grid h-56 place-items-center rounded-[var(--radius-card)] border border-dashed border-line-strong text-sm text-text-muted">
              Henüz komisyon serisi yok — ilk anlaşma kapanınca grafik dolacak.
            </div>
          ) : (
            <>
              <svg viewBox="0 0 700 220" className="relative h-56 w-full" preserveAspectRatio="none" role="img" aria-label="Komisyon grafiği">
                <defs>
                  <linearGradient id="appRevenueArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-600)" stopOpacity=".38" />
                    <stop offset="55%" stopColor="var(--brand-500)" stopOpacity=".14" />
                    <stop offset="100%" stopColor="var(--mint-500)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Grid çizgileri — %5 opaklık, veri öne çıkar */}
                {[30, 78, 126, 174].map((y) => (
                  <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="var(--ink-950)" strokeOpacity="0.05" strokeWidth="1" />
                ))}
                <path d={chart.area} fill="url(#appRevenueArea)" />
                <path d={chart.line} fill="none" stroke="var(--brand-600)" strokeWidth="4" strokeLinecap="round" className="dashboard-chart-line" />
                {chart.pts.map((p) => (
                  <circle key={p.x} cx={p.x} cy={p.y} r="4" fill="white" stroke="var(--brand-600)" strokeWidth="2" />
                ))}
                {/* Son değere canlı glow-dot */}
                {chart.last && (
                  <>
                    <circle className="glow-halo" cx={chart.last.x} cy={chart.last.y} r="7" fill="var(--brand-500)" opacity="0.4" />
                    <circle className="glow-dot" cx={chart.last.x} cy={chart.last.y} r="4" fill="var(--brand-600)" stroke="white" strokeWidth="1.5" />
                  </>
                )}
              </svg>
              <div className="grid grid-cols-6 text-center text-xs text-text-faint">
                {monthLabels.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </Widget>
  );
}
