import Link from "next/link";
import { Sparkline, TrendPill, bucketCountFor, bucketDates } from "@/components/ui/premium";
import { CountUp } from "@/components/ui/count-up";
import { Skeleton } from "@/components/ui/skeleton";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { createClient } from "@/lib/supabase/server";
import { currentMonthPeriod, loadAdvisorResponseTimes } from "@/lib/team/advisor-metrics";
import {
  loadCommissionSummary,
  loadDeals,
  loadKpiCounts,
  loadLiveListings,
  loadPeriodStats,
  loadRentalsAndProjects,
  loadTaskSummary,
  type HomeCtx,
} from "./data";
import { portalHealth, overdueListingsOf, weekBuckets } from "./helpers";
import type { MetricKey } from "./home-layout";
import { comparedMetric, contextMetric, dedupeMetrics, hasContext, type MetricSpec } from "./home-metrics";

/** Her satır sabit yükseklikte (2 satır); iskelet ve içerik aynı (CLS yok). */
const ROW_H = "min-h-[4.25rem]";

export function MetrikSeridiIskelet({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="pm-c1 p-4">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-32" />
      <div className="mt-2 space-y-1">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className={`${ROW_H} w-full`} />
        ))}
      </div>
    </div>
  );
}

/** Tek metriği kurar; veri yoksa/yetki yoksa null (bağlamsız ya da uydurma sayı gösterilmez). */
async function buildMetric(key: MetricKey, ctx: HomeCtx): Promise<MetricSpec | null> {
  const nowMs = now();
  switch (key) {
    case "ciro":
    case "komisyon-bu-ay": {
      if (!ctx.canSeeCommissions) return null;
      const c = await loadCommissionSummary(ctx);
      const cur = c.monthTotals[5] ?? 0;
      const prev = c.monthTotals[4] ?? 0;
      return comparedMetric({
        key,
        label: key === "ciro" ? "Ciro · bu ay" : "Komisyonum · bu ay",
        value: cur,
        previous: prev,
        previousText: `Geçen ay ${moneyTry(prev)}`,
        format: "money",
        tone: "gold",
        href: "/app/komisyon",
        series: c.monthTotals,
        seriesLabel: "Son 6 ay komisyon tahakkuku",
      });
    }
    case "aktif-anlasma": {
      const deals = await loadDeals(ctx);
      const open = deals.filter((d) => !["won", "lost"].includes(d.stage));
      const won = deals.filter((d) => d.stage === "won").length;
      return contextMetric({
        key,
        label: "Aktif anlaşma",
        value: open.length,
        context: `Son 90 günde ${won} kazanıldı`,
        tone: "brand",
        href: "/app/anlasmalar",
        series: weekBuckets(
          deals.map((d) => d.updated_at ?? "").filter(Boolean),
          nowMs,
        ),
        seriesLabel: "Son 7 hafta haftalık anlaşma hareketi",
      });
    }
    case "yeni-talep": {
      const p = await loadPeriodStats(ctx);
      return comparedMetric({
        key,
        label: `Yeni talep · ${ctx.period} gün`,
        value: p.demands,
        previous: p.demandsPrev,
        previousText: `Önceki ${ctx.period} gün ${p.demandsPrev}`,
        tone: "success",
        href: "/app/talepler",
        series: p.demandDates ? bucketDates(p.demandDates, nowMs, ctx.period, bucketCountFor(ctx.period)) : null,
        seriesLabel: `Son ${ctx.period} gün yeni talep dağılımı`,
      });
    }
    case "yeni-musteri": {
      const p = await loadPeriodStats(ctx);
      return comparedMetric({
        key,
        label: `Yeni müşteri · ${ctx.period} gün`,
        value: p.customers,
        previous: p.customersPrev,
        previousText: `Önceki ${ctx.period} gün ${p.customersPrev}`,
        tone: "brand",
        href: `/app/musteriler?from=${trDayKey(daysAgoIso(ctx.period))}&to=${trDayKey(nowMs)}`,
        series: p.customerDates ? bucketDates(p.customerDates, nowMs, ctx.period, bucketCountFor(ctx.period)) : null,
        seriesLabel: `Son ${ctx.period} gün yeni müşteri dağılımı`,
      });
    }
    case "teyit": {
      const listings = await loadLiveListings(ctx);
      if (listings.length === 0) return null; // canlı ilan yoksa "%100" uydurulmaz
      const { pct } = portalHealth(listings);
      const late = overdueListingsOf(listings).length;
      return contextMetric({
        key,
        label: "Teyit sağlığı",
        value: pct,
        format: "percent",
        tone: pct >= 90 ? "success" : pct >= 70 ? "warn" : "danger",
        context: late > 0 ? `${late} ilan 7+ gündür teyitsiz` : `${listings.length} ilanın tümü teyitli`,
        href: "/app/portallar?durum=teyit",
        seriesLabel: "",
      });
    }
    case "arama": {
      const k = await loadKpiCounts(ctx);
      return comparedMetric({
        key,
        label: "Bugün gelen arama",
        value: k.callsToday,
        previous: k.callsYesterday,
        previousText: `Dün ${k.callsYesterday}`,
        tone: "success",
        href: "/app/arama",
        series: weekBuckets(k.callDates, nowMs),
        seriesLabel: "Son 7 hafta haftalık arama sayısı",
      });
    }
    case "gorev": {
      const t = await loadTaskSummary(ctx);
      return contextMetric({
        key,
        label: "Bugünün görevleri",
        value: t.dueToday + t.overdue,
        context: t.overdue > 0 ? `${t.overdue} gecikmiş` : t.dueToday > 0 ? "Hepsi zamanında" : "Açık görev yok",
        tone: t.overdue > 0 ? "danger" : "brand",
        href: t.overdue > 0 ? "/app/gorevler?filter=overdue" : "/app/gorevler",
        seriesLabel: "",
      });
    }
    case "bekleyen-komisyon":
    case "tahsil-edilen": {
      if (!ctx.canSeeCommissions) return null;
      const c = await loadCommissionSummary(ctx);
      const accrued = c.pending + c.paid;
      const isPending = key === "bekleyen-komisyon";
      return contextMetric({
        key,
        label: isPending ? "Bekleyen komisyon" : "Tahsil edilen · 6 ay",
        value: isPending ? c.pending : c.paid,
        format: "money",
        tone: isPending ? "gold" : "success",
        context: isPending ? `6 ay tahakkuk ${moneyTry(accrued)}` : `Tahakkukun %${accrued > 0 ? Math.round((c.paid / accrued) * 100) : 0}'i`,
        href: isPending ? "/app/komisyon?durum=bekleyen" : "/app/komisyon?durum=tahsil",
        series: c.monthTotals,
        seriesLabel: "Son 6 ay komisyon tahakkuku",
      });
    }
    case "geciken-kira": {
      if (!ctx.canSeeRentals) return null;
      const r = await loadRentalsAndProjects(ctx);
      const late = r.rentCharges.filter((c) => c.status === "overdue");
      const sum = late.reduce((t, c) => t + Number(c.amount ?? 0), 0);
      return contextMetric({
        key,
        label: "Geciken kira",
        value: late.length,
        tone: late.length > 0 ? "danger" : "success",
        context: late.length > 0 ? `${moneyTry(sum)} tutarında` : "Geciken tahakkuk yok",
        href: "/app/kiralama?durum=overdue",
        seriesLabel: "",
      });
    }
    case "yanit-suresi": {
      const supabase = await createClient();
      const res = await loadAdvisorResponseTimes(supabase, {
        viewer: { userId: ctx.userId, role: ctx.role, perms: ctx.perms },
        tenantId: ctx.tenantId,
        period: currentMonthPeriod(nowMs),
        nowMs,
      });
      const mine = res.failed ? undefined : res.byAdvisor.get(ctx.userId);
      if (!mine || mine.avgFirstResponseMin == null) return null;
      return contextMetric({
        key,
        label: "Ort. ilk yanıt süresi",
        value: Math.round(mine.avgFirstResponseMin),
        suffix: " dk",
        tone: mine.withinSlaPct != null && mine.withinSlaPct < 70 ? "warn" : "success",
        context: `${mine.respondedCount} yanıtlandı${mine.withinSlaPct != null ? ` · SLA içinde %${Math.round(mine.withinSlaPct)}` : ""}${mine.waitingCount > 0 ? ` · ${mine.waitingCount} bekliyor` : ""}`,
        href: "/app/gelen-kutusu",
        seriesLabel: "",
      });
    }
    default:
      return null;
  }
}

