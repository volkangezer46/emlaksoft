import Link from "next/link";
import { ArrowUpRight, PhoneIncoming, TrendingUp } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { now } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { OdometerNumber } from "../odometer-number";
import { loadClosures, loadCommissionSummary, loadCommissionWeekDates, loadKpiCounts, loadLiveListings, type HomeCtx } from "./data";
import {
  calcTrend,
  overdueListingsOf,
  sumLost,
  weekBuckets,
  type TrendInfo,
} from "./helpers";
import { Sparkline, TrendBadge, toneBg, toneText } from "./ortak";

type Kpi = {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string;
  trendData?: TrendInfo;
  tone?: "danger" | "warn" | "amber" | "mint" | "brand";
  spark: number[];
  href: string;
};

const valueTone: Record<string, string> = {
  danger: "text-danger-500",
  warn: "text-warn-500",
  amber: "text-amber-500",
};
const sparkColor: Record<string, string> = {
  danger: "var(--danger-500)",
  warn: "var(--warn-500)",
  amber: "var(--amber-500)",
  mint: "var(--mint-500)",
  brand: "var(--brand-600)",
};

export async function KpiSatiri({ ctx }: { ctx: HomeCtx }) {
  const [counts, listings, commissionSummary, commissionDates, closures] = await Promise.all([
    loadKpiCounts(ctx),
    loadLiveListings(),
    loadCommissionSummary(ctx),
    loadCommissionWeekDates(),
    loadClosures(ctx),
  ]);
  const nowMs = now();
  const overdueCount = overdueListingsOf(listings).length;
  const { pending: pendingCommission, monthTotals } = commissionSummary;
  const lostMonth = sumLost(closures.thisMonth);
  const lostPrevMonth = sumLost(closures.prevMonth);

  const kpis: Kpi[] = [
    {
      label: "Toplam müşteri",
      value: String(counts.customerCount),
      icon: ICONS.musteri,
      trendData: calcTrend(counts.customersThisMonth, counts.customersPrevMonth),
      tone: "brand",
      spark: weekBuckets(counts.customerDates, nowMs),
      href: "/app/musteriler",
    },
    {
      label: "Bugün gelen arama",
      value: String(counts.callsToday),
      icon: PhoneIncoming,
      trendData: calcTrend(counts.callsToday, counts.callsYesterday),
      tone: "mint",
      spark: weekBuckets(counts.callDates, nowMs),
      href: "/app/arama",
    },
    {
      label: "Aktif portföy",
      value: String(counts.propertyCount),
      icon: ICONS.portfoy,
      trend: "canlı",
      tone: "brand",
      spark: [0, 0, 0, 0, 0, 0, counts.propertyCount],
      href: "/app/portfoyler",
    },
    {
      label: "Teyitsiz ilan",
      value: String(overdueCount),
      // Portal teyidi kavramı tek ikon → ICONS.portal.
      icon: ICONS.portal,
      trend: overdueCount ? "dikkat" : "temiz",
      tone: overdueCount ? "warn" : "mint",
      spark: [0, 0, 0, 0, 0, 0, overdueCount],
      href: "/app/portallar?durum=teyit",
    },
    {
      label: "Bekleyen komisyon",
      value: moneyTry(pendingCommission),
      icon: ICONS.komisyon,
      // Komisyon trendi mevcut aylık seriden (son 2 ay), ek sorgu yok.
      trendData: calcTrend(monthTotals[5] ?? 0, monthTotals[4] ?? 0),
      tone: "amber",
      spark: weekBuckets(commissionDates, nowMs),
      href: "/app/komisyon?durum=bekleyen",
    },
    {
      label: "Tahmini kayıp (ay)",
      value: moneyTry(lostMonth),
      icon: ICONS.alarm,
      trendData: calcTrend(lostMonth, lostPrevMonth, true),
      tone: "danger",
      spark: [0, 0, 0, 0, 0, 0, Math.max(0, Math.round(lostMonth / 1000))],
      href: "/app/kayip-kacak",
    },
  ];

  return (
    <div className="stagger-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {kpis.map((kpi, i) => (
        <Link
          key={kpi.label}
          href={kpi.href}
          className={`focus-ring press tilt-card kpi-glow kpi-glow-${kpi.tone ?? "brand"} group block rounded-[var(--radius-panel)] border border-line bg-surface p-5 hover:border-brand-300`}
        >
          <div className="flex items-start justify-between">
            <span className={`kpi-chip-shine grid h-10 w-10 place-items-center rounded-[var(--radius-card)] ${toneBg[kpi.tone ?? "brand"]}`}>
              <kpi.icon className="h-5 w-5" />
            </span>
            <span className="flex items-center gap-2">
              {kpi.trendData ? (
                <TrendBadge trend={kpi.trendData} tone={kpi.tone} />
              ) : kpi.trend ? (
                <span className={`flex items-center gap-1 rounded-full bg-canvas px-2 py-1 text-xs font-semibold ${toneText[kpi.tone ?? "brand"]}`}>
                  <TrendingUp className="h-3 w-3" /> {kpi.trend}
                </span>
              ) : null}
              <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
            </span>
          </div>
          <p className="mt-4 text-sm text-text-muted">{kpi.label}</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p title={kpi.value} className={`whitespace-nowrap font-display text-2xl font-extrabold tabular-nums ${valueTone[kpi.tone ?? ""] ?? "text-ink-950"}`}>
              <OdometerNumber value={kpi.value} />
            </p>
            <div className="w-24">
              <Sparkline id={String(i)} data={kpi.spark} color={sparkColor[kpi.tone ?? "brand"]} />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
