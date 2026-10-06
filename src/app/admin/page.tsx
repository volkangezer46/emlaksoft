import { cache, Suspense, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Gauge,
  LifeBuoy,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformStaff } from "@/lib/platform";
import { daysAgoIso, now, trParts } from "@/lib/clock";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { DataFreshness } from "@/components/ui/data-freshness";
import { PeriodToggle, TrendPill, computeTrend, parsePeriod, type Period } from "@/components/ui/premium";
import { StatRow } from "@/components/ui/stat-row";
import { AreaChart, ChartCard, SkeletonCard } from "@/components/ui/viz";
import { StackedBar } from "@/components/admin/admin-bars";
import { Bx } from "@/components/ui/console/bento";
import { BillingHome } from "./_dashboards/billing-home";
import { SupportHome } from "./_dashboards/support-home";
import { GeoHealthCard } from "./geo/health-card";
import { adminEyebrow, adminGreeting, firstNameOf } from "./_dashboards/shared";
import { getAdminHealth } from "@/lib/admin-badges";
import { getPlatformInsights } from "@/lib/insights/platform-read";
import { PlatformInsightList } from "./_components/platform-insight-list";
import { readLatestEfReconciliation } from "@/lib/ef-credits/reconcile-reader";
import {
  buildAttentionQueue,
  buildChurnRows,
  homeVariantFor,
  platformHomeSections,
  type AttentionInput,
  type HomeSection,
} from "@/lib/admin/dashboard-layout";
import { platformCanAccess, type PlatformRole } from "@/lib/platform-access";
import { auditActionLabel, moneyTRY, relativeTimeTR } from "@/lib/admin-format";
import { planLabel as catalogPlanLabel } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { exactMrr, exactTrendMrr, monthlyPrice, priceMapOf, type PlatformReportingAggregate } from "@/lib/reporting/platform";
import { requireReportingCount, requireReportingData } from "@/lib/reporting/result";

/**
 * Kontrol paneli KPI'ları tam kapsamlı SQL aggregate (anlık görüntü: MRR, aktif,
 * açık destek...). Dönem seçici (?donem=7|30|90) yalnız "yeni ofis" ve "yeni destek
 * talebi" sayımlarını ve önceki dönemle karşılaştırmalarını etkiler; bunlar
 * `created_at` aralığıyla ayrı head-count sorgularıdır. Hepsi paralel, 60 sn
 * `unstable_cache` (argüman = dönem, anahtara dahildir).
 *
 * Dikkat kuyruğu ve churn tablosu için ek (yine paralel) okumalar: ödeme mutabakatı sayımları,
 * aktif/deneme/gecikmiş ofis listesi ve son 14 gün denetim hareketi (tenant listesindeki sağlık
 * rozetiyle aynı kaynak). Okunamayan sayım `null` kalır; sıfır gibi gösterilmez.
 */
const getAdminDashboardData = unstable_cache(
  async (period: number) => {
    const admin = createAdminClient();
    const fromIso = daysAgoIso(period);
    const prevIso = daysAgoIso(period * 2);
    const [aggregateResult, tenantsResult, auditResult, newTenants, prevTenants, newTickets, prevTickets, refundRes, manualRes, churnTenants, activityRes] =
      await Promise.all([
        admin.rpc("platform_reporting_aggregates", { p_from: null, p_to: null, p_as_of: new Date(now()).toISOString() }),
        admin.from("tenants").select("id, name, plan, status, created_at, trial_ends_at").order("created_at", { ascending: false }).limit(5),
        admin.from("audit_logs").select("action, entity_type, actor_id, tenant_id, created_at, tenant:tenants(name)").order("created_at", { ascending: false }).limit(10),
        admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", fromIso),
        admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", prevIso).lt("created_at", fromIso),
        admin.from("support_tickets").select("id", { count: "exact", head: true }).gte("created_at", fromIso),
        admin.from("support_tickets").select("id", { count: "exact", head: true }).gte("created_at", prevIso).lt("created_at", fromIso),
        admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "refund_required"),
        admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "manual_review"),
        admin.from("tenants").select("id, name, status, trial_ends_at").in("status", ["active", "trial", "past_due"]).limit(1000),
        admin.from("audit_logs").select("tenant_id").gte("created_at", daysAgoIso(14)).limit(10000),
      ]);
    const activity: Record<string, number> = {};
    for (const row of activityRes.error ? [] : (activityRes.data ?? [])) {
      const id = (row as { tenant_id: string | null }).tenant_id;
      if (id) activity[id] = (activity[id] ?? 0) + 1;
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
    };
  },
  ["admin-dashboard-v3"],
  { revalidate: 60, tags: ["admin-dashboard"] },
);

