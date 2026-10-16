import { Suspense } from "react";
import { SkeletonCard } from "@/components/ui/viz";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "@/components/ui/smart-link";
import { monthEndCandidateDays, moduleAdoption, mrrMonthEndSeries, periodChurn, type ChurnSubRow } from "@/lib/admin/platform-metrics";
import { loadInternalTenantIds, loadMrrSnapshotDays } from "@/lib/billing/mrr-snapshot";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { ArrowUpRight, BarChart3, Building2, LayoutGrid, LineChart, PieChart, TrendingUp, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { ReportCenter, ReportCenterEntry } from "@/components/report-center/report-center";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import type { PremiumTone } from "@/components/ui/premium/premium-math";
import { formatTry } from "@/lib/format";
import { now as clockNow } from "@/lib/clock";
import { AreaTrendChart } from "@/components/ui/viz/server-charts";
import { StackedBar } from "@/components/admin/admin-bars";
import { TrendPill, computeTrend } from "@/components/ui/premium";
import { planLabel as catalogPlanLabel } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { exactMrr, missingSubscriptionCount, priceMapOf, type PlatformReportingAggregate } from "@/lib/reporting/platform";
import { requireReportingData } from "@/lib/reporting/result";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PERIODS, parsePeriod, periodHref, type Period } from "@/components/ui/premium";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { platformReportSections, type ReportSection } from "@/lib/admin/dashboard-layout";
import type { PlatformAccessSubject } from "@/lib/platform-access";
import {
  ActivationSection,
  ChurnReasonsSection,
  ChurnSection,
  CompositionSection,
  GrowthSection,
  MrrSection,
  UnitEconomicsSection,
  UsageSection,
} from "@/app/admin/_dashboards/platform-sections";
import { CohortSection, MrrMovementsSection } from "@/app/admin/_dashboards/revenue-retention-sections";

export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const sekme = ((await searchParams) ?? {}).sekme;
  return { title: (Array.isArray(sekme) ? sekme[0] : sekme) === "merkez" ? "Rapor merkezi" : "Raporlar" };
}

const SECTION_SPAN: Record<ReportSection, string> = {
  mrr: "xl:col-span-12",
  mrrMovements: "xl:col-span-12",
  cohorts: "xl:col-span-6",
  churn: "xl:col-span-12",
  activation: "xl:col-span-6",
  unitEconomics: "xl:col-span-6",
  usage: "xl:col-span-6",
  churnReasons: "xl:col-span-6",
  composition: "xl:col-span-6",
  growth: "xl:col-span-12",
};

function renderReportSection(section: ReportSection, period: Period): ReactNode {
  switch (section) {
    case "mrr":
      return <MrrSection period={period} />;
    case "mrrMovements":
      return <MrrMovementsSection />;
    case "cohorts":
      return <CohortSection />;
    case "churn":
      return <ChurnSection period={period} />;
    case "activation":
      return <ActivationSection period={period} />;
    case "unitEconomics":
      return <UnitEconomicsSection period={period} />;
    case "usage":
      return <UsageSection period={period} />;
    case "churnReasons":
      return <ChurnReasonsSection period={period} />;
    case "composition":
      return <CompositionSection period={period} />;
    case "growth":
      return <GrowthSection period={period} />;
  }
}

/** Kontrol panelinden taşınan analiz bölümleri (dönem: ?donem=7|30|90; rol bazlı, bkz. platformReportSections). */
function AnalysisSections({ role, period, params }: { role: PlatformAccessSubject; period: Period; params: Record<string, string | undefined> }) {
  const sections = platformReportSections(role);
  if (sections.length === 0) return null;
  return (
    <section id="analiz" aria-labelledby="analiz-baslik" className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="analiz-baslik" className="font-display text-lg font-extrabold text-ink-950">Gelir, büyüme ve kullanım analizi</h2>
          <p className="text-xs text-text-muted">MRR ve tahmin, MRR hareketleri, NRR/GRR, kayıt kohortları, churn riski, aktivasyon, birim ekonomisi, tüketim, iptal nedenleri, gelir kompozisyonu ve büyüme.</p>
        </div>
        <SegmentedControl
          label="Analiz dönemi"
          value={String(period)}
          options={PERIODS.map((p) => ({ value: String(p), label: `${p} gün`, href: `${periodHref("/admin/raporlar", params, p)}#analiz` }))}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        {sections.map((section) => (
          <div key={section} className={`min-w-0 md:col-span-6 ${SECTION_SPAN[section]}`}>
            <Suspense fallback={<SkeletonCard height={320} label="Yükleniyor" />}>{renderReportSection(section, period)}</Suspense>
          </div>
        ))}
      </div>
    </section>
  );
}

