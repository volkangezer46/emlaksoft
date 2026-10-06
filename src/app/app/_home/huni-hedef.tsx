import Link from "next/link";
import { FunnelChart } from "@/components/ui/viz";
import { Skeleton } from "@/components/ui/skeleton";
import { now } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { loadCommissionSummary, loadDeals, loadDemandCounts, loadMyTarget, loadOfficeTarget, type HomeCtx } from "./data";
import { pipelineStats } from "./helpers";
import { FUNNEL_SEQUENTIAL, funnelRows, monthProgress, targetPace, type TargetPace } from "./home-metrics";

const CARD_MIN = "min-h-[22rem]";

export function HuniHedefIskelet({ className = CARD_MIN }: { className?: string }) {
  return (
    <div role="status" aria-busy="true" className={`pm-c1 ${className} p-4`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-36" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
      <Skeleton className="mt-6 h-3 w-24" />
      <Skeleton className="mt-3 h-3 w-full" />
    </div>
  );
}

const STATE_TEXT: Record<TargetPace["state"], string> = {
  exceeded: "Hedef aşıldı",
  behind: "Tempo geride",
  "on-track": "Tempo yolunda",
};
const STATE_TONE: Record<TargetPace["state"], string> = {
  exceeded: "pm-t-success",
  behind: "pm-t-warn",
  "on-track": "pm-t-brand",
};

/** Hedef çubuğu: dolgu = gerçekleşme (en çok %100 görünür), ince çizgi = ayın ilerlemesine göre beklenen. */
function TargetBar({
  label,
  actualText,
  targetText,
  pace,
  needText,
}: {
  label: string;
  actualText: string;
  targetText: string;
  pace: TargetPace;
  needText: string;
}) {
  const fill = Math.min(100, Math.max(0, pace.pct));
  return (
    <div className={STATE_TONE[pace.state]}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-text-muted">{label}</span>
        <span className="pm-num text-sm">
          {actualText}
          <span className="font-medium text-text-muted"> / {targetText}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} gerçekleşme`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pace.pct)}
        aria-valuetext={`%${pace.pct}${pace.pct > 100 ? " (hedef aşıldı)" : ""}, ayın %${pace.expectedPct}'i geçti`}
        className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      >
        <span className="absolute inset-y-0 left-0 block rounded-full" style={{ width: `${fill}%`, background: "var(--t)" }} />
        <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-[var(--text-muted)] opacity-60" style={{ left: `calc(${pace.expectedPct}% - 1px)` }} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-xs">
        <span className="font-semibold" style={{ color: "var(--t-text)" }}>
          %{pace.pct} · {STATE_TEXT[pace.state]}
        </span>
        <span className="text-text-muted">{needText}</span>
      </p>
    </div>
  );
}

type TargetRow = { target_deals: number | string | null; target_revenue: number | string | null } | null;

/** `revenueActual: null` = komisyonu görme yetkisi yok → gelir çubuğu çizilmez (sahte "geride" yok). */
function targetBars(args: { target: TargetRow; revenueActual: number | null; dealsActual: number; nowMs: number }) {
  const { elapsedPct, daysLeft } = monthProgress(args.nowMs);
  const tRev = Number(args.target?.target_revenue ?? 0);
  const tDeals = Number(args.target?.target_deals ?? 0);
  const rev = args.revenueActual === null ? null : targetPace({ actual: args.revenueActual, target: tRev, elapsedPct, daysLeft });
  const deals = targetPace({ actual: args.dealsActual, target: tDeals, elapsedPct, daysLeft });
  return (
    <div className="flex flex-col gap-4">
      {rev ? (
        <TargetBar
          label="Komisyon geliri"
          actualText={moneyTry(args.revenueActual ?? 0)}
          targetText={moneyTry(tRev)}
          pace={rev}
          needText={rev.state === "exceeded" ? "Gerekli hız yok" : `Gerekli hız ${moneyTry(rev.requiredPerDay)}/gün · ${rev.daysLeft} gün kaldı`}
        />
      ) : null}
      {deals ? (
        <TargetBar
          label="Anlaşma"
          actualText={String(args.dealsActual)}
          targetText={String(tDeals)}
          pace={deals}
          needText={deals.state === "exceeded" ? "Gerekli hız yok" : `${Math.ceil(deals.remaining)} anlaşma kaldı · ${deals.daysLeft} gün`}
        />
      ) : null}
      {!rev && !deals ? (
        <Link href="/app/hedefler" className="focus-ring rounded-[var(--radius-control)] text-sm font-semibold text-[var(--accent-text)]">
          Aylık hedef belirle — ilerleme ve gerekli hız burada görünür
        </Link>
      ) : null}
    </div>
  );
}

