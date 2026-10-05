import { cache, Suspense } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  Handshake,
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
import {
  GlassKpi,
  HeroBanner,
  KpiCard,
  PeriodToggle,
  TrendPill,
  computeTrend,
  parsePeriod,
  type Period,
} from "@/components/ui/premium";
import { AreaChart } from "@/components/ui/console/area-chart";
import { BarChart } from "@/components/ui/console/bar-chart";
import { Bento, Bx, QueueList, type QueueItem } from "@/components/ui/console/bento";
import { Ring } from "@/components/ui/console/ring";
import { BillingHome } from "./_dashboards/billing-home";
import { SupportHome } from "./_dashboards/support-home";
import { GeoHealthCard } from "./geo/health-card";
import { platformCanAccess } from "@/lib/platform-access";
import { GlassSkeleton, KpiGridSkeleton, adminEyebrow, adminGreeting, firstNameOf } from "./_dashboards/shared";
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
 */
const getAdminDashboardData = unstable_cache(
  async (period: number) => {
    const admin = createAdminClient();
    const fromIso = daysAgoIso(period);
    const prevIso = daysAgoIso(period * 2);
    const [aggregateResult, tenantsResult, auditResult, newTenants, prevTenants, newTickets, prevTickets] = await Promise.all([
      admin.rpc("platform_reporting_aggregates", { p_from: null, p_to: null, p_as_of: new Date(now()).toISOString() }),
      admin.from("tenants").select("id, name, plan, status, created_at, trial_ends_at").order("created_at", { ascending: false }).limit(5),
      admin.from("audit_logs").select("action, entity_type, actor_id, tenant_id, created_at, tenant:tenants(name)").order("created_at", { ascending: false }).limit(10),
      admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", fromIso),
      admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", prevIso).lt("created_at", fromIso),
      admin.from("support_tickets").select("id", { count: "exact", head: true }).gte("created_at", fromIso),
      admin.from("support_tickets").select("id", { count: "exact", head: true }).gte("created_at", prevIso).lt("created_at", fromIso),
    ]);
    return {
      aggregate: requireReportingData("platform-dashboard-aggregates", aggregateResult) as unknown as PlatformReportingAggregate,
      tenants: requireReportingData("platform-recent-tenants", tenantsResult),
      audit: requireReportingData("platform-recent-activity", auditResult),
      newTenants: requireReportingCount("platform-new-tenants", newTenants),
      prevTenants: requireReportingCount("platform-prev-tenants", prevTenants),
      newTickets: requireReportingCount("platform-new-tickets", newTickets),
      prevTickets: requireReportingCount("platform-prev-tickets", prevTickets),
    };
  },
  ["admin-dashboard-v2"],
  { revalidate: 60, tags: ["admin-dashboard"] },
);

