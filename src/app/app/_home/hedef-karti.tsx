import Link from "next/link";
import { Trophy } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { msSince, now } from "@/lib/clock";
import { loadCommissions, loadDeals, loadOfficeTarget, type HomeCtx } from "./data";
import { lastSixMonthKeys, monthTotalsFor } from "./helpers";

/** Aylık ofis hedefi — targets (profile_id null, bu ay); tanımlı hedef yoksa gizli. */
export async function HedefKarti({ ctx }: { ctx: HomeCtx }) {
  const [officeTarget, commissions, deals] = await Promise.all([
    loadOfficeTarget(ctx),
    loadCommissions(ctx),
    loadDeals(),
  ]);

  const targetRevenue = Number(officeTarget?.target_revenue ?? 0);
  const targetDeals = Number(officeTarget?.target_deals ?? 0);
  if (!officeTarget || (targetRevenue <= 0 && targetDeals <= 0)) return null;

  // Gerçekleşen gelir: bu ay oluşan komisyon toplamı; anlaşma: bu ay won'a geçen kartlar
  // (deals.updated_at yaklaşımı — won sonrası güncelleme nadir).
  const monthCommission = monthTotalsFor(commissions, lastSixMonthKeys(now()))[5] ?? 0;
  const wonThisMonth = deals.filter((d) => d.stage === "won" && (d.updated_at ?? "") >= ctx.monthStartIso).length;
  const targetRevenuePct = targetRevenue > 0 ? Math.round((monthCommission / targetRevenue) * 100) : 0;
  const targetDealsPct = targetDeals > 0 ? Math.round((wonThisMonth / targetDeals) * 100) : 0;
  const monthStart = new Date(ctx.monthStartIso);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  const monthElapsedPct = Math.max(
    0,
    Math.min(100, Math.round((msSince(monthStart) / (monthEnd.getTime() - monthStart.getTime())) * 100)),
  );
  // Tempo: /app/hedefler ile aynı 10 puanlık tolerans — geride kalınca amber
  const targetProgress = Math.max(targetRevenuePct, targetDealsPct);
  const targetBehind = monthElapsedPct < 100 && targetProgress < monthElapsedPct - 10;
  const targetExceeded = targetRevenue > 0 && targetRevenuePct >= 100;

  return (
    <Link
      href="/app/hedefler"
      className="surface-card focus-ring group block rounded-[var(--radius-panel)] p-5 transition hover:border-brand-300"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <Trophy className="h-4 w-4" /> Aylık hedef
          <span className="font-medium text-text-faint">· ofis geneli · ayın %{monthElapsedPct}&apos;i geçti</span>
        </p>
        {targetExceeded ? (
          <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">Hedef aşıldı 🎉</span>
        ) : (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
              targetBehind ? "bg-amber-400/15 text-amber-600" : "bg-brand-600/10 text-brand-600"
            }`}
          >
            %{targetRevenue > 0 ? targetRevenuePct : targetDealsPct}
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-[1.6fr_1fr]">
        {targetRevenue > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-text-muted">Komisyon geliri</span>
              <span className="font-semibold tabular-nums text-ink-950">
                {moneyTry(monthCommission)} / {moneyTry(targetRevenue)}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-canvas">
              <div
                className={`h-full rounded-full transition-all ${
                  targetExceeded ? "bg-mint-500" : targetBehind ? "bg-amber-400" : "bg-[image:var(--grad-brand)]"
                }`}
                style={{ width: `${Math.min(100, targetRevenuePct)}%` }}
              />
              {/* Ayın geçen yüzdesi referans çizgisi (bkz. /app/hedefler tempo çubuğu) */}
              <div className="absolute inset-y-0 w-0.5 bg-ink-950/30" style={{ left: `${monthElapsedPct}%` }} />
            </div>
          </div>
        )}
        {targetDeals > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-text-muted">Anlaşma</span>
              <span className="font-semibold tabular-nums text-ink-950">
                {wonThisMonth} / {targetDeals}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-canvas">
              <div
                className={`h-full rounded-full transition-all ${
                  targetDealsPct >= 100 ? "bg-mint-500" : targetBehind ? "bg-amber-400" : "bg-brand-600"
                }`}
                style={{ width: `${Math.min(100, targetDealsPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