/** MRR eğrisi: son 12 TR ayının ay sonu anlık görüntüsü (/admin/billing ile aynı kaynak ve kural). */
const TREND_MONTHS = 12;

const statusLabel: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" };


/** `?from=&to=` — yalnızca geçerli YYYY-AA-GG kabul edilir; bozuk değer yok sayılır. */
function parseDateParam(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requirePlatformModule("reports");
  const rawSp = (await searchParams) ?? {};
  // Rapor merkezi sekmesi (?sekme=merkez): tüm dışa aktarma (Excel / PDF / CSV) burada; dashboard sorguları çalışmaz.
  if ((Array.isArray(rawSp.sekme) ? rawSp.sekme[0] : rawSp.sekme) === "merkez") {
    return (
      <div className="space-y-5">
        <Suspense fallback={<SkeletonCard height={480} label="Rapor merkezi yükleniyor" />}>
          <ReportCenter scope="platform" params={rawSp} />
        </Suspense>
      </div>
    );
  }
  const sp = { from: Array.isArray(rawSp.from) ? rawSp.from[0] : rawSp.from, to: Array.isArray(rawSp.to) ? rawSp.to[0] : rawSp.to };
  const analysisParams: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(rawSp)) analysisParams[k] = Array.isArray(v) ? v[0] : v;
  const analysisPeriod = parsePeriod(rawSp.donem);
  const from = parseDateParam(sp.from);
  const to = parseDateParam(sp.to);
  const dateFiltered = Boolean(from || to);

  const admin = createAdminClient();

  // Tarih aralığı verilirse metrikler o aralıkta OLUŞMUŞ kayıtlardan hesaplanır;
  // parametre yoksa mevcut davranış (tüm veri) korunur.
  const nowMs = clockNow();
  const now = new Date(nowMs);
  // Plan tanımları, ay sonu anlık görüntüleri ve iç ofis kümesi RPC'den bağımsız: aynı turda.
  const [aggregateResult, planDefs, churnSubs, snapshotDays, internalIds] = await Promise.all([
    admin.rpc("platform_reporting_aggregates", {
      p_from: from ?? null,
      p_to: to ?? null,
      p_as_of: now.toISOString(),
    }),
    getPlanDefinitions(),
    // Dönemsel churn girdisi (yalnız durum/tarih sütunları; sayfalı, 1000 satır sınırına takılmaz). Okunamazsa "veri yok".
    fetchAllRows<ChurnSubRow>((rangeFrom, rangeTo) =>
      admin.from("subscriptions").select("tenant_id, status, created_at, cancelled_at").order("id", { ascending: true }).range(rangeFrom, rangeTo),
    ),
    // MRR eğrisi: platform_mrr_daily ay sonu anlık görüntüsü (iç ofisler hariç). Okunamazsa null → tüm aylar "veri yok".
    loadMrrSnapshotDays(admin, monthEndCandidateDays(nowMs, TREND_MONTHS)).catch(() => null),
    // İç/test/demo ofisler (tenants.is_internal) churn'e girmez; sütun yokken boş küme.
    loadInternalTenantIds(admin).catch(() => new Set<string>()),
  ]);
  const aggregate = requireReportingData(
    "platform-reporting-aggregates",
    aggregateResult,
  ) as unknown as PlatformReportingAggregate;

  // Modül benimseme sabit son 30 gün penceresinde, DB'de tenant-distinct hesaplanır.
  const summary = aggregate.summary;

  const active = Number(summary.active_count);
  const prices = priceMapOf(planDefs);
  const mrr = exactMrr(aggregate.plan_stats);
  const missingSubs = missingSubscriptionCount(aggregate);
  const arpa = active ? Math.round(mrr / active) : 0;
  const tenantCount = Number(summary.tenant_count);
  // Dönemsel churn: son 30 günde iptal edilen ofis / 30 gün önce aktif ofis (payda 0 → null, "veri yok").
  // Eski "tüm zamanların iptali / toplam ofis" oranı kaldırıldı (dönem bilgisi taşımıyordu).
  const churn = churnSubs.error ? null : periodChurn(churnSubs.data.filter((r) => !internalIds.has(r.tenant_id)), nowMs, 30);

  // MRR eğrisi: geçmiş aylar platform_mrr_daily'nin AY SONU anlık görüntüsü; bu ay = KPI ile aynı canlı değer.
  // Anlık görüntü öncesi aylar null → "veri yok" (bugünkü aboneliklerden geriye dönük eğri çizilmez).
  const series = mrrMonthEndSeries(snapshotDays ?? [], nowMs, TREND_MONTHS);
  const trendPoints = series.map((p, i) => (i === series.length - 1 ? { ...p, value: mrr } : p));
  const hasCurve = trendPoints.filter((p) => p.value !== null).length >= 2;
  const lastVal = trendPoints[trendPoints.length - 1]?.value ?? null;
  const prevVal = trendPoints[trendPoints.length - 2]?.value ?? null;
  const mrrTrend = lastVal !== null && prevVal !== null ? computeTrend(lastVal, prevVal) : null;

  // Plan geliri: aktif aboneliklerin kayıtlı tutarı (MRR ile aynı kural; aboneliği eksik ofis 0 ekler, katalog yedeği yok).
  // Gizli planlar yalnız ofisi varsa listelenir.
  const planRevenue = planDefs
    .filter((plan) => !plan.hidden || Number(aggregate.plan_stats.find((item) => item.plan === plan.id)?.tenant_count ?? 0) > 0)
    .map((plan) => {
    const row = aggregate.plan_stats.find((item) => item.plan === plan.id);
    return {
      key: plan.id,
      label: plan.name,
      count: Number(row?.tenant_count ?? 0),
      revenue: Number(row?.subscription_mrr ?? 0),
    };
  });

  // Durum dağılımı
  const statuses = ["trial", "active", "past_due", "suspended", "cancelled"].map((s) => ({
    key: s,
    label: statusLabel[s],
    count: Number(aggregate.status_stats.find((row) => row.status === s)?.tenant_count ?? 0),
  }));

  // Top tenant (plan değerine göre)
  const topTenants = aggregate.top_tenants
    .map((tenant) => ({ ...tenant, value: prices.get(tenant.plan) ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Modül benimseme: her modülü son 30 günde en az 1 kez kullanan ofis oranı
  // Etiket tablosu ve oran hesabı tek kaynak: lib/admin/platform-metrics (kontrol paneli de kullanır).
  const adoption = moduleAdoption(aggregate.adoption, Number(aggregate.all_tenant_count)).map((a) => ({ mod: a.label, offices: a.offices, pct: a.pct }));
  // En düşük 2 modül → tanıtım fırsatı altyazısı
  const lowestMods = new Set(adoption.slice(-2).map((a) => a.mod));

  const resolvedRate = Number(summary.ticket_count)
    ? Math.round((Number(summary.resolved_ticket_count) / Number(summary.ticket_count)) * 100)
    : 0;

  /*
   * Hiç ofis yoksa "%0 churn" / "₺0 ARPA" gibi sayılar bilgi değil gürültüdür —
   * kartlar boş duruma düşer (sahte sıfır basmak yasak).
   */
  const hasData = tenantCount > 0;
  const kpis: {
    label: string;
    href: string;
    value: number | null;
    money?: boolean;
    /** Türkçe yüzde işareti sayının ÖNÜNDE ("%12"). */
    prefix?: string;
    icon: typeof TrendingUp;
    tone: PremiumTone;
    hint?: string;
    /** Değer null iken gösterilen açıklama (varsayılan: "Henüz ofis kaydı yok"). */
    emptyHint?: string;
  }[] = [
    {
      label: "Aylık yinelenen gelir",
      href: "/admin/billing",
      value: hasData ? mrr : null,
      money: true,
      icon: TrendingUp,
      tone: "success",
      hint: missingSubs > 0 ? `${active} aktif ofis · ${missingSubs} ofisin aboneliği eksik (MRR'a eklenmez)` : `${active} aktif ofis`,
    },
    { label: "Yıllık yinelenen gelir", href: "/admin/billing", value: hasData ? mrr * 12 : null, money: true, icon: LineChart, tone: "brand", hint: "MRR × 12" },
    { label: "Ofis başına gelir", href: "/admin/tenants?durum=active", value: active ? arpa : null, money: true, icon: Users, tone: "gold", hint: "aktif ofis ortalaması" },
    {
      label: "Müşteri kaybı · 30 gün",
      href: "/admin/tenants?durum=cancelled",
      value: churn?.rate ?? null,
      prefix: "%",
      icon: BarChart3,
      tone: "danger",
      hint: churn ? `${churn.cancelled} iptal / ${churn.base} ofis` : undefined,
      emptyHint: churn === null ? "Abonelikler okunamadı" : "Veri yok: 30 gün önce aktif ofis yok",
    },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        art="chart"
        eyebrow="Platform analizi"
        icon={BarChart3}
        title="Platform raporları"
        description="Gelir, büyüme, paket dağılımı, churn, aktivasyon ve tüketim — tüm ofislerin toplu görünümü."
        glow="mint"
      >
        <KpiGrid label="Platform göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard
              key={k.label}
              layout="inline"
              label={k.label}
              value={k.value === null ? "—" : k.money ? formatTry(k.value) : `${k.prefix ?? ""}${k.value}`}
              href={k.href}
              icon={k.icon}
              tone={k.tone}
              hint={k.value === null ? (k.emptyHint ?? "Henüz ofis kaydı yok") : k.hint}
            />
          ))}
        </KpiGrid>
      </AdminPageHeader>

      <Suspense fallback={<SkeletonCard height={168} label="Rapor merkezi yükleniyor" />}>
        <ReportCenterEntry scope="platform" />
      </Suspense>

      {/* Tarih aralığı — metrikler seçili aralıktaki kayıtlardan hesaplanır */}
      <form action="/admin/raporlar" className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <label className="text-xs font-semibold text-text-muted">
          Başlangıç
          <Input type="date" name="from" defaultValue={from} className="mt-1 block text-xs" />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Bitiş
          <Input type="date" name="to" defaultValue={to} className="mt-1 block text-xs" />
        </label>
        <Button variant="navy" size="sm" type="submit">
          Uygula
        </Button>
        {dateFiltered ? (
          <Link
            href="/admin/raporlar"
            className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
          >
            Tarih: {from ?? "…"} → {to ?? "…"} · temizle
          </Link>
        ) : (
          <p className="ml-auto text-xs text-text-faint">Aralık seçilmezse tüm veri raporlanır.</p>
        )}
      </form>

      <section className="bx min-w-0 p-5" style={{ boxShadow: "var(--elev-3)" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-text"><LineChart className="h-4 w-4 text-text-faint" aria-hidden /> Aylık yinelenen gelir · {TREND_MONTHS} ay</p>
          <span className="inline-flex items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold text-text">{formatTry(mrr)}</span>
            {mrrTrend ? <TrendPill trend={mrrTrend} /> : null}
          </span>
        </div>
        <p className="mt-1 text-xs text-text-faint">Geçmiş aylar ay sonu anlık görüntüsünden, bu ay canlı değer. İç ofisler (test ve tanıtım hesapları) dahil değil.</p>
        <div className={hasCurve ? "mt-4 h-60 sm:h-72" : "mt-4"}>
          {hasCurve ? (
            <AreaTrendChart
              data={trendPoints.map((p) => ({ label: p.label, value: p.value, href: p.value === null ? undefined : "/admin/billing" }))}
              tone="gold"
              format="money"
              name="Aylık yinelenen gelir"
              summary="last"
              ariaLabel={`Son ${TREND_MONTHS} ay aylık yinelenen gelir (ay sonu anlık görüntüsü)`}
            />
          ) : (
            <EmptyState
              variant="compact"
              illustration="rapor"
              title="Gelir eğrisi ilk ay sonunda çizilir"
              description="Eğri günlük anlık görüntülerden oluşur; geçmiş aylar geriye dönük hesaplanmaz."
            />
          )}
        </div>
        <ul aria-label="Ay sonu MRR kayıtları" className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {trendPoints.filter((p) => hasCurve || p.value !== null).map((p, i, arr) =>
            p.value === null ? (
              <li key={p.key} className="rounded-full border border-hairline px-2 py-0.5 text-text-faint" title="Bu ay için anlık görüntü yok">
                {p.label} · veri yok
              </li>
            ) : (
              <li key={p.key}>
                <Link href="/admin/billing" className="focus-ring inline-flex rounded-full border border-hairline px-2 py-0.5 tabular-nums text-text-muted hover:bg-[var(--surface-sunken)]">
                  {p.label} · {formatTry(p.value)}
                  {i === arr.length - 1 ? " (bugün)" : ""}
                </Link>
              </li>
            ),
          )}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* plan revenue */}
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><Building2 className="h-4 w-4 text-amber-600" /> Plan geliri</p>
          <div className="mt-4">
            {planRevenue.some((p) => p.revenue > 0) ? (
              <StackedBar
                format={formatTry}
                ariaLabel="Plan bazında aylık yinelenen gelir payı"
                rows={planRevenue.map((p) => ({ label: p.label, value: p.revenue, hint: `${p.count} ofis`, href: `/admin/tenants?plan=${p.key}` }))}
              />
            ) : (
              <p className="text-sm text-text-muted">Henüz gelir getiren plan yok.</p>
            )}
          </div>
        </section>

        {/* status distribution */}
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><PieChart className="h-4 w-4 text-brand-600" /> Durum dağılımı</p>
          <div className="mt-4">
            {statuses.some((s) => s.count > 0) ? (
              <StackedBar
                ariaLabel="Ofis durumlarına göre dağılım"
                rows={statuses.map((s) => ({ label: s.label, value: s.count, href: `/admin/tenants?durum=${s.key}` }))}
              />
            ) : (
              <p className="text-sm text-text-muted">Henüz ofis kaydı yok.</p>
            )}
          </div>
          {/* Destek: tek gösterge; ayrıntılı destek raporu Talepler > Raporlar'da (kopya bölüm yok). */}
          <Link href="/admin/tickets/raporlar" className="focus-ring group mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
            <span className="text-text-muted transition group-hover:text-brand-600">Destek çözüm oranı · destek raporu</span>
            <span className="flex items-center gap-1 font-display text-lg font-extrabold text-mint-600">
              %{resolvedRate}
              <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
            </span>
          </Link>
        </section>
      </div>

      {/* top tenants */}
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><TrendingUp className="h-4 w-4 text-mint-600" /> En değerli ofisler · ilk 6</p>
        <div className="mt-4 space-y-2">
          {topTenants.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Aktif ofis yok.</p>
          ) : topTenants.map((t, i) => (
            <Link key={t.id} href={`/admin/tenants/${t.id}`} className="focus-ring group flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2.5 transition hover:border-brand-300">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950 transition group-hover:text-brand-600">{t.name}</p>
                <p className="text-xs text-text-faint">{catalogPlanLabel(t.plan)}</p>
              </div>
              <span className="shrink-0 font-display text-sm font-extrabold tabular-nums text-ink-950">{formatTry(t.value)}<span className="text-xs font-normal text-text-faint">/ay</span></span>
              <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
            </Link>
          ))}
        </div>
      </section>

      {/* Modül benimseme — tüm ofislerde son 30 gün kullanım yaygınlığı */}
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <LayoutGrid className="h-4 w-4 text-brand-600" /> Modül benimseme · son 30 gün
          </p>
          <span className="text-xs text-text-faint">
            {Number(aggregate.all_tenant_count)} ofis üzerinden · en az 1 işlem yapan ofis oranı
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {adoption.map((a) => (
            <Link key={a.mod} href="/admin/aktivite" className="focus-ring group block rounded-[var(--radius-control)]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">
                  {a.mod} <span className="text-text-faint">· {a.offices} ofis</span>
                </span>
                <span className="font-bold tabular-nums text-text-muted">%{a.pct}</span>
              </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                  <div
                    className={`h-full rounded-full ${lowestMods.has(a.mod) ? "bg-amber-400" : ""}`}
                    style={{ width: `${Math.max(a.pct, 2)}%`, ...(lowestMods.has(a.mod) ? {} : { background: "var(--viz-1)" }) }}
                  />
                </div>
              {lowestMods.has(a.mod) ? (
                <p className="mt-1 text-xs font-semibold text-amber-700">
                  {a.mod} %{a.pct} — tanıtım fırsatı: ofislere bu modülü anlatan bir duyuru/eğitim planlayın.
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      <AnalysisSections role={staff} period={analysisPeriod} params={analysisParams} />
    </div>
  );
}