/** Aynı istek içinde tüm bölümler tek yükü paylaşır. */
const loadDashboard = cache(async (period: number) => {
  const [data, planDefs] = await Promise.all([getAdminDashboardData(period), getPlanDefinitions()]);
  return { ...data, planDefs };
});

/** Sistem sağlığı + EF mutabakat: dikkat kuyruğu ve sağlık şeridi aynı okumayı paylaşır; okunamazsa null. */
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
  const active = Number(summary.active_count);
  const trial = Number(summary.trial_count);
  const totalTenants = Number(summary.tenant_count);
  return {
    summary,
    active,
    trial,
    totalTenants,
    risk: Number(summary.risk_count),
    openTickets: Number(summary.open_ticket_count),
    urgentTickets: Number(summary.urgent_ticket_count),
    soon: Number(summary.trials_ending_7d),
    demoCount: Number(summary.new_demo_count),
    members: Number(summary.member_count),
    mrr: exactMrr(aggregate.plan_stats, priceMapOf(data.planDefs)),
    conversion: totalTenants ? Math.round((active / totalTenants) * 100) : 0,
  };
}

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function monthLabel(iso: string): string {
  return MONTHS_SHORT[trParts(iso).month] ?? "";
}

function weekLabel(iso: string): string {
  const p = trParts(iso);
  return `${p.day} ${MONTHS_SHORT[p.month] ?? ""}`;
}

/** Odak yüzeyi (dikkat kuyruğu, MRR): --elev-3. Diğer birincil kartlar: --elev-1 (ızgara hücresinde). */
const FOCUS_SHADOW = { boxShadow: "var(--elev-3)" } as const;

