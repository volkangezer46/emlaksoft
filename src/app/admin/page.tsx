import { cache, Suspense, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  BrainCircuit,
  Building2,
  Crown,
  FlaskConical,
  Gauge,
  LayoutGrid,
  LifeBuoy,
  MessageSquareWarning,
  PieChart,
  Plus,
  Rocket,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformStaff } from "@/lib/platform";
import { daysAgoIso, now, trMonthStartIso, trParts } from "@/lib/clock";
import { fetchAllPaged } from "@/lib/cron-run";
import { EmptyState } from "@/components/ui/empty-state";
import { DataFreshness } from "@/components/ui/data-freshness";
import { PERIODS, computeTrend, parsePeriod, periodHref, type Period } from "@/components/ui/premium";
import { KpiCard, KpiGrid, KpiGridSkeleton } from "@/components/ui/kpi-card";
import { ChartCard } from "@/components/ui/chart-frame";
import { AreaTrendChart, BarCompare } from "@/components/ui/lazy-charts";
import { AttentionList } from "@/components/ui/attention-list";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusTile } from "@/components/ui/status-tile";
import { FadeSwap, Reveal } from "@/components/ui/motion";
import { AreaChart, FunnelChart, SkeletonCard } from "@/components/ui/viz";
import { StackedBar } from "@/components/admin/admin-bars";
import { BillingHome } from "./_dashboards/billing-home";
import { SupportHome } from "./_dashboards/support-home";
import { GeoHealthCard } from "./geo/health-card";
import { adminEyebrow, adminGreeting, firstNameOf } from "./_dashboards/shared";
import { getAdminHealth } from "@/lib/admin-badges";
import { getPlatformInsights } from "@/lib/insights/platform-read";
import { PlatformInsightList } from "./_components/platform-insight-list";
import { readLatestEfReconciliation } from "@/lib/ef-credits/reconcile-reader";
import {
  attentionLevel,
  buildAttentionQueue,
  buildChurnRows,
  homeVariantFor,
  platformHomeSections,
  type AttentionInput,
  type ChurnLevel,
  type ChurnSignal,
  type HomeSection,
} from "@/lib/admin/dashboard-layout";
import {
  activationFunnel,
  arpaSeries,
  churnReasons,
  embeddedCount,
  linearForecast,
  moduleAdoption,
  monthlyUsage,
  nextMonthLabels,
  trialConversion,
  type LedgerPoint,
} from "@/lib/admin/platform-metrics";
import { platformCanAccess, type PlatformRole } from "@/lib/platform-access";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";
import { formatTry } from "@/lib/format";
import { planLabel as catalogPlanLabel } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { exactArr, exactMrr, exactTrendMrr, monthlyPrice, priceMapOf, type PlatformReportingAggregate } from "@/lib/reporting/platform";
import { requireReportingCount, requireReportingData } from "@/lib/reporting/result";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

/**
 * Kontrol paneli (tasarım sistemi v4 referans uygulaması). KPI'lar tam kapsamlı SQL aggregate
 * (anlık görüntü). Dönem seçici (?donem=7|30|90) "yeni ofis / yeni destek" sayımlarını, aktivasyon
 * hunisi kohortunu ve deneme→ücretli penceresini etkiler; hepsi `created_at` / `trial_ends_at`
 * aralığıyla ayrı sorgulardır. Hepsi paralel, 60 sn `unstable_cache` (argüman = dönem).
 *
 * Ek okumalar (okunamayan `null` kalır; sıfır gibi GÖSTERİLMEZ): ödeme mutabakatı, riskli ofis
 * listesi + son 14 gün denetim hareketi, aktivasyon (örnek veri hariç gömülü sayım), ücretli aktif
 * abonelikler, iptal nedenleri, AI/değerleme/EF kontör harcama defteri (6 ay).
 * Hesaplar saf modüllerde: `dashboard-layout.ts`, `platform-metrics.ts` (testli).
 */
const LEDGER_UNITS = ["ai", "valuation", "ef"] as const;

