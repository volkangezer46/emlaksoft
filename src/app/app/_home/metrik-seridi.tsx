import type { ComponentType } from "react";
import { AlarmClock, BadgeCheck, Handshake, Hourglass, ListChecks, PhoneIncoming, Target, Timer, UserPlus, Wallet } from "lucide-react";
import { bucketCountFor, bucketDates } from "@/components/ui/premium";
import { KpiCard, KpiCardSkeleton } from "@/components/ui/kpi-card";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { createClient } from "@/lib/supabase/server";
import { currentMonthPeriod, loadAdvisorResponseTimes } from "@/lib/team/advisor-metrics";
import {
  loadCommissionSummary,
  loadDeals,
  loadKpiCounts,
  loadPeriodStats,
  loadRentalsAndProjects,
  loadTaskSummary,
  type HomeCtx,
} from "./data";
import { weekBuckets } from "./helpers";
import type { MetricKey } from "./home-layout";
import { comparedMetric, contextMetric, dedupeMetrics, hasContext, type MetricSpec } from "./home-metrics";

const ICON: Record<MetricKey, ComponentType<{ className?: string }>> = {
  ciro: Wallet,
  "komisyon-bu-ay": Wallet,
  "aktif-anlasma": Handshake,
  "yeni-talep": Target,
  "yeni-musteri": UserPlus,
  arama: PhoneIncoming,
  gorev: ListChecks,
  "bekleyen-komisyon": Hourglass,
  "tahsil-edilen": BadgeCheck,
  "geciken-kira": AlarmClock,
  "yanit-suresi": Timer,
};

/** KPI ızgarası iskeleti: gerçek kartlarla aynı ızgara ve ölçü (CLS yok). */
export function MetrikSeridiIskelet({ rows = 4, caption = false }: { rows?: number; caption?: boolean }) {
  return (
    <div role="status" aria-busy="true" className={caption ? "flex flex-col gap-1.5" : undefined}>
      <span className="sr-only">Göstergeler yükleniyor</span>
      {caption ? <span className="ds-eyebrow block" aria-hidden="true">&nbsp;</span> : null}
      <KpiGrid count={rows} stagger={false} label="Göstergeler yükleniyor">
        {Array.from({ length: rows }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </KpiGrid>
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
        // Bu ayın tahakkuku: komisyon defteri aynı ay aralığıyla (created_at, TR günü) süzülür.
        href: `/app/komisyon?from=${ctx.monthStartKey}&to=${trDayKey(nowMs)}`,
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
        // Açık aşama süzgeci (won/lost hariç) liste görünümünde sunucu sorgusuna iner.
        href: "/app/anlasmalar?gorunum=liste&asama=acik",
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
        previousText: p.demandsPrev > 0 ? `Geçen dönem ${p.demandsPrev}` : "Geçen dönem —",
        tone: "success",
        // Dönemde açılan TÜM talepler (kapalılar dahil) — sayımla aynı koşul.
        href: `/app/talepler?status=all&eklenen=${ctx.period}`,
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
        previousText: p.customersPrev > 0 ? `Geçen dönem ${p.customersPrev}` : "Geçen dönem —",
        tone: "brand",
        href: `/app/musteriler?from=${trDayKey(daysAgoIso(ctx.period))}&to=${trDayKey(nowMs)}`,
        series: p.customerDates ? bucketDates(p.customerDates, nowMs, ctx.period, bucketCountFor(ctx.period)) : null,
        seriesLabel: `Son ${ctx.period} gün yeni müşteri dağılımı`,
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
        href: `/app/gorevler${t.overdue > 0 ? "?filter=overdue" : ""}${ctx.scopeMine ? `${t.overdue > 0 ? "&" : "?"}mine=1` : ""}`,
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

function shownValue(m: MetricSpec): string {
  if (m.format === "money") return moneyTry(m.value);
  if (m.format === "percent") return `%${m.value.toLocaleString("tr-TR")}`;
  return `${m.value.toLocaleString("tr-TR")}${m.suffix ?? ""}`;
}

/**
 * KPI IZGARASI (tasarım sistemi v4 `KpiCard`): ikon karosu, büyük sayaç değeri, gerçek önceki döneme göre trend hapı,
 * bağlam cümlesi, yalnız gerçek seri varsa mini çubuklar; her kart filtrelenmiş hedefe gider (sıfır çıkmaz metrik).
 * Bağlamı (fark/bağlam cümlesi/seri) olmayan metrik çizilmez; bir metrik ekranda yalnız BİR kez (anahtar tekilleştirilir).
 */
export async function MetrikSeridi({ ctx, keys, label = "Özet göstergeler" }: { ctx: HomeCtx; keys: MetricKey[]; label?: string }) {
  const built = await Promise.all(keys.map((k) => buildMetric(k, ctx).catch(() => null)));
  const metrics = dedupeMetrics(built.filter((m): m is MetricSpec => m !== null && hasContext(m)));
  if (metrics.length === 0) return null;
  // Kapsam geçişi olan yönetim ekranında göstergelerin kimin olduğu AÇIKÇA yazılır (Ofis geneli / Sizin).
  const scopeCaption = ctx.isManagement ? (ctx.scopeMine ? "Sizin göstergeleriniz" : "Ofis geneli göstergeleri") : null;
  const grid = (
    <KpiGrid count={metrics.length} label={scopeCaption ?? label}>
      {metrics.map((m) => (
        <KpiCard
          key={m.key}
          layout="inline"
          tinted={m.tone === "gold" || m.tone === "danger"}
          label={m.label}
          value={shownValue(m)}
          href={m.href}
          icon={ICON[m.key as MetricKey] ?? Target}
          tone={m.tone}
          trend={m.trend ?? undefined}
          hint={m.context}
          series={m.series ?? undefined}
          seriesLabel={m.series ? m.seriesLabel : undefined}
        />
      ))}
    </KpiGrid>
  );
  if (!scopeCaption) return grid;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="ds-eyebrow" aria-hidden="true">
        {scopeCaption}
      </p>
      {grid}
    </div>
  );
}