async function HeaderSummary({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const parts = [`Son ${period} günde ${data.newTenants} yeni ofis ve ${data.newTickets} yeni destek talebi geldi.`];
  parts.push(
    d.openTickets > 0
      ? `${d.openTickets} açık destek talebi var${d.urgentTickets > 0 ? `, ${d.urgentTickets} tanesi acil` : ""}.`
      : "Açık destek talebi yok.",
  );
  return <p className="mt-1 text-sm text-text-muted">{parts.join(" ")}</p>;
}

async function KpiStrip({ period, role }: { period: Period; role: PlatformRole }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const trendOf = (cur: number, prev: number) => {
    const t = computeTrend(cur, prev);
    return t.dir === "flat" ? `önceki ${prev}` : `${t.label} · önceki ${prev}`;
  };
  return (
    <StatRow
      label="Platform özet göstergeleri"
      items={[
        { label: "Toplam ofis", value: d.totalTenants, href: "/admin/tenants", icon: <Building2 className="h-4 w-4" aria-hidden /> },
        { label: "Aktif abone", value: d.active, href: "/admin/tenants?durum=active", hint: `%${d.conversion} dönüşüm`, icon: <TrendingUp className="h-4 w-4" aria-hidden /> },
        { label: "Deneme", value: d.trial, href: "/admin/tenants?durum=trial", hint: d.soon > 0 ? `${d.soon} yakında bitiyor` : undefined, attention: d.soon > 0, icon: <Sparkles className="h-4 w-4" aria-hidden /> },
        { label: `Yeni ofis · ${period} gün`, value: data.newTenants, href: "/admin/tenants", hint: trendOf(data.newTenants, data.prevTenants), icon: <UserPlus className="h-4 w-4" aria-hidden /> },
        ...(platformCanAccess(role, "tickets")
          ? [{ label: `Yeni destek · ${period} gün`, value: data.newTickets, href: "/admin/tickets", hint: trendOf(data.newTickets, data.prevTickets), icon: <LifeBuoy className="h-4 w-4" aria-hidden /> }]
          : []),
        ...(platformCanAccess(role, "members")
          ? [{ label: "Toplam kullanıcı", value: d.members, href: "/admin/members", hint: `${d.totalTenants} ofiste`, icon: <Users className="h-4 w-4" aria-hidden /> }]
          : []),
      ]}
    />
  );
}

const TONE_TEXT = { danger: "text-danger-600", warn: "text-amber-700", brand: "text-accent-text" } as const;

/** DİKKAT GEREKTİRENLER: rol filtreli, şiddete göre sıralı iş kuyruğu. Her satır sayı + filtreli href. */
async function AttentionSection({ period, role }: { period: Period; role: PlatformRole }) {
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
    risk: d.risk,
    trialsEnding: d.soon,
    demoRequests: d.demoCount,
  };
  const queue = buildAttentionQueue(input, role);
  const insights = await getPlatformInsights({ limit: 5 });
  return (
    <section aria-label="Dikkat gerektirenler" className="bx h-full min-w-0 p-4 sm:p-5" style={FOCUS_SHADOW}>
      <header className="mb-3">
        <p className="bx-eyebrow flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-text-faint" aria-hidden /> Şimdi ne yapmalıyım
        </p>
        <h2 className="mt-0.5 font-display text-base font-bold text-text">Dikkat gerektirenler</h2>
      </header>
      {queue.length > 0 ? (
        <ul className="-mx-1.5">
          {queue.map((q) => (
            <li key={q.id}>
              <Link href={q.href} className="focus-ring group flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-1.5 transition-colors hover:bg-[var(--surface-sunken)]">
                <span className={`num w-9 shrink-0 text-right text-lg font-semibold tabular-nums ${TONE_TEXT[q.tone]}`}>{q.count}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">{q.label}</span>
                  <span className="block truncate text-xs text-text-muted">{q.hint}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition-colors group-hover:text-text" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : insights.length === 0 ? (
        <div className="flex items-center gap-3 py-2 text-sm text-text-muted">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--viz-pos)]" aria-hidden />
          <span>Şu an bekleyen iş yok. Yeni bir durum oluşunca burada sıralanır.</span>
        </div>
      ) : null}
      {/* ATTENTION_INSIGHT_SLOT: gerçek platform içgörüleri (platform_insights, RLS'li okuyucu). Satır yoksa hiçbir şey çizilmez; içgörü UYDURULMAZ. */}
      <PlatformInsightList insights={insights} />
    </section>
  );
}

/** MRR odak metriği: 36-48px tabular değer, önceki dönem farkı, sparkline, href. */
async function MrrSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const rows = data.aggregate.mrr_trend;
  const prices = priceMapOf(data.planDefs);
  const series = rows.map((r) => ({ label: monthLabel(r.month_start), value: exactTrendMrr(r, prices) }));
  const last = series.length >= 2 ? series[series.length - 1]!.value : null;
  const prev = series.length >= 2 ? series[series.length - 2]!.value : null;
  const trend = last !== null && prev !== null ? computeTrend(last, prev) : null;
  const hasCurve = series.length >= 2 && series.some((s) => s.value > 0);
  return (
    <section aria-label="Aylık yinelenen gelir" className="bx h-full min-w-0 p-4 sm:p-5" style={FOCUS_SHADOW}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="bx-eyebrow flex items-center gap-1.5">
            <Wallet className="h-4 w-4 text-[var(--pm-gold-text)]" aria-hidden /> Aylık yinelenen gelir
          </p>
          <Link href="/admin/billing" className="focus-ring mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-control)]">
            <span className="num text-[2.5rem] font-semibold leading-none tabular-nums text-text">{moneyTRY(d.mrr)}</span>
            {trend ? <TrendPill trend={trend} /> : null}
          </Link>
          <p className="mt-1.5 text-sm text-text-muted">
            Yıllık {moneyTRY(d.mrr * 12)}
            {prev !== null ? ` · önceki ay sonu ${moneyTRY(prev)}` : ""}
          </p>
        </div>
        <Link href="/admin/billing" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1 text-xs font-semibold text-accent-text transition-colors hover:text-text">
          Gelir ayrıntısı <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <div className="mt-4" style={{ minHeight: 96 }}>
        {hasCurve ? (
          <AreaChart
            series={[{ name: "Aylık yinelenen gelir", values: series.map((s) => s.value), tone: "gold" }]}
            pointLabels={series.map((s) => s.label)}
            formatValue={moneyTRY}
            height={96}
            ariaLabel={`Son ${series.length} ay aylık yinelenen gelir`}
            href="/admin/billing"
          />
        ) : (
          <EmptyStateV3 variant="compact" title="Gelir eğrisi için veri birikiyor" description="En az iki aylık abonelik kaydı oluşunca eğri burada çizilir." />
        )}
      </div>
    </section>
  );
}