const getAdminDashboardData = unstable_cache(
  async (period: number) => {
    const admin = createAdminClient();
    const fromIso = daysAgoIso(period);
    const prevIso = daysAgoIso(period * 2);
    const nowIso = daysAgoIso(0);
    const [
      aggregateResult,
      tenantsResult,
      auditResult,
      newTenants,
      prevTenants,
      newTickets,
      prevTickets,
      refundRes,
      manualRes,
      churnTenants,
      activityRes,
      funnelRes,
      trialRes,
      payingRes,
      cancelRes,
      ledgerRes,
    ] = await Promise.all([
      admin.rpc("platform_reporting_aggregates", { p_from: null, p_to: null, p_as_of: nowIso }),
      admin.from("tenants").select("id, name, plan, status, created_at, trial_ends_at").order("created_at", { ascending: false }).limit(5),
      admin.from("audit_logs").select("action, entity_type, actor_id, tenant_id, created_at, tenant:tenants(name)").order("created_at", { ascending: false }).limit(10),
      admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", fromIso),
      admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", prevIso).lt("created_at", fromIso),
      admin.from("support_tickets").select("id", { count: "exact", head: true }).gte("created_at", fromIso),
      admin.from("support_tickets").select("id", { count: "exact", head: true }).gte("created_at", prevIso).lt("created_at", fromIso),
      admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "refund_required"),
      admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "manual_review"),
      admin.from("tenants").select("id, name, status, trial_ends_at").in("status", ["active", "trial", "past_due", "suspended"]).limit(1000),
      admin.from("audit_logs").select("tenant_id, created_at").gte("created_at", daysAgoIso(14)).limit(10000),
      // Aktivasyon: dönemde kayıt olan ofislerin GERÇEK (örnek veri hariç) portföy/anlaşma varlığı (gömülü sayım).
      admin
        .from("tenants")
        .select("id, properties!properties_tenant_id_fkey(count), deals!deals_tenant_id_fkey(count)")
        .gte("created_at", fromIso)
        .eq("properties.is_sample", false)
        .eq("deals.is_sample", false)
        .limit(1000),
      // Deneme → ücretli: dönemde denemesi BİTEN ofisler + bugün ücretli aktif aboneliği olanlar.
      admin.from("tenants").select("id, status, trial_ends_at").gte("trial_ends_at", fromIso).lte("trial_ends_at", nowIso).limit(1000),
      admin.from("subscriptions").select("tenant_id").eq("status", "active").gt("amount_try", 0).limit(1000),
      // Churn nedenleri (sütun yoksa hata → "okunamadı", uydurma yok).
      admin.from("subscriptions").select("cancel_reason").not("cancel_requested_at", "is", null).order("cancel_requested_at", { ascending: false }).limit(500),
      // Tüketim defteri: son 6 TR ayı, harcama kayıtları; sayfalı (PostgREST 1000 satır sınırı), en çok 10 sayfa.
      fetchAllPaged<LedgerPoint>(
        (from, to) =>
          admin
            .from("account_credit_ledger")
            .select("unit, amount, available_at")
            .eq("entry_type", "spend")
            .in("unit", [...LEDGER_UNITS])
            .gte("available_at", trMonthStartIso(now(), -5))
            .order("id", { ascending: true })
            .range(from, to),
        1000,
        10,
      ),
    ]);
    const activity: Record<string, number> = {};
    const lastActivity: Record<string, string> = {};
    for (const row of activityRes.error ? [] : (activityRes.data ?? [])) {
      const r = row as { tenant_id: string | null; created_at: string };
      if (!r.tenant_id) continue;
      activity[r.tenant_id] = (activity[r.tenant_id] ?? 0) + 1;
      if (!lastActivity[r.tenant_id] || r.created_at > lastActivity[r.tenant_id]!) lastActivity[r.tenant_id] = r.created_at;
    }
    return {
      aggregate: requireReportingData("platform-dashboard-aggregates", aggregateResult) as unknown as PlatformReportingAggregate,
      tenants: requireReportingData("platform-recent-tenants", tenantsResult),
      audit: requireReportingData("platform-recent-activity", auditResult),
      newTenants: requireReportingCount("platform-new-tenants", newTenants),
      prevTenants: requireReportingCount("platform-prev-tenants", prevTenants),
      newTickets: requireReportingCount("platform-new-tickets", newTickets),
      prevTickets: requireReportingCount("platform-prev-tickets", prevTickets),
      refundRequired: refundRes.error ? null : (refundRes.count ?? 0),
      manualReview: manualRes.error ? null : (manualRes.count ?? 0),
      churnTenants: churnTenants.error ? [] : (churnTenants.data ?? []),
      activity,
      lastActivity,
      funnel: funnelRes.error
        ? null
        : (funnelRes.data ?? []).map((r) => ({
            properties: embeddedCount((r as Record<string, unknown>).properties),
            deals: embeddedCount((r as Record<string, unknown>).deals),
          })),
      trials: trialRes.error ? null : (trialRes.data ?? []),
      payingTenantIds: payingRes.error ? null : [...new Set((payingRes.data ?? []).map((r) => String(r.tenant_id)))],
      cancelReasons: cancelRes.error ? null : (cancelRes.data ?? []),
      ledger: ledgerRes.error && ledgerRes.rows.length === 0 ? null : ledgerRes.rows,
      ledgerTruncated: Boolean(ledgerRes.error) && ledgerRes.rows.length > 0,
    };
  },
  ["admin-dashboard-v4"],
  { revalidate: 60, tags: ["admin-dashboard"] },
);

/** Aynı istek içinde tüm bölümler tek yükü paylaşır. */
const loadDashboard = cache(async (period: number) => {
  const [data, planDefs] = await Promise.all([getAdminDashboardData(period), getPlanDefinitions()]);
  return { ...data, planDefs };
});

/** Sistem sağlığı + EF mutabakat: dikkat kuyruğu ve sağlık kartı aynı okumayı paylaşır; okunamazsa null. */
const loadSystemSignals = cache(async (includeEf: boolean) => {
  const [health, ef] = await Promise.all([
    getAdminHealth().catch(() => null),
    includeEf ? readLatestEfReconciliation().catch(() => null) : Promise.resolve(null),
  ]);
  return { health, ef };
});

const statusLabel: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" };

type Data = Awaited<ReturnType<typeof loadDashboard>>;

function derive(data: Data) {
  const { aggregate } = data;
  const summary = aggregate.summary;
  return {
    summary,
    active: Number(summary.active_count),
    trial: Number(summary.trial_count),
    totalTenants: Number(summary.tenant_count),
    risk: Number(summary.risk_count),
    openTickets: Number(summary.open_ticket_count),
    urgentTickets: Number(summary.urgent_ticket_count),
    soon: Number(summary.trials_ending_7d),
    members: Number(summary.member_count),
    mrr: exactMrr(aggregate.plan_stats, priceMapOf(data.planDefs)),
  };
}

/**
 * Dikkat kuyruğu tek okuma (hero özeti + kart). Churn kartı görünen rolde "Riskli ofis" satırı
 * YOK (risk: null): riskli ofisler churn kartında tek listede (sayı + filtreli bağlantı) toplanır.
 */
