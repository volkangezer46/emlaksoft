import { PhoneIncoming, Target } from "lucide-react";
import { KpiCard, bucketCountFor, bucketDates, computeTrend, type KpiCardProps } from "@/components/ui/premium";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { loadKpiCounts, loadPeriodStats, type HomeCtx } from "./data";
import { weekBuckets } from "./helpers";

/**
 * Ana ekran KPI ızgarası (4 sütunlu, premium KpiCard). Yalnız dönem/akış metrikleri:
 * bekleyen komisyon (para bloğu), toplam müşteri (hero), sıcak müşteri/teyitsiz ilan
 * (Bugün kuyruğu) ve kayıp (Kayıp-kaçak kartı) başka yerde zaten var — burada TEKRARLANMAZ.
 * Hepsi gerçek metrik ve her kart filtrelenmiş hedefe gider. Grafik YALNIZ gerçek geçmiş
 * serisinden çizilir (dönem kartları kovalanmış kayıt tarihlerinden, arama haftalık
 * sayaçtan); serisi olmayan portföy kartında grafik çizilmez.
 */
export async function KpiSatiri({ ctx }: { ctx: HomeCtx }) {
  const [counts, period] = await Promise.all([loadKpiCounts(ctx), loadPeriodStats(ctx)]);
  const nowMs = now();
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
      key: "portfoy",
      label: "Aktif portföy",
      value: counts.propertyCount,
      icon: ICONS.portfoy,
      tone: "brand",
      hint: "Yayındaki ve takipteki portföy",
      href: "/app/portfoyler",
    },
  ];

  return (
    <KpiGrid count={cards.length} className="stagger-grid">
      {cards.map(({ key, ...card }) => (
        <KpiCard key={key} {...card} layout="inline" chart="bars" />
      ))}
    </KpiGrid>
  );
}