/** Churn riski: yalnız mevcut veriyle (durum, deneme bitişi, 14 gün denetim hareketi). Veri yoksa boş durum. */
async function ChurnSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const rows = buildChurnRows(data.churnTenants, new Map(Object.entries(data.activity)), now());
  return (
    <Bx className="h-full" eyebrow="Churn riski" icon={AlertTriangle} title="Elde tutma gerektiren ofisler" href="/admin/tenants?durum=past_due" hrefLabel="Tüm riskli ofisler">
      {rows.length === 0 ? (
        <EmptyStateV3 variant="compact" title="Churn sinyali olan ofis yok" description="Ödeme gecikmesi, biten deneme veya 14 gündür hareketsiz ofis olursa burada listelenir." />
      ) : (
        <div className="-mx-1.5 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm tabular-nums">
            <caption className="sr-only">Churn riski olan ofisler ve sinyalleri</caption>
            <thead>
              <tr className="text-xs text-text-faint">
                <th scope="col" className="px-1.5 pb-1 font-medium">Ofis</th>
                <th scope="col" className="px-1.5 pb-1 font-medium">Sinyaller</th>
                <th scope="col" className="px-1.5 pb-1 text-right font-medium">14 gün hareket</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-10 transition-colors hover:bg-[var(--surface-sunken)]">
                  <td className="max-w-[14rem] truncate px-1.5">
                    <Link href={r.href} className="focus-ring rounded-[var(--radius-control)] font-medium text-text hover:text-accent-text">{r.name}</Link>
                  </td>
                  <td className="px-1.5 text-xs text-text-muted">{r.signals.map((s) => s.label).join(" · ")}</td>
                  <td className="px-1.5 text-right font-semibold text-text">{r.activity14d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Bx>
  );
}

/** Sistem sağlığı şeridi: zamanlanmış işler + veritabanı yanıtı + EF mutabakat (yetkiliye). */
async function HealthSection({ period, role }: { period: Period; role: PlatformRole }) {
  void period;
  const sys = await loadSystemSignals(platformCanAccess(role, "billing"));
  const h = sys.health;
  const cells: { label: string; value: string; hint?: string; href: string; bad?: boolean }[] = [];
  if (!h) {
    cells.push({ label: "Sistem durumu", value: "Okunamadı", hint: "Sağlık sorgusu yanıt vermedi", href: "/admin/sistem", bad: true });
  } else {
    const ok = h.cronTotal !== null && h.cronErrors !== null ? h.cronTotal - h.cronErrors : null;
    cells.push({
      label: "Zamanlanmış işler",
      value: ok === null ? "Okunamadı" : `${ok}/${h.cronTotal}`,
      hint: h.cronErrors ? `${h.cronErrors} iş hatalı${h.failedJobs?.length ? `: ${h.failedJobs.join(", ")}` : ""}` : "Hepsi sağlıklı",
      href: "/admin/sistem",
      bad: Boolean(h.cronErrors) || ok === null,
    });
    cells.push({ label: "Veritabanı yanıtı", value: `${h.dbMs} ms`, hint: h.ok ? "Sorgular hatasız" : "Sorgu hatası var", href: "/admin/sistem", bad: !h.ok });
    cells.push({ label: "Son cron çalışması", value: h.lastCronAt ? relativeTimeTR(h.lastCronAt) : "Kayıt yok", href: "/admin/sistem" });
  }
  if (platformCanAccess(role, "billing") && sys.ef) {
    cells.push({
      label: "EF mutabakatı",
      value: sys.ef.status === "ok" ? "Uyumlu" : sys.ef.status === "drift" ? "Sapma var" : "Yapılamadı",
      hint: relativeTimeTR(sys.ef.runAt),
      href: "/admin/ef-kontor",
      bad: sys.ef.status !== "ok",
    });
  }
  return (
    <Bx className="h-full" eyebrow="Sistem sağlığı" icon={Gauge} title="Platform durumu" href="/admin/sistem" hrefLabel="Ayrıntı">
      <ul className="-mx-1.5">
        {cells.map((c) => (
          <li key={c.label}>
            <Link href={c.href} className="focus-ring flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] px-1.5 transition-colors hover:bg-[var(--surface-sunken)]">
              <span className="min-w-0">
                <span className="block text-sm text-text">{c.label}</span>
                {c.hint ? <span className="block truncate text-xs text-text-muted">{c.hint}</span> : null}
              </span>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${c.bad ? "text-danger-600" : "text-text"}`}>{c.value}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Bx>
  );
}

/** Büyüme grafikleri (ikincil): haftalık yeni ofis ve yeni aktif abonelik, ortak AreaChart. */
async function GrowthSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const weekly = data.aggregate.weekly;
  const labels = weekly.map((w) => weekLabel(w.week_start));
  const offices = weekly.map((w) => Number(w.tenants));
  const subs = weekly.map((w) => Number(w.active_subscriptions));
  const thisWeek = offices.length ? offices[offices.length - 1]! : 0;
  const hasData = weekly.length >= 2 && (offices.some((v) => v > 0) || subs.some((v) => v > 0));
  return (
    <ChartCard
      title={`Büyüme · bu hafta +${thisWeek} ofis`}
      subtitle="Haftalık yeni ofis ve yeni aktif abonelik"
      period="Son 8 hafta"
      href="/admin/tenants"
      hrefLabel="Ofisler"
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
        pointLabels={labels}
        height={140}
        ariaLabel={`Son ${weekly.length} hafta yeni ofis ve yeni aktif abonelik`}
        href="/admin/tenants"
      />
    </ChartCard>
  );
}

/** Gelir kompozisyonu: plan bazında MRR payı, tek yığılmış çubuk. */
async function CompositionSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const { aggregate } = data;
  // Gizli planlar (örn. Business) dahil: bu planda ofisi olan hiçbir satır sessizce düşmez.
  const shownPlans = data.planDefs.filter(
    (p) => !p.hidden || Number(aggregate.plan_stats.find((r) => r.plan === p.id)?.tenant_count ?? 0) > 0,
  );
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
    <Bx className="h-full" eyebrow="Gelir kompozisyonu" icon={Wallet} title="Plan bazında MRR" href="/admin/billing">
      {total > 0 ? (
        <StackedBar rows={rows} format={moneyTRY} ariaLabel="Plan bazında aylık yinelenen gelir payı" />
      ) : (
        <EmptyStateV3 variant="compact" title="Henüz gelir getiren plan yok" description="Aktif abonelikler oluştukça plan bazında dağılım burada görünür." />
      )}
    </Bx>
  );
}

/** Son ofisler + aktivite akışı: diğer bloklarla aynı kart dili (pm-c1), 40 px satır. */
async function ActivitySection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const list = data.tenants;
  const auditRows = data.audit;
  return (
    <section aria-label="Son hareketler" className="grid gap-4 md:grid-cols-2">
      <div className="pm-c1 min-w-0 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-text">Son ofisler</h2>
          <Link href="/admin/tenants" className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-accent-text hover:text-text">Tümü</Link>
        </div>
        {list.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Henüz ofis yok" description="Yeni kayıtlar burada listelenir." />
        ) : (
          <ul className="-mx-1.5">
            {list.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link href={`/admin/tenants/${t.id}`} className="focus-ring flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-1.5 transition-colors hover:bg-[var(--surface-sunken)]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{t.name}</span>
                    <span className="block truncate text-xs text-text-muted">{catalogPlanLabel(t.plan)} · {statusLabel[t.status] ?? t.status}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-faint">{relativeTimeTR(t.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pm-c1 min-w-0 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 font-display text-sm font-bold text-text"><Activity className="h-4 w-4 text-text-faint" aria-hidden /> Platform aktivite akışı</h2>
          <Link href="/admin/aktivite" className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-accent-text hover:text-text">Tümü</Link>
        </div>
        {auditRows.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Henüz hareket kaydı yok" description="Platformdaki işlemler burada akar." />
        ) : (
          <ul className="-mx-1.5">
            {auditRows.slice(0, 5).map((a, i) => {
              const tenantName = Array.isArray(a.tenant) ? a.tenant[0]?.name : (a.tenant as { name?: string } | null)?.name;
              return (
                <li key={i}>
                  <Link href={a.tenant_id ? `/admin/tenants/${a.tenant_id}` : "/admin/aktivite"} className="focus-ring flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-1.5 transition-colors hover:bg-[var(--surface-sunken)]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{auditActionLabel(a.action)}</span>
                      <span className="block truncate text-xs text-text-muted">{tenantName ?? "Platform"} · {a.entity_type ?? "sistem"}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-text-faint">{relativeTimeTR(a.created_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Bölüm → ızgara genişliği ve sabit iskelet yüksekliği (CLS yok). Genişlik role göre (saf kural). */
function sectionSpan(section: HomeSection, sections: readonly HomeSection[]): string {
  const has = (s: HomeSection) => sections.includes(s);
  switch (section) {
    case "attention":
      return has("mrr") ? "xl:col-span-5" : "xl:col-span-7";
    case "mrr":
      return "xl:col-span-7";
    case "churn":
      return "xl:col-span-7";
    case "health":
      return "xl:col-span-5";
    case "growth":
      return has("composition") ? "xl:col-span-7" : "xl:col-span-5";
    case "composition":
      return "xl:col-span-5";
    default:
      return "xl:col-span-12";
  }
}

const SKELETON_HEIGHT: Record<HomeSection, number> = {
  attention: 304,
  mrr: 304,
  churn: 360,
  health: 220,
  growth: 268,
  composition: 268,
  activity: 268,
  geo: 200,
};

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

  const render = (section: HomeSection): ReactNode => {
    switch (section) {
      case "attention":
        return <AttentionSection period={period} role={role} />;
      case "mrr":
        return <MrrSection period={period} />;
      case "churn":
        return <ChurnSection period={period} />;
      case "health":
        return <HealthSection period={period} role={role} />;
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="bx-eyebrow">{adminEyebrow(nowMs)}</p>
          <h1 className="mt-0.5 font-display text-2xl font-extrabold text-text">
            {adminGreeting(nowMs)}
            {firstNameOf(staff.full_name) ? `, ${firstNameOf(staff.full_name)}` : ""}
          </h1>
          <Suspense fallback={<p className="mt-1 text-sm text-text-muted">Platform özeti hazırlanıyor…</p>}>
            <HeaderSummary period={period} />
          </Suspense>
          <DataFreshness asOf={nowMs} className="mt-1.5" />
        </div>
        <PeriodToggle current={period} basePath="/admin" params={params} label="Özet dönemi" />
      </header>

      <Suspense fallback={<SkeletonCard height={76} label="Özet göstergeler yükleniyor" />}>
        <KpiStrip period={period} role={role} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        {sections.map((section) => (
          <div key={section} className={`min-w-0 md:col-span-6 [&>section.bx]:shadow-[var(--elev-1)] ${sectionSpan(section, sections)}`}>
            <Suspense fallback={<SkeletonCard height={SKELETON_HEIGHT[section]} label="Yükleniyor" />}>{render(section)}</Suspense>
          </div>
        ))}
      </div>
    </div>
  );
}