const loadAttention = cache(async (period: Period, role: PlatformRole) => {
  const data = await loadDashboard(period);
  const d = derive(data);
  const sys = await loadSystemSignals(platformCanAccess(role, "billing"));
  const input: AttentionInput = {
    refundRequired: data.refundRequired,
    manualReview: data.manualReview,
    cronErrors: sys.health ? sys.health.cronErrors : null,
    efReconciliation: sys.ef ? sys.ef.status : null,
    urgentTickets: d.urgentTickets,
    openTickets: d.openTickets,
    risk: platformHomeSections(role).includes("churn") ? null : d.risk,
    trialsEnding: d.soon,
    newTrials: data.newTenants,
  };
  return buildAttentionQueue(input, role);
});

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const monthLabel = (iso: string) => MONTHS_SHORT[trParts(iso).month] ?? "";
const weekLabel = (iso: string) => {
  const p = trParts(iso);
  return `${p.day} ${MONTHS_SHORT[p.month] ?? ""}`;
};

/** Hero özeti: KPI'ları TEKRARLAMAZ; en öncelikli işi adıyla ve bağlantısıyla söyler. */
async function HeroSummary({ period, role }: { period: Period; role: PlatformRole }) {
  const queue = await loadAttention(period, role);
  const top = queue[0];
  if (!top) return <p>Platform sakin: önceliklendirilmiş bekleyen iş yok. Yeni bir durum oluşunca burada söylenir.</p>;
  return (
    <p>
      Dikkat bekleyen konular var; en önceliklisi{" "}
      <Link href={top.href} className="focus-ring rounded-sm font-semibold text-accent-text underline-offset-2 hover:underline">
        {top.label.toLocaleLowerCase("tr-TR")}
      </Link>
      . Ayrıntılar aşağıda önem sırasıyla.
    </p>
  );
}

async function KpiStrip({ period, role }: { period: Period; role: PlatformRole }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const conv = data.trials && data.payingTenantIds ? trialConversion(data.trials, new Set(data.payingTenantIds), now(), period) : null;
  const convText =
    conv === null ? "Deneme→ücretli okunamadı" : conv.rate === null ? `Son ${period} günde biten deneme yok` : `Deneme→ücretli %${conv.rate} · son ${period} gün`;
  return (
    <KpiGrid label="Platform özet göstergeleri">
      <KpiCard
        layout="inline"
        label="Toplam ofis"
        value={d.totalTenants}
        href="/admin/tenants"
        icon={Building2}
        tone="brand"
        trend={computeTrend(d.totalTenants, Math.max(0, d.totalTenants - data.newTenants))}
        hint={`Dönem başına göre · ${period} gün`}
      />
      <KpiCard layout="inline" label="Aktif abone" value={d.active} href="/admin/tenants?durum=active" icon={Crown} tone="gold" hint={convText} />
      <KpiCard layout="inline" label="Deneme" value={d.trial} href="/admin/tenants?durum=trial" icon={FlaskConical} tone="neutral" hint="Deneme sürecinde" />
      <KpiCard
        layout="inline"
        tinted
        label={`Yeni ofis · ${period} gün`}
        value={data.newTenants}
        href={`/admin/tenants?yeni=${period}`}
        icon={Plus}
        tone="success"
        trend={computeTrend(data.newTenants, data.prevTenants)}
        hint={`Önceki ${period} gün: ${data.prevTenants}`}
      />
      {platformCanAccess(role, "tickets") ? (
        <KpiCard
          layout="inline"
          tinted
          label={`Yeni destek · ${period} gün`}
          value={data.newTickets}
          href="/admin/tickets"
          icon={LifeBuoy}
          tone="danger"
          trend={computeTrend(data.newTickets, data.prevTickets, true)}
          hint={`Önceki ${period} gün: ${data.prevTickets}`}
        />
      ) : null}
      {platformCanAccess(role, "members") ? (
        <KpiCard layout="inline" tinted label="Toplam kullanıcı" value={d.members} href="/admin/members" icon={Users} tone="brand" hint={`${d.totalTenants} ofiste`} />
      ) : null}
    </KpiGrid>
  );
}

/** DİKKAT GEREKTİRENLER: rol filtreli, önem sırasına göre iş kuyruğu + platform içgörüleri. */
async function AttentionSection({ period, role }: { period: Period; role: PlatformRole }) {
  const [queue, insights] = await Promise.all([loadAttention(period, role), getPlatformInsights({ limit: 3 })]);
  return (
    <AttentionList
      items={queue.map((q) => ({ id: q.id, label: q.label, hint: q.hint, href: q.href, count: q.count, level: attentionLevel(q.severity) }))}
      emptyTitle={insights.length === 0 ? "Şu an bekleyen iş yok" : "Kuyruk temiz"}
    >
      {/* ATTENTION_INSIGHT_SLOT: gerçek platform içgörüleri (platform_insights, RLS'li okuyucu). Satır yoksa hiçbir şey çizilmez; içgörü UYDURULMAZ. */}
      <PlatformInsightList insights={insights} />
    </AttentionList>
  );
}

