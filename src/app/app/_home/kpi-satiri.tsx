import { Flame, PhoneIncoming, Target } from "lucide-react";
import { KpiCard, bucketCountFor, bucketDates, computeTrend, type KpiCardProps } from "@/components/ui/premium";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { moneyTry } from "@/lib/leak-shield";
import {
  loadClosures,
  loadCommissionSummary,
  loadHotLeadCount,
  loadKpiCounts,
  loadLiveListings,
  loadPeriodStats,
  type HomeCtx,
} from "./data";
import { overdueListingsOf, sumLost, weekBuckets } from "./helpers";

/**
 * Ana ekran KPI ızgarası (4 sütunlu, premium KpiCard). Hepsi gerçek metrik ve her kart
 * filtrelenmiş hedefe gider. Grafik YALNIZ gerçek geçmiş serisinden çizilir:
 * dönem kartları (7/30/90 gün) seçili dönemin kovalanmış kayıt tarihlerinden,
 * komisyon son 6 ay toplamlarından, müşteri/arama haftalık sayaçlardan. Serisi
 * olmayan kartlarda (portföy, teyitsiz ilan, kayıp) grafik hiç çizilmez.
 */
export async function KpiSatiri({ ctx }: { ctx: HomeCtx }) {
  const [counts, listings, commissionSummary, closures, period, hotLeads] = await Promise.all([
    loadKpiCounts(ctx),
    loadLiveListings(),
    loadCommissionSummary(ctx),
    loadClosures(ctx),
    loadPeriodStats(ctx),
    loadHotLeadCount(ctx),
  ]);
  const nowMs = now();
  const overdueCount = overdueListingsOf(listings).length;
  const { pending: pendingCommission, monthTotals } = commissionSummary;
  const lostMonth = sumLost(closures.thisMonth);
  const lostPrevMonth = sumLost(closures.prevMonth);
  const buckets = bucketCountFor(ctx.period);
  const fromKey = trDayKey(daysAgoIso(ctx.period));
  const toKey = trDayKey(nowMs);

  const cards: (KpiCardProps & { key: string })[] = [
    {
      key: "yeni-musteri",
      label: `Yeni müşteri · ${ctx.period} gün`,
      value: period.customers,
      icon: ICONS.musteri,
      tone: "brand",
      trend: computeTrend(period.customers, period.customersPrev),
      previousText: `Önceki ${ctx.period} gün ${period.customersPrev}`,
      series: period.customerDates ? bucketDates(period.customerDates, nowMs, ctx.period, buckets) : undefined,
      seriesUnit: "dilim",
      seriesLabel: `Son ${ctx.period} günde yeni müşteri dağılımı`,
      href: `/app/musteriler?from=${fromKey}&to=${toKey}`,
    },
    {
      key: "yeni-talep",
      label: `Yeni talep · ${ctx.period} gün`,
      value: period.demands,
      icon: Target,
      tone: "success",
      trend: computeTrend(period.demands, period.demandsPrev),
      previousText: `Önceki ${ctx.period} gün ${period.demandsPrev}`,
      series: period.demandDates ? bucketDates(period.demandDates, nowMs, ctx.period, buckets) : undefined,
      seriesUnit: "dilim",
      seriesLabel: `Son ${ctx.period} günde yeni talep dağılımı`,
      href: "/app/talepler",
    },
    {
      key: "bekleyen-komisyon",
      label: "Bekleyen komisyon",
      value: moneyTry(pendingCommission),
      icon: ICONS.komisyon,
      tone: "gold",
      // Trend mevcut aylık seriden (son 2 ay), ek sorgu yok.
      trend: computeTrend(monthTotals[5] ?? 0, monthTotals[4] ?? 0),
      previousText: `Önceki ay ${moneyTry(monthTotals[4] ?? 0)}`,
      series: monthTotals,
      chart: "bars",
      seriesUnit: "ay",
      seriesLabel: "Son 6 ay komisyon tutarı",
      href: "/app/komisyon?durum=bekleyen",
    },
    {
      key: "toplam-musteri",
      label: "Toplam müşteri",
      value: counts.customerCount,
      icon: ICONS.musteri,
      tone: "brand",
      trend: computeTrend(counts.customersThisMonth, counts.customersPrevMonth),
      previousText: `Bu ay ${counts.customersThisMonth} yeni · önceki ay ${counts.customersPrevMonth}`,
      series: weekBuckets(counts.customerDates, nowMs),
      seriesUnit: "hafta",
      seriesLabel: "Son 7 hafta haftalık yeni müşteri sayısı",
      href: "/app/musteriler",
    },
    {
      key: "arama",
      label: "Bugün gelen arama",
      value: counts.callsToday,
      icon: PhoneIncoming,
      tone: "success",
      trend: computeTrend(counts.callsToday, counts.callsYesterday),
      previousText: `Dün ${counts.callsYesterday}`,
      series: weekBuckets(counts.callDates, nowMs),
      chart: "bars",
      seriesUnit: "hafta",
      seriesLabel: "Son 7 hafta haftalık arama sayısı",
      href: "/app/arama",
    },
    {
      key: "sicak",
      label: "Sıcak müşteri",
      value: hotLeads,
      icon: Flame,
      tone: "warn",
      attention: hotLeads > 0,
      hint: hotLeads ? "Hemen aranmayı bekleyenler" : "Şu an sıcak müşteri yok",
      href: "/app/musteriler?segment=sicak",
    },
    {
      key: "portfoy",
      label: "Aktif portföy",
      value: counts.propertyCount,
      icon: ICONS.portfoy,
      tone: "brand",
      hint: "Yayındaki ve takipteki portföy",
      href: "/app/portfoyler",
    },
    {
      key: "teyitsiz",
      label: "Teyitsiz ilan",
      value: overdueCount,
      // Portal teyidi kavramı tek ikon → ICONS.portal.
      icon: ICONS.portal,
      tone: overdueCount ? "warn" : "success",
      attention: overdueCount > 0,
      hint: overdueCount ? "Portal teyidi gecikmiş ilanlar" : "Tüm ilanlar güncel",
      href: "/app/portallar?durum=teyit",
    },
    {
      key: "kayip",
      label: "Tahmini kayıp (ay)",
      value: moneyTry(lostMonth),
      icon: ICONS.alarm,
      tone: "danger",
      attention: lostMonth > 0,
      trend: computeTrend(lostMonth, lostPrevMonth, true),
      previousText: `Önceki ay ${moneyTry(lostPrevMonth)}`,
      href: "/app/kayip-kacak",
    },
  ];

  return (
    <div className="stagger-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ key, ...card }) => (
        <KpiCard key={key} {...card} />
      ))}
    </div>
  );
}