/**
 * HUNİ + HEDEF (ofis): FunnelChart ortak ölçekte; dönüşüm oku yalnız aşamalar ardışıksa (şu an bağımsız sayımlar →
 * kapalı, yerine aşama payı). Altında ofis hedefi: çubuk + gerçekleşme + "gerekli hız".
 */
export async function HuniHedef({ ctx }: { ctx: HomeCtx }) {
  const [demand, deals, target, commission] = await Promise.all([
    loadDemandCounts(ctx),
    loadDeals(ctx),
    loadOfficeTarget(ctx),
    loadCommissionSummary(ctx),
  ]);
  const { dealWon } = pipelineStats(demand, deals);
  const wonThisMonth = deals.filter((d) => d.stage === "won" && (d.updated_at ?? "") >= ctx.monthStartIso).length;
  const stages = funnelRows({ newDemand: demand.new, activeDemand: demand.active, matchedDemand: demand.matched, won: dealWon });

  return (
    <section aria-labelledby="huni-baslik" className={`pm-c1 ${CARD_MIN} flex h-full flex-col gap-4 p-4`}>
      <div>
        <h2 id="huni-baslik" className="pm-bx-eyebrow px-1">
          Satış hunisi
        </h2>
        <FunnelChart
          className="mt-1"
          stages={stages.map((s) => ({ label: s.label, value: s.value, href: s.href, sub: s.sub }))}
          ardisik={FUNNEL_SEQUENTIAL}
          ariaLabel="Talep ve anlaşma hunisi"
          emptyText="Henüz talep ya da anlaşma yok"
        />
      </div>
      <div className="border-t border-line pt-4">
        <h2 className="pm-bx-eyebrow mb-2 px-1">Aylık hedef</h2>
        {targetBars({
          target,
          revenueActual: ctx.canSeeCommissions ? (commission.monthTotals[5] ?? 0) : null,
          dealsActual: wonThisMonth,
          nowMs: now(),
        })}
      </div>
    </section>
  );
}

/** KİŞİSEL HEDEF (danışman/takım lideri): yalnız kendi hedefi, kendi komisyonu ve kendi kazanılan anlaşmaları. */
export async function KisiselHedef({ ctx }: { ctx: HomeCtx }) {
  const [target, commission, deals] = await Promise.all([loadMyTarget(ctx), loadCommissionSummary(ctx), loadDeals(ctx)]);
  const mine = deals.filter((d) => d.assigned_to === ctx.userId && d.stage === "won" && (d.updated_at ?? "") >= ctx.monthStartIso).length;
  return (
    <section aria-labelledby="kisisel-hedef-baslik" className="pm-c1 flex h-full min-h-[13rem] flex-col gap-3 p-4">
      <h2 id="kisisel-hedef-baslik" className="pm-bx-eyebrow px-1">
        Kişisel hedefim · bu ay
      </h2>
      {targetBars({ target, revenueActual: ctx.canSeeCommissions ? (commission.monthTotals[5] ?? 0) : null, dealsActual: mine, nowMs: now() })}
    </section>
  );
}