/** MRR odak metriği + 12 ay eğrisi + ETİKETLİ 3 ay doğrusal tahmin (en az 3 gerçek ay varsa). */
async function MrrSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const prices = priceMapOf(data.planDefs);
  const series = data.aggregate.mrr_trend.map((r) => ({ label: monthLabel(r.month_start), value: exactTrendMrr(r, prices) }));
  const last = series.length >= 2 ? series[series.length - 1]!.value : null;
  const prev = series.length >= 2 ? series[series.length - 2]!.value : null;
  const trend = last !== null && prev !== null ? computeTrend(last, prev) : null;
  const hasCurve = series.length >= 2 && series.some((s) => s.value > 0);
  const forecast = linearForecast(series.map((s) => s.value));
  const points = [
    ...series.map((s, i) => ({ label: s.label, value: s.value, forecast: forecast && i === series.length - 1 ? s.value : null })),
    ...(forecast ? nextMonthLabels(now(), forecast.values.length).map((label, i) => ({ label, value: null, forecast: forecast.values[i]! })) : []),
  ];
  const arpa = d.active > 0 ? Math.round(d.mrr / d.active) : null;
  const trendTone = trend ? (trend.dir === "new" ? "gold" : trend.good === null ? "neutral" : trend.good ? "success" : "danger") : "neutral";
  return (
    <ChartCard
      as="h2"
      title="Aylık yinelenen gelir"
      subtitle="Düzenli gelir performansı ve trendi"
      icon={Wallet}
      tone="gold"
      href="/admin/billing"
      hrefLabel="Gelir ayrıntısı"
      height={0}
      className="h-full"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/admin/billing" className="focus-ring flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)]">
            <span className="ds-num ds-money">{formatTry(d.mrr)}</span>
            {trend ? (
              <span className={`ds-pill pm-t-${trendTone}`}>
                <span aria-hidden="true">{trend.label}</span>
                <span className="sr-only">{trend.sr}</span>
              </span>
            ) : null}
          </Link>
          <p className="mt-1.5 text-sm tabular-nums text-text-muted">
            Yıllık {formatTry(exactArr(d.mrr))}
            {prev !== null ? ` · önceki ay sonu ${formatTry(prev)}` : ""}
          </p>
        </div>
        {arpa !== null ? (
          <Link href="/admin/tenants?durum=active" className="ds-tile ds-lift focus-ring pm-t-gold min-w-40">
            <span className="text-xs text-text-muted">Ofis başı gelir (ARPA)</span>
            <span className="ds-num text-lg">{formatTry(arpa)}</span>
          </Link>
        ) : null}
      </div>
      <div className="mt-4 h-60">
        {hasCurve ? (
          <AreaTrendChart
            data={points}
            tone="gold"
            format="money"
            name="MRR"
            forecastName="Tahmin"
            ariaLabel={`Son ${series.length} ay aylık yinelenen gelir${forecast ? " ve 3 aylık doğrusal tahmin" : ""}`}
          />
        ) : (
          <EmptyState variant="compact" illustration="rapor" title="Gelir eğrisi için veri birikiyor" description="En az iki aylık abonelik kaydı oluşunca eğri burada çizilir." />
        )}
      </div>
      {forecast ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="ds-pill pm-t-gold">Tahmin</span>
          Kesikli çizgi son {forecast.basis} ayın doğrusal eğilimidir; kesin değildir.
        </p>
      ) : null}
    </ChartCard>
  );
}

const SIGNAL_TONE: Record<ChurnSignal["key"], string> = { past_due: "danger", suspended: "danger", inactive: "warn", quiet: "gold" };
const LEVEL_PILL: Record<ChurnLevel, { label: string; tone: string }> = {
  yuksek: { label: "Yüksek", tone: "danger" },
  orta: { label: "Orta", tone: "warn" },
  dusuk: { label: "Düşük", tone: "neutral" },
};

