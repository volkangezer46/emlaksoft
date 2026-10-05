import Link from "next/link";
import { Trophy } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { TR_OFFSET_MS, msSince, trParts } from "@/lib/clock";
import { EmptyArt, Ring } from "@/components/ui/premium";
import { loadCommissionSummary, loadDeals, loadOfficeTarget, type HomeCtx } from "./data";

/**
 * Aylık ofis hedefi — targets (profile_id null, bu ay). Halka ilerlemesi GERÇEK orandır
 * (gelir hedefi varsa gelir, yoksa anlaşma); tanımsızsa yüzde uydurulmaz, tek eylem
 * satırı gösterilir.
 */
export async function HedefKarti({ ctx }: { ctx: HomeCtx }) {
  const [officeTarget, commissionSummary, deals] = await Promise.all([
    loadOfficeTarget(ctx),
    loadCommissionSummary(ctx),
    loadDeals(ctx),
  ]);

  const targetRevenue = Number(officeTarget?.target_revenue ?? 0);
  const targetDeals = Number(officeTarget?.target_deals ?? 0);
  if (!officeTarget || (targetRevenue <= 0 && targetDeals <= 0)) {
    return (
      <Link href="/app/hedefler" className="pm-bx focus-ring pm-empty block h-full p-5">
        <EmptyArt kind="chart" className="mx-auto" />
        <p className="mt-2 font-semibold text-[var(--text)]">Aylık hedef belirlenmemiş</p>
        <p className="mt-1">Hedef koyunca ilerleme halkası burada görünür.</p>
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-text)]">Aylık hedef belirle</span>
      </Link>
    );
  }

  // Gerçekleşen gelir: bu ay oluşan komisyon toplamı; anlaşma: bu ay won'a geçen kartlar
  // (deals.updated_at yaklaşımı — won sonrası güncelleme nadir).
  const monthCommission = commissionSummary.monthTotals[5] ?? 0;
  const wonThisMonth = deals.filter((d) => d.stage === "won" && (d.updated_at ?? "") >= ctx.monthStartIso).length;
  const targetRevenuePct = targetRevenue > 0 ? Math.round((monthCommission / targetRevenue) * 100) : 0;
  const targetDealsPct = targetDeals > 0 ? Math.round((wonThisMonth / targetDeals) * 100) : 0;
  const monthStart = new Date(ctx.monthStartIso);
  // monthStart TR ay başı (UTC 21:00); sonraki ay başı TR takvimiyle hesaplanır.
  const tp = trParts(monthStart);
  const monthEnd = new Date(Date.UTC(tp.year, tp.month + 1, 1) - TR_OFFSET_MS);
  const monthElapsedPct = Math.max(
    0,
    Math.min(100, Math.round((msSince(monthStart) / (monthEnd.getTime() - monthStart.getTime())) * 100)),
  );
  // Tempo: /app/hedefler ile aynı 10 puanlık tolerans
  const targetProgress = Math.max(targetRevenuePct, targetDealsPct);
  const targetBehind = monthElapsedPct < 100 && targetProgress < monthElapsedPct - 10;
  const targetExceeded = targetRevenue > 0 && targetRevenuePct >= 100;
  const mainPct = targetRevenue > 0 ? targetRevenuePct : targetDealsPct;

  return (
    <Link href="/app/hedefler" className="pm-bx focus-ring group block h-full p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="pm-bx-eyebrow flex items-center gap-1.5">
          <Trophy className="h-4 w-4" aria-hidden="true" /> Aylık hedef
        </p>
        <span className="text-xs text-[var(--text-muted)]">Ayın %{monthElapsedPct}&apos;i geçti</span>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Ring
          pct={mainPct}
          size={104}
          stroke={10}
          tone={targetExceeded ? "success" : "gold"}
          ariaLabel={`Aylık hedef ilerlemesi yüzde ${mainPct}${mainPct > 100 ? " (hedef aşıldı)" : ""}`}
        >
          <span className="pm-num text-xl leading-none">%{mainPct}</span>
        </Ring>
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          {targetRevenue > 0 && (
            <div>
              <p className="text-xs text-[var(--text-muted)]">Komisyon geliri</p>
              <p className="pm-num text-base">
                <span className="pm-money">{moneyTry(monthCommission)}</span>
                <span className="font-medium text-[var(--text-muted)]"> / {moneyTry(targetRevenue)}</span>
              </p>
            </div>
          )}
          {targetDeals > 0 && (
            <div>
              <p className="text-xs text-[var(--text-muted)]">Anlaşma</p>
              <p className="pm-num text-base">
                {wonThisMonth}
                <span className="font-medium text-[var(--text-muted)]"> / {targetDeals}</span>
              </p>
            </div>
          )}
          <p
            className={`text-xs font-semibold ${
              targetExceeded ? "text-[var(--pm-success-text)]" : targetBehind ? "text-[var(--pm-warn-text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {targetExceeded ? "Hedef aşıldı" : targetBehind ? "Tempo geride" : "Tempo yolunda"}
          </p>
        </div>
      </div>
    </Link>
  );
}