/** Aynı istek içinde hero, KPI ve ayrıntı bölümleri tek yükü paylaşır. */
const loadDashboard = cache(async (period: number) => {
  const [data, planDefs] = await Promise.all([getAdminDashboardData(period), getPlanDefinitions()]);
  return { ...data, planDefs };
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

async function HeroSummary({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const parts = [`Son ${period} günde ${data.newTenants} yeni ofis ve ${data.newTickets} yeni destek talebi geldi.`];
  parts.push(
    d.openTickets > 0
      ? `${d.openTickets} açık destek talebi var${d.urgentTickets > 0 ? `, ${d.urgentTickets} tanesi acil` : ""}.`
      : "Açık destek talebi yok.",
  );
  if (d.demoCount > 0) parts.push(`${d.demoCount} demo talebi yanıt bekliyor.`);
  return <p>{parts.join(" ")}</p>;
}

async function HeroKpis({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const weekly = data.aggregate.weekly;
  return (
    <>
      <GlassKpi
        label="Aylık yinelenen gelir"
        value={moneyTRY(d.mrr)}
        sub={`Yıllık ${moneyTRY(d.mrr * 12)}`}
        href="/admin/billing"
        icon={Wallet}
        series={data.aggregate.mrr_trend.map((row) => exactTrendMrr(row, priceMapOf(data.planDefs)))}
        seriesUnit="ay"
        seriesLabel="Son 12 ay aylık yinelenen gelir"
      />
      <GlassKpi
        label="Aktif ofis"
        value={d.active}
        sub={`${d.trial} deneme · ${d.totalTenants} toplam`}
        href="/admin/tenants?durum=active"
        icon={Building2}
        series={weekly.map((w) => Number(w.active_subscriptions))}
        seriesUnit="hafta"
        seriesLabel="Son 8 hafta yeni aktif abonelik"
      />
      <GlassKpi
        label="Açık destek"
        value={d.openTickets}
        sub={d.urgentTickets > 0 ? `${d.urgentTickets} acil` : "Acil talep yok"}
        subTone={d.urgentTickets > 0 ? "danger" : undefined}
        href="/admin/tickets?durum=open"
        icon={LifeBuoy}
        series={weekly.map((w) => Number(w.tickets))}
        seriesUnit="hafta"
        seriesLabel="Son 8 hafta yeni destek talebi"
      />
      <GlassKpi
        label="Toplam kullanıcı"
        value={d.members}
        sub={`${d.totalTenants} ofiste`}
        href="/admin/members"
        icon={Users}
      />
    </>
  );
}

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function monthLabel(iso: string): string {
  return MONTHS_SHORT[trParts(iso).month] ?? "";
}

function weekLabel(iso: string): string {
  const p = trParts(iso);
  return `${p.day} ${MONTHS_SHORT[p.month] ?? ""}`;
}

/** Üst bento: MRR (birincil KPI + 12 aylık eğri) ve "dikkat bekleyenler" kuyruğu. */
async function Overview({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const mrrRows = data.aggregate.mrr_trend;
  const mrrSeries = mrrRows.map((r) => ({ label: monthLabel(r.month_start), value: exactTrendMrr(r, priceMapOf(data.planDefs)) }));
  const last = mrrSeries.length >= 2 ? mrrSeries[mrrSeries.length - 1]!.value : null;
  const prev = mrrSeries.length >= 2 ? mrrSeries[mrrSeries.length - 2]!.value : null;
  const trend = last !== null && prev !== null ? computeTrend(last, prev) : null;

  const queue = ([
    d.risk > 0 ? { href: "/admin/tenants?durum=past_due", icon: AlertTriangle, tone: "danger", count: d.risk, label: "Riskli ofis", hint: "Gecikmiş veya askıda; inceleyin" } : null,
    d.urgentTickets > 0 ? { href: "/admin/tickets?oncelik=urgent", icon: LifeBuoy, tone: "warn", count: d.urgentTickets, label: "Acil destek talebi", hint: "Yanıt bekliyor" } : null,
    d.demoCount > 0 ? { href: "/admin/satis", icon: Handshake, tone: "brand", count: d.demoCount, label: "Yeni demo talebi", hint: "Satış fırsatı, yanıt bekliyor" } : null,
    d.soon > 0 ? { href: "/admin/tenants?durum=trial", icon: Sparkles, tone: "brand", count: d.soon, label: "Deneme 7 gün içinde bitiyor", hint: "Dönüşüm fırsatı" } : null,
  ] as (QueueItem | null)[]).filter((q): q is QueueItem => q !== null);

  return (
    <Bento>
      <section className="bx min-w-0 p-4 sm:p-5 md:col-span-6 xl:col-span-7" aria-label="Aylık yinelenen gelir">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="bx-eyebrow flex items-center gap-1.5">
              <Wallet className="h-4 w-4 text-[var(--pm-gold-text)]" aria-hidden /> Aylık yinelenen gelir
            </p>
            <Link href="/admin/billing" className="focus-ring mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-control)]">
              <span className="num text-4xl leading-tight text-text">{moneyTRY(d.mrr)}</span>
              {trend ? <TrendPill trend={trend} /> : null}
            </Link>
            <p className="mt-0.5 text-sm text-text-muted">
              Yıllık {moneyTRY(d.mrr * 12)}
              {prev !== null ? ` · geçen ay sonu ${moneyTRY(prev)}` : ""}
            </p>
          </div>
          <Link href="/admin/billing" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1 text-xs font-semibold text-accent-text transition-colors hover:text-text">
            Gelir ayrıntısı <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <div className="mt-4">
          {mrrSeries.length >= 2 ? (
            <AreaChart
              id="adminMrrArea"
              tone="gold"
              data={mrrSeries}
              format={moneyTRY}
              ariaLabel={`Son ${mrrSeries.length} ay aylık yinelenen gelir`}
            />
          ) : (
            <EmptyStateV3 variant="compact" title="Gelir eğrisi için veri birikiyor" description="En az iki aylık abonelik kaydı oluşunca eğri burada çizilir." />
          )}
        </div>
      </section>

      <Bx className="md:col-span-6 xl:col-span-5" eyebrow="Önceliklendirilmiş" icon={AlertTriangle} title="Dikkat bekleyenler">
        {queue.length > 0 ? (
          <QueueList items={queue} />
        ) : (
          <EmptyStateV3 variant="compact" title="Bekleyen acil iş yok" description="Riskli ofis, acil destek, yeni demo talebi ve biten deneme yok." />
        )}
        <div className="mt-3 border-t border-hairline pt-3">
          <QueueList
            items={[
              { href: "/admin/tickets?durum=open", icon: LifeBuoy, label: "Açık destek kuyruğu", count: d.openTickets },
              { href: "/admin/tenants?durum=trial", icon: Sparkles, label: "Deneme aşamasındaki ofisler", count: d.trial },
            ]}
          />
        </div>
      </Bx>
    </Bento>
  );
}

async function KpiGrid({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const weekly = data.aggregate.weekly;
  const thisWeek = weekly.length ? Number(weekly[weekly.length - 1]!.tenants) : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        label="Toplam ofis"
        value={d.totalTenants}
        href="/admin/tenants"
        icon={Building2}
        tone="brand"
        hint={`+${thisWeek} bu hafta`}
        series={weekly.map((w) => Number(w.tenants))}
        chart="bars"
        seriesUnit="hafta"
        seriesLabel="Son 8 hafta yeni ofis"
      />
      <KpiCard
        label={`Yeni ofis · ${period} gün`}
        value={data.newTenants}
        href="/admin/tenants"
        icon={UserPlus}
        tone="success"
        trend={computeTrend(data.newTenants, data.prevTenants)}
        previousText={`Önceki ${period} gün ${data.prevTenants}`}
      />
      <KpiCard
        label="Aktif abone"
        value={d.active}
        href="/admin/tenants?durum=active"
        icon={TrendingUp}
        tone="success"
        hint={`%${d.conversion} dönüşüm`}
        series={weekly.map((w) => Number(w.active_subscriptions))}
        seriesUnit="hafta"
        seriesLabel="Son 8 hafta yeni aktif abonelik"
      />
      <KpiCard
        label="Deneme"
        value={d.trial}
        href="/admin/tenants?durum=trial"
        icon={Sparkles}
        tone="brand"
        hint={d.soon > 0 ? `${d.soon} yakında bitiyor` : "Yakında biten deneme yok"}
        attention={d.soon > 0}
        series={weekly.map((w) => Number(w.trials))}
        seriesUnit="hafta"
        seriesLabel="Son 8 hafta yeni deneme"
      />
      <KpiCard
        label={`Yeni destek talebi · ${period} gün`}
        value={data.newTickets}
        href="/admin/tickets"
        icon={Activity}
        tone="neutral"
        trend={computeTrend(data.newTickets, data.prevTickets, true)}
        previousText={`Önceki ${period} gün ${data.prevTickets}`}
        series={weekly.map((w) => Number(w.tickets))}
        chart="bars"
        seriesUnit="hafta"
        seriesLabel="Son 8 hafta yeni destek talebi"
      />
      <KpiCard
        label="Riskli ofis"
        value={d.risk}
        href="/admin/tenants?durum=past_due"
        icon={AlertTriangle}
        tone={d.risk > 0 ? "danger" : "success"}
        attention={d.risk > 0}
        hint={d.risk > 0 ? "Gecikmiş veya askıda" : "Riskli ofis yok"}
      />
    </div>
  );
}

async function Details({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const { aggregate } = data;
  const list = data.tenants;
  const auditRows = data.audit;

  const weeklySeries = aggregate.weekly.map((row) => ({
    label: weekLabel(row.week_start),
    value: Number(row.tenants),
    href: "/admin/tenants",
  }));
  const thisWeek = weeklySeries.length ? weeklySeries[weeklySeries.length - 1]!.value : 0;

  // Gizli planlar (örn. Business) dahil: bu planda ofisi olan hiçbir satır sessizce düşmez.
  const shownPlans = data.planDefs.filter(
    (p) => !p.hidden || Number(aggregate.plan_stats.find((r) => r.plan === p.id)?.tenant_count ?? 0) > 0,
  );
  const planCounts = shownPlans.map((plan) => ({
    label: plan.name,
    value: Number(aggregate.plan_stats.find((row) => row.plan === plan.id)?.tenant_count ?? 0),
    href: `/admin/tenants?plan=${plan.id}`,
  }));
  const hasPlans = planCounts.some((p) => p.value > 0);

  // Plan bazında MRR: gerçek abonelik MRR'ı + aboneliği eksik aktif ofisler için katalog fiyatı (exactMrr ile aynı kural).
  const planMrr = shownPlans.map((plan) => {
    const row = aggregate.plan_stats.find((r) => r.plan === plan.id);
    const missing = row ? Math.max(0, Number(row.active_count) - Number(row.subscription_count)) : 0;
    return {
      id: plan.id,
      label: plan.name,
      mrr: row ? Math.round(Number(row.subscription_mrr) + missing * monthlyPrice(plan.id, priceMapOf(data.planDefs))): 0,
      offices: row ? Number(row.tenant_count) : 0,
    };
  });
  const planMrrTotal = planMrr.reduce((n, p) => n + p.mrr, 0);
  const activeSeries = aggregate.weekly.map((row) => ({ label: weekLabel(row.week_start), value: Number(row.active_subscriptions) }));

  const funnel = [
    { label: "Toplam kayıt", href: "/admin/tenants", value: d.totalTenants, tone: "bg-brand-500" },
    { label: "Deneme", href: "/admin/tenants?durum=trial", value: d.trial, tone: "bg-cyan-400" },
    { label: "Aktif abone", href: "/admin/tenants?durum=active", value: d.active, tone: "bg-mint-500" },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  return (
    <Bento>
      <Bx className="md:col-span-6 xl:col-span-5" eyebrow="Kazanım hunisi" icon={TrendingUp} title="Kayıt → aktif dönüşüm">
        <div className="flex flex-wrap items-center gap-5">
          <Link href="/admin/tenants?durum=active" aria-label={`Aktif abonelik dönüşümü yüzde ${d.conversion}`} className="focus-ring rounded-full">
            <Ring value={d.active} max={d.totalTenants} tone="success" ariaLabel={`${d.totalTenants} ofisin ${d.active} tanesi aktif abone`}>
              <span>
                <span className="num block text-xl text-text">%{d.conversion}</span>
                <span className="block text-xs text-text-muted">dönüşüm</span>
              </span>
            </Ring>
          </Link>
          <div className="min-w-0 flex-1 basis-48 space-y-3">
            {funnel.map((f, i) => (
              <Link key={f.label} href={f.href} className="focus-ring group block rounded-[var(--radius-control)]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-text transition-colors group-hover:text-accent-text">{f.label}</span>
                  <span className="num text-text-muted">{f.value}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                  <div className={`bar-live h-full rounded-full ${f.tone}`} style={{ width: `${Math.max((f.value / funnelMax) * 100, 4)}%`, animationDelay: `${i * 0.1}s` }} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </Bx>

      <Bx className="md:col-span-6 xl:col-span-7" eyebrow="Ofis büyümesi · 8 hafta" icon={Activity} title={`Haftalık yeni ofis · bu hafta +${thisWeek}`} href="/admin/tenants">
        {weeklySeries.length >= 2 ? (
          <BarChart data={weeklySeries} ariaLabel={`Son ${weeklySeries.length} hafta yeni ofis sayısı`} height={110} />
        ) : (
          <EmptyStateV3 variant="compact" title="Henüz haftalık seri yok" description="Yeni ofis kayıtları geldikçe grafik burada görünür." />
        )}
      </Bx>

      <Bx className="md:col-span-3 xl:col-span-4" eyebrow="Paket dağılımı" icon={Building2} title="Plan karışımı" href="/admin/tenants">
        {hasPlans ? (
          <BarChart data={planCounts} ariaLabel="Plana göre ofis sayısı" height={110} highlightLast={false} />
        ) : (
          <EmptyStateV3 variant="compact" title="Henüz planlı ofis yok" description="Ofisler paket seçtikçe dağılım burada görünür." />
        )}
      </Bx>

      <Bx className="md:col-span-6 xl:col-span-6" eyebrow="Gelir kompozisyonu" icon={Wallet} title="Plan bazında MRR" href="/admin/billing">
        {planMrrTotal > 0 ? (
          <ul className="space-y-3">
            {planMrr.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/tenants?plan=${p.id}`} className="focus-ring group block rounded-[var(--radius-control)]">
                  <span className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-text transition-colors group-hover:text-accent-text">
                      {p.label} <span className="font-normal text-text-muted">· {p.offices} ofis</span>
                    </span>
                    <span className="num text-text">{moneyTRY(p.mrr)}</span>
                  </span>
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                    <span className="bar-live block h-full rounded-full bg-brand-500" style={{ width: `${Math.max((p.mrr / planMrrTotal) * 100, p.mrr > 0 ? 3 : 0)}%` }} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyStateV3 variant="compact" title="Henüz gelir getiren plan yok" description="Aktif abonelikler oluştukça plan bazında dağılım burada görünür." />
        )}
      </Bx>

      <Bx className="md:col-span-6 xl:col-span-6" eyebrow="Abonelik ivmesi · 8 hafta" icon={TrendingUp} title="Haftalık yeni aktif abonelik" href="/admin/tenants?durum=active">
        {activeSeries.length >= 2 ? (
          <AreaChart id="adminActiveArea" tone="accent" data={activeSeries} ariaLabel={`Son ${activeSeries.length} hafta yeni aktif abonelik sayısı`} />
        ) : (
          <EmptyStateV3 variant="compact" title="Henüz haftalık seri yok" description="Yeni abonelikler geldikçe eğri burada çizilir." />
        )}
      </Bx>

      <Bx className="md:col-span-3 xl:col-span-4" eyebrow="Canlı kayıtlar" icon={Users} title="Son ofisler" href="/admin/tenants">
        {list.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Henüz ofis yok" description="Yeni kayıtlar burada listelenir." />
        ) : (
          <ul className="-mx-1 space-y-0.5">
            {list.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link href={`/admin/tenants/${t.id}`} className="qrow focus-ring group">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{t.name}</span>
                    <span className="block truncate text-xs text-text-muted">{catalogPlanLabel(t.plan)} · {statusLabel[t.status] ?? t.status}</span>
                  </span>
                  <span className="shrink-0 text-xs text-text-faint">{relativeTimeTR(t.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Bx>

      <Bx className="md:col-span-6 xl:col-span-4" eyebrow="Son hareketler" icon={Activity} title="Platform aktivite akışı" href="/admin/aktivite">
        {auditRows.length === 0 ? (
          <EmptyStateV3 variant="compact" title="Henüz hareket kaydı yok" description="Platformdaki işlemler burada akar." />
        ) : (
          <ul className="-mx-1 space-y-0.5">
            {auditRows.slice(0, 6).map((a, i) => {
              const tenantName = Array.isArray(a.tenant) ? a.tenant[0]?.name : (a.tenant as { name?: string } | null)?.name;
              return (
                <li key={i}>
                  <Link href={a.tenant_id ? `/admin/tenants/${a.tenant_id}` : "/admin/aktivite"} className="qrow focus-ring group">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{auditActionLabel(a.action)}</span>
                      <span className="block truncate text-xs text-text-muted">{tenantName ?? "Platform"} · {a.entity_type ?? "sistem"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-text-faint">{relativeTimeTR(a.created_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Bx>
    </Bento>
  );
}

function DetailsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-6 xl:grid-cols-12" aria-hidden="true">
      <div className="bx h-52 animate-pulse md:col-span-6 xl:col-span-5" />
      <div className="bx h-52 animate-pulse md:col-span-6 xl:col-span-7" />
      <div className="bx h-56 animate-pulse md:col-span-3 xl:col-span-4" />
      <div className="bx h-56 animate-pulse md:col-span-3 xl:col-span-4" />
      <div className="bx h-56 animate-pulse md:col-span-6 xl:col-span-4" />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-6 xl:grid-cols-12" aria-hidden="true">
      <div className="bx h-72 animate-pulse md:col-span-6 xl:col-span-7" />
      <div className="bx h-72 animate-pulse md:col-span-6 xl:col-span-5" />
    </div>
  );
}

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requirePlatformStaff();

  // Departmana özel açılış ekranı — aynı /admin adresi, role göre farklı panel.
  if (staff.role === "billing") return <BillingHome staffName={staff.full_name} />;
  if (staff.role === "support") return <SupportHome staffName={staff.full_name} />;

  const sp = (await searchParams) ?? {};
  const period = parsePeriod(sp.donem);
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) params[k] = Array.isArray(v) ? v[0] : v;

  const nowMs = now();

  return (
    <div className="space-y-5">
      <HeroBanner
        eyebrow={adminEyebrow(nowMs)}
        title={adminGreeting(nowMs)}
        highlight={firstNameOf(staff.full_name)}
        summary={
          <Suspense fallback={<p>Platform özeti hazırlanıyor…</p>}>
            <HeroSummary period={period} />
          </Suspense>
        }
        actions={<PeriodToggle current={period} basePath="/admin" params={params} label="Özet dönemi" />}
      >
        <Suspense fallback={<GlassSkeleton />}>
          <HeroKpis period={period} />
        </Suspense>
      </HeroBanner>

      <Suspense fallback={<OverviewSkeleton />}>
        <Overview period={period} />
      </Suspense>

      <Suspense fallback={<KpiGridSkeleton count={6} />}>
        <KpiGrid period={period} />
      </Suspense>

      <Suspense fallback={<DetailsSkeleton />}>
        <Details period={period} />
      </Suspense>

      {platformCanAccess(staff.role, "geo") ? (
        <Suspense fallback={<GlassSkeleton />}>
          <GeoHealthCard />
        </Suspense>
      ) : null}
    </div>
  );
}