/** Riskli ofisler + churn sinyalleri: TEK liste (eski "Riskli ofis" satırı ve churn tablosu birleşti). */
async function ChurnSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const rows = buildChurnRows(data.churnTenants, new Map(Object.entries(data.activity)), now(), 8, new Map(Object.entries(data.lastActivity)));
  return (
    <ChartCard
      as="h2"
      title="Riskli ofisler ve churn"
      subtitle="Gecikmiş/askıda veya az kullanan ofisler; erken aksiyon alın."
      icon={ShieldAlert}
      tone="danger"
      href="/admin/tenants?durum=risk"
      hrefLabel={d.risk > 0 ? `Gecikmiş + askıda: ${d.risk}` : "Tüm riskli ofisler"}
      height={0}
      className="h-full"
    >
      {rows.length === 0 ? (
        <EmptyState variant="compact" illustration="basari" title="Risk sinyali olan ofis yok" description="Ödeme gecikmesi, askıya alma veya 14 gündür düşük kullanım olursa burada listelenir." />
      ) : (
        <div className="-mx-1.5 overflow-x-auto">
          <Table className="pm-tbl min-w-[34rem]">
            <caption className="sr-only">Riskli ofisler, sinyalleri, son hareket ve risk düzeyi</caption>
            <THead>
              <TR>
                <TH scope="col" className="pm-l">Ofis</TH>
                <TH scope="col" className="pm-l">Sinyaller</TH>
                <TH scope="col">Son hareket</TH>
                <TH scope="col">Risk</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TH scope="row">
                    <Link href={r.href} className="focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)]">
                      <Building2 className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
                      <span className="truncate">{r.name}</span>
                    </Link>
                  </TH>
                  <TD className="pm-l pm-wrap">
                    <span className="flex flex-wrap gap-1.5">
                      {r.signals.map((s) => (
                        <span key={s.key} className={`ds-pill pm-t-${SIGNAL_TONE[s.key]}`}>
                          {s.label}
                        </span>
                      ))}
                    </span>
                  </TD>
                  <TD className="text-text-muted">{r.lastActivityAt ? relativeTimeTR(r.lastActivityAt) : "14+ gün"}</TD>
                  <TD>
                    <span className={`ds-pill pm-t-${LEVEL_PILL[r.level].tone}`}>{LEVEL_PILL[r.level].label}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </ChartCard>
  );
}

/** Sistem sağlığı: zamanlanmış işler + veritabanı yanıtı + son cron + EF mutabakat (yetkiliye). */
async function HealthSection({ role }: { role: PlatformRole }) {
  const sys = await loadSystemSignals(platformCanAccess(role, "billing"));
  const h = sys.health;
  const tiles: ReactNode[] = [];
  if (!h) {
    tiles.push(<StatusTile key="none" label="Sistem durumu" value="Okunamadı" hint="Sağlık sorgusu yanıt vermedi" href="/admin/sistem" tone="danger" />);
  } else {
    const ok = h.cronTotal !== null && h.cronErrors !== null ? h.cronTotal - h.cronErrors : null;
    tiles.push(
      <StatusTile
        key="cron"
        label="Zamanlanmış işler"
        value={ok === null ? "Okunamadı" : `${ok} / ${h.cronTotal} başarılı`}
        hint={h.cronErrors ? `Hatalı: ${(h.failedJobs ?? []).join(", ") || `${h.cronErrors} iş`}` : "Hepsi sağlıklı"}
        href="/admin/sistem"
        tone={ok === null || h.cronErrors ? "warn" : "success"}
        progress={ok !== null && h.cronTotal ? { value: ok, max: h.cronTotal, label: "Başarılı zamanlanmış iş oranı" } : undefined}
      />,
      <StatusTile
        key="db"
        label="Veritabanı"
        value={`${h.dbMs} ms`}
        hint={h.ok ? "Sorgular hatasız · 1 sn bütçe" : "Sorgu hatası var"}
        href="/admin/sistem"
        tone={!h.ok ? "danger" : h.dbMs < 400 ? "success" : h.dbMs < 900 ? "warn" : "danger"}
        progress={{ value: Math.min(h.dbMs, 1000), max: 1000, label: "Yanıt süresinin 1 saniyelik bütçeye oranı" }}
      />,
      <StatusTile key="last" label="Son cron çalışması" value={h.lastCronAt ? relativeTimeTR(h.lastCronAt) : "Kayıt yok"} href="/admin/sistem" tone={h.lastCronAt ? "brand" : "neutral"} />,
    );
  }
  if (platformCanAccess(role, "billing") && sys.ef) {
    tiles.push(
      <StatusTile
        key="ef"
        label="EF mutabakatı"
        value={sys.ef.status === "ok" ? "Uyumlu" : sys.ef.status === "drift" ? "Sapma var" : "Yapılamadı"}
        hint={relativeTimeTR(sys.ef.runAt)}
        href="/admin/ef-kontor"
        tone={sys.ef.status === "ok" ? "success" : "warn"}
      />,
    );
  }
  return (
    <ChartCard as="h2" title="Platform durumu" subtitle="Sistem bileşenlerinin genel durumu" icon={Activity} tone="brand" href="/admin/sistem" hrefLabel="Ayrıntı" height={0} className="h-full">
      <div className="grid gap-2.5 sm:grid-cols-2">{tiles}</div>
    </ChartCard>
  );
}

/** Aktivasyon hunisi (kayıt → ilk portföy → ilk anlaşma) + GERÇEK deneme → ücretli dönüşüm. */
async function ActivationSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const funnel = data.funnel ? activationFunnel(data.funnel) : null;
  const conv = data.trials && data.payingTenantIds ? trialConversion(data.trials, new Set(data.payingTenantIds), now(), period) : null;
  const cohort = `/admin/tenants?yeni=${period}`;
  return (
    <ChartCard
      as="h2"
      title="Aktivasyon ve dönüşüm"
      subtitle={`Son ${period} günde kayıt olan ofisler · örnek veri hariç`}
      icon={Rocket}
      tone="success"
      href={cohort}
      hrefLabel="Kohort"
      height={0}
      className="h-full"
    >
      {funnel === null ? (
        <EmptyState variant="compact" illustration="hata" title="Aktivasyon verisi okunamadı" description="Gömülü sayım sorgusu yanıt vermedi; ofis listesinden kohortu inceleyebilirsiniz." />
      ) : (
        <FunnelChart
          ardisik
          ariaLabel={`Son ${period} gün aktivasyon hunisi`}
          emptyText={`Son ${period} günde yeni kayıt yok`}
          stages={[
            { label: "Kayıt", value: funnel.registered, href: cohort },
            { label: "İlk portföy", value: funnel.withProperty, href: cohort, sub: "En az bir gerçek portföy" },
            { label: "İlk anlaşma", value: funnel.withDeal, href: cohort, sub: "Portföy + en az bir anlaşma" },
          ]}
        />
      )}
      <div className="mt-4 border-t border-hairline pt-3">
        {conv === null ? (
          <p className="text-sm text-text-muted">Deneme → ücretli dönüşüm okunamadı.</p>
        ) : conv.rate === null ? (
          <p className="text-sm text-text-muted">Son {period} günde denemesi biten ofis yok; dönüşüm oranı oluşmadı.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="ds-eyebrow">Deneme → ücretli · son {period} gün</p>
              <p className="mt-1 text-sm text-text-muted">
                <Link href={`/admin/tenants?deneme=bitti&gun=${period}&durum=active`} className="focus-ring font-semibold text-accent-text hover:underline">
                  {conv.converted} ofis
                </Link>{" "}
                ücretli aboneliğe geçti /{" "}
                <Link href={`/admin/tenants?deneme=bitti&gun=${period}`} className="focus-ring font-semibold text-accent-text hover:underline">
                  {conv.ended} biten deneme
                </Link>
              </p>
            </div>
            <Link href={`/admin/tenants?deneme=bitti&gun=${period}`} className="ds-num focus-ring rounded-[var(--radius-control)] text-3xl">
              %{conv.rate}
            </Link>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/** Modül kullanım dağılımı (son 30 gün, en az bir işlem yapan ofis oranı; /admin/raporlar ile aynı hesap). */
async function ModulesSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const rows = moduleAdoption(data.aggregate.adoption, Number(data.aggregate.all_tenant_count)).filter((r) => r.offices > 0).slice(0, 8);
  return (
    <ChartCard as="h2" title="Modül kullanımı" subtitle="Son 30 gün · en az bir işlem yapan ofis oranı" icon={LayoutGrid} tone="brand" href="/admin/raporlar" hrefLabel="Raporlar" height={0} className="h-full">
      {rows.length === 0 ? (
        <EmptyState variant="compact" illustration="rapor" title="Henüz modül kullanımı yok" description="Ofisler müşteri, portföy, anlaşma gibi işlemler yaptıkça dağılım burada görünür." />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href="/admin/raporlar" className="focus-ring group block rounded-[var(--radius-control)]">
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-text group-hover:text-accent-text">{r.label}</span>
                  <span className="tabular-nums text-text-muted">
                    {r.offices} ofis · <span className="font-semibold text-text">%{r.pct}</span>
                  </span>
                </span>
                <span className="ds-bar pm-t-brand mt-1.5">
                  <span className="motion-progress-fill" style={{ width: `${Math.max(r.pct, 2)}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** Birim ekonomisi: ARPA trendi (gerçek). NRR dürüstçe "hesaplanamıyor" (dönemsel gelir anlık görüntüsü yok). */
async function UnitEconomicsSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const prices = priceMapOf(data.planDefs);
  const points = arpaSeries(
    data.aggregate.mrr_trend.map((r) => ({
      label: monthLabel(r.month_start),
      mrr: exactTrendMrr(r, prices),
      offices: Number(r.advisor_count) + Number(r.office_count) + Number(r.professional_count) + Number(r.enterprise_count),
    })),
  );
  const real = points.filter((p) => p.arpa !== null);
  return (
    <ChartCard as="h2" title="Birim ekonomisi" subtitle="ARPA: aktif ofis başına aylık gelir · 12 ay" icon={TrendingUp} tone="brand" href="/admin/raporlar" hrefLabel="Raporlar" height={0} className="h-full">
      <div className="h-48">
        {real.length >= 2 ? (
          <AreaTrendChart data={points.map((p) => ({ label: p.label, value: p.arpa }))} tone="brand" format="money" name="ARPA" ariaLabel="Son 12 ay aktif ofis başına aylık gelir" />
        ) : (
          <EmptyState variant="compact" illustration="rapor" title="ARPA eğrisi için veri birikiyor" description="En az iki ay aktif ofis ve gelir oluşunca çizilir." />
        )}
      </div>
      <p className="mt-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-xs leading-5 text-text-muted">
        <span className="font-semibold text-text">Net gelir tutma (NRR): hesaplanamıyor.</span> Doğru NRR için her ayın başı/sonu ofis bazlı gelir anlık
        görüntüsü gerekir; bugün yalnız güncel abonelik durumu tutuluyor. Tahmini sayı gösterilmez.
      </p>
    </ChartCard>
  );
}

/** AI kredisi, değerleme raporu ve EmlakFiyati kontörü tüketimi (son 6 TR ayı, harcama defteri). */
async function UsageSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const usage = data.ledger ? monthlyUsage(data.ledger, LEDGER_UNITS, now()) : null;
  const rows = usage ? usage.months.map((m, i) => ({ ay: m.label, ai: usage.byUnit.ai![i]!, valuation: usage.byUnit.valuation![i]!, ef: usage.byUnit.ef![i]! })) : [];
  return (
    <ChartCard as="h2" title="AI ve kontör tüketimi" subtitle="Son 6 ay · harcanan birim" icon={BrainCircuit} tone="gold" href="/admin/ai-kullanim" hrefLabel="AI kullanımı" height={0} className="h-full">
      {usage === null ? (
        <EmptyState variant="compact" illustration="rapor" title="Tüketim defteri okunamadı" description="Kredi defteri bu ortamda etkin değil veya sorgu yanıt vermedi." />
      ) : usage.total === 0 ? (
        <EmptyState variant="compact" illustration="rapor" title="Son 6 ayda tüketim yok" description="Ofisler AI asistanı, değerleme raporu veya EmlakFiyati kontörü kullandıkça burada görünür." />
      ) : (
        <div className="h-52">
          <BarCompare
            data={rows}
            xKey="ay"
            series={[
              { key: "ai", label: "AI kredisi", color: "var(--viz-1)" },
              { key: "valuation", label: "Değerleme raporu", color: "var(--viz-2)" },
              { key: "ef", label: "EF kontörü", color: "var(--viz-5)" },
            ]}
          />
        </div>
      )}
      {data.ledgerTruncated ? <p className="mt-2 text-xs text-text-muted">Not: defter okumasının bir kısmı tamamlanamadı; değerler eksik olabilir.</p> : null}
    </ChartCard>
  );
}

/** Abonelik iptal taleplerindeki gerekçeler (serbest metin, normalize edilip gruplanır). */
async function ChurnReasonsSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const reasons = data.cancelReasons ? churnReasons(data.cancelReasons) : null;
  const max = reasons && reasons.length ? Math.max(...reasons.map((r) => r.count)) : 1;
  return (
    <ChartCard
      as="h2"
      title="İptal nedenleri"
      subtitle="Abonelik iptal taleplerindeki gerekçeler"
      icon={MessageSquareWarning}
      tone="warn"
      href="/admin/tenants?durum=cancelled"
      hrefLabel="İptal edilenler"
      height={0}
      className="h-full"
    >
      {reasons === null ? (
        <EmptyState variant="compact" illustration="hata" title="İptal nedeni kaydı okunamadı" description="İptal talebi alanları bu ortamda etkin değil veya sorgu yanıt vermedi." />
      ) : reasons.length === 0 ? (
        <EmptyState variant="compact" illustration="basari" title="Henüz iptal talebi yok" description="Bir ofis aboneliğini iptal ederken neden yazarsa burada gruplanır." />
      ) : (
        <ul className="space-y-2.5">
          {reasons.map((r) => (
            <li key={r.reason}>
              <Link href="/admin/tenants?durum=cancelled" className="focus-ring group block rounded-[var(--radius-control)]">
                <span className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-text group-hover:text-accent-text" title={r.reason}>
                    {r.reason}
                  </span>
                  <span className="ds-num shrink-0 text-sm">{r.count}</span>
                </span>
                <span className="ds-bar pm-t-warn mt-1.5">
                  <span className="motion-progress-fill" style={{ width: `${Math.max((r.count / max) * 100, 4)}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** Büyüme (ikincil): haftalık yeni ofis ve yeni aktif abonelik, ortak AreaChart (sunucu SVG). */
async function GrowthSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const weekly = data.aggregate.weekly;
  const offices = weekly.map((w) => Number(w.tenants));
  const subs = weekly.map((w) => Number(w.active_subscriptions));
  const hasData = weekly.length >= 2 && (offices.some((v) => v > 0) || subs.some((v) => v > 0));
  return (
    <ChartCard
      as="h2"
      title="Büyüme"
      subtitle="Haftalık yeni ofis ve yeni aktif abonelik · son 8 hafta"
      icon={Gauge}
      tone="success"
      href="/admin/tenants?yeni=90"
      hrefLabel="Son 90 gün kayıtlar"
      height={176}
      empty={!hasData}
      emptyText="Yeni ofis ve abonelikler geldikçe eğri burada çizilir."
      className="h-full"
    >
      <AreaChart
        series={[
          { name: "Yeni ofis", values: offices, tone: "accent" },
          { name: "Yeni aktif abonelik", values: subs, tone: "success" },
        ]}
        pointLabels={weekly.map((w) => weekLabel(w.week_start))}
        height={150}
        ariaLabel={`Son ${weekly.length} hafta yeni ofis ve yeni aktif abonelik`}
        href="/admin/tenants?yeni=90"
      />
    </ChartCard>
  );
}

/** Gelir kompozisyonu: plan bazında MRR payı, tek yığılmış çubuk. */
async function CompositionSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const { aggregate } = data;
  // Gizli planlar (örn. Business) dahil: bu planda ofisi olan hiçbir satır sessizce düşmez.
  const shownPlans = data.planDefs.filter((p) => !p.hidden || Number(aggregate.plan_stats.find((r) => r.plan === p.id)?.tenant_count ?? 0) > 0);
  // Plan bazında MRR: gerçek abonelik MRR'ı + aboneliği eksik aktif ofisler için katalog fiyatı (exactMrr ile aynı kural).
  const rows = shownPlans.map((plan) => {
    const row = aggregate.plan_stats.find((r) => r.plan === plan.id);
    const missing = row ? Math.max(0, Number(row.active_count) - Number(row.subscription_count)) : 0;
    return {
      label: plan.name,
      value: row ? Math.round(Number(row.subscription_mrr) + missing * monthlyPrice(plan.id, priceMapOf(data.planDefs))) : 0,
      hint: `${row ? Number(row.tenant_count) : 0} ofis`,
      href: `/admin/tenants?plan=${plan.id}`,
    };
  });
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <ChartCard as="h2" title="Gelir kompozisyonu" subtitle="Plan bazında aylık yinelenen gelir" icon={PieChart} tone="gold" href="/admin/billing" hrefLabel="Faturalama" height={0} className="h-full">
      {total > 0 ? (
        <StackedBar rows={rows} format={formatTry} ariaLabel="Plan bazında aylık yinelenen gelir payı" />
      ) : (
        <EmptyState variant="compact" illustration="komisyon" title="Henüz gelir getiren plan yok" description="Aktif abonelikler oluştukça plan bazında dağılım burada görünür." />
      )}
    </ChartCard>
  );
}

/** Son ofisler + platform aktivite akışı. */
async function ActivitySection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const list = data.tenants;
  const auditRows = data.audit;
  return (
    <section aria-label="Son hareketler" className="grid gap-4 md:grid-cols-2">
      <ChartCard as="h2" title="Son ofisler" icon={Building2} tone="brand" href="/admin/tenants" hrefLabel="Tümü" height={0}>
        {list.length === 0 ? (
          <EmptyState variant="compact" illustration="ev" title="Henüz ofis yok" description="Yeni kayıtlar burada listelenir." />
        ) : (
          <ul className="ds-sep -mx-1.5">
            {list.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link href={`/admin/tenants/${t.id}`} className="ds-row focus-ring min-h-11">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{t.name}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {catalogPlanLabel(t.plan)} · {statusLabel[t.status] ?? t.status}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">{relativeTimeTR(t.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
      <ChartCard as="h2" title="Platform aktivite akışı" icon={Activity} tone="neutral" href="/admin/aktivite" hrefLabel="Tümü" height={0}>
        {auditRows.length === 0 ? (
          <EmptyState variant="compact" illustration="liste" title="Henüz hareket kaydı yok" description="Platformdaki işlemler burada akar." />
        ) : (
          <ul className="ds-sep -mx-1.5">
            {auditRows.slice(0, 5).map((a, i) => {
              const tenantName = Array.isArray(a.tenant) ? a.tenant[0]?.name : (a.tenant as { name?: string } | null)?.name;
              return (
                <li key={i}>
                  <Link href={a.tenant_id ? `/admin/tenants/${a.tenant_id}` : "/admin/aktivite"} className="ds-row focus-ring min-h-11">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{auditActionLabel(a.action)}</span>
                      <span className="block truncate text-xs text-text-muted">
                        {tenantName ?? "Platform"} · {a.entity_type ?? "sistem"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">{relativeTimeTR(a.created_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ChartCard>
    </section>
  );
}

/** Bölüm → ızgara genişliği (rol bazlı saf kural; `platformHomeSections` sırası korunur). */
function sectionSpan(section: HomeSection, sections: readonly HomeSection[]): string {
  const hasMrr = sections.includes("mrr");
  switch (section) {
    case "attention":
      return hasMrr ? "xl:col-span-5" : "xl:col-span-7";
    case "mrr":
      return "xl:col-span-7";
    case "churn":
      return hasMrr ? "xl:col-span-7" : "xl:col-span-12";
    case "health":
      return "xl:col-span-5";
    case "activation":
    case "modules":
    case "unitEconomics":
    case "usage":
    case "churnReasons":
    case "composition":
      return "xl:col-span-6";
    default:
      return "xl:col-span-12";
  }
}

const SKELETON_HEIGHT: Record<HomeSection, number> = {
  attention: 360,
  mrr: 420,
  churn: 360,
  health: 260,
  activation: 320,
  modules: 320,
  unitEconomics: 320,
  usage: 320,
  churnReasons: 280,
  growth: 268,
  composition: 220,
  activity: 300,
  geo: 200,
};

/** İlk ekranın altındaki bölümler görünürlükte bir kez belirir (sunucu çıktısı yine görünür). */
const BELOW_FOLD: ReadonlySet<HomeSection> = new Set(["activation", "modules", "unitEconomics", "usage", "churnReasons", "composition", "growth", "activity", "geo"]);

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requirePlatformStaff();

  // Departmana özel açılış ekranı — aynı /admin adresi, role göre farklı panel.
  const variant = homeVariantFor(staff.role);
  if (variant === "billing") return <BillingHome staffName={staff.full_name} />;
  if (variant === "support") return <SupportHome staffName={staff.full_name} />;

  const sp = (await searchParams) ?? {};
  const period = parsePeriod(sp.donem);
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) params[k] = Array.isArray(v) ? v[0] : v;

  const nowMs = now();
  const role = staff.role;
  const sections = platformHomeSections(role);
  const firstName = firstNameOf(staff.full_name);

  const render = (section: HomeSection): ReactNode => {
    switch (section) {
      case "attention":
        return <AttentionSection period={period} role={role} />;
      case "mrr":
        return <MrrSection period={period} />;
      case "churn":
        return <ChurnSection period={period} />;
      case "health":
        return <HealthSection role={role} />;
      case "activation":
        return (
          <FadeSwap swapKey={period} className="h-full">
            <ActivationSection period={period} />
          </FadeSwap>
        );
      case "modules":
        return <ModulesSection period={period} />;
      case "unitEconomics":
        return <UnitEconomicsSection period={period} />;
      case "usage":
        return <UsageSection period={period} />;
      case "churnReasons":
        return <ChurnReasonsSection period={period} />;
      case "growth":
        return <GrowthSection period={period} />;
      case "composition":
        return <CompositionSection period={period} />;
      case "activity":
        return <ActivitySection period={period} />;
      case "geo":
        return <GeoHealthCard />;
    }
  };

  return (
    <div className="space-y-5">
      <DashboardHero
        eyebrow={adminEyebrow(nowMs)}
        title={`${adminGreeting(nowMs)}${firstName ? `, ${firstName}` : ""}`}
        summary={
          <Suspense fallback={<p>Platform özeti hazırlanıyor…</p>}>
            <HeroSummary period={period} role={role} />
          </Suspense>
        }
        freshness={<DataFreshness asOf={nowMs} />}
        aside={
          <SegmentedControl
            label="Özet dönemi"
            value={String(period)}
            options={PERIODS.map((p) => ({ value: String(p), label: `${p} gün`, href: periodHref("/admin", params, p) }))}
          />
        }
      />

      <Suspense fallback={<KpiGridSkeleton count={6} label="Özet göstergeler yükleniyor" />}>
        <FadeSwap swapKey={period}>
          <KpiStrip period={period} role={role} />
        </FadeSwap>
      </Suspense>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        {sections.map((section) => {
          const body = <Suspense fallback={<SkeletonCard height={SKELETON_HEIGHT[section]} label="Yükleniyor" />}>{render(section)}</Suspense>;
          return (
            <div key={section} className={`min-w-0 md:col-span-6 ${sectionSpan(section, sections)}`}>
              {BELOW_FOLD.has(section) ? <Reveal className="h-full">{body}</Reveal> : body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