function MetricRow({ m }: { m: MetricSpec }) {
  return (
    <li>
      <Link href={m.href} className={`pm-metric focus-ring pm-t-${m.tone} ${ROW_H}`} aria-label={`${m.label}: ${m.format === "money" ? moneyTry(m.value) : m.value}${m.suffix ?? ""}. ${m.context}`}>
        <span className="min-w-0 truncate text-xs font-semibold text-text-muted [grid-area:label]">{m.label}</span>
        <CountUp
          value={m.value}
          format={m.format}
          suffix={m.suffix}
          className={`pm-num pm-metric-val ${m.format === "money" ? "pm-money" : ""}`}
        />
        <span className="flex min-w-0 items-center gap-2 [grid-area:ctx]">
          {m.trend ? <TrendPill trend={m.trend} /> : null}
          <span className="min-w-0 truncate text-xs text-text-muted">{m.context}</span>
        </span>
        {m.series ? (
          <span className="pm-metric-spark">
            <Sparkline data={m.series} tone={m.tone} height={26} label={m.seriesLabel} />
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * BAĞLAMLI METRİK ŞERİDİ: her metrik değer (tabular) + önceki döneme fark oku + mini sparkline + hedef bağlantı.
 * Bağlamı (fark/bağlam cümlesi/seri) olmayan metrik çizilmez; bir metrik ekranda yalnız BİR kez (anahtar tekilleştirilir).
 */
export async function MetrikSeridi({
  ctx,
  keys,
  title = "Metrikler",
  wide = false,
}: {
  ctx: HomeCtx;
  keys: MetricKey[];
  title?: string;
  /** Tam genişlik yerleşim: geniş konteynerde iki sütun (konteyner sorgusu). */
  wide?: boolean;
}) {
  const built = await Promise.all(keys.map((k) => buildMetric(k, ctx).catch(() => null)));
  const metrics = dedupeMetrics(built.filter((m): m is MetricSpec => m !== null && hasContext(m)));
  if (metrics.length === 0) return null;
  return (
    <section aria-labelledby="metrik-baslik" className="pm-c1 p-4">
      <h2 id="metrik-baslik" className="pm-bx-eyebrow px-1">
        {title}
      </h2>
      <div className="pm-cq mt-1">
        <ul className={`pm-sep ${wide ? "pm-metric-wide" : ""}`}>
          {metrics.map((m) => (
            <MetricRow key={m.key} m={m} />
          ))}
        </ul>
      </div>
    </section>
  );
}
