import { cache, Suspense, type CSSProperties } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CreditCard,
  Handshake,
  LifeBuoy,
  MapPin,
  Radar,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformStaff } from "@/lib/platform";
import { daysAgoIso, now } from "@/lib/clock";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import {
  GlassKpi,
  HeroBanner,
  KpiCard,
  PeriodToggle,
  computeTrend,
  parsePeriod,
  type Period,
} from "@/components/ui/premium";
import { BillingHome } from "./_dashboards/billing-home";
import { SupportHome } from "./_dashboards/support-home";
import { GlassSkeleton, KpiGridSkeleton, adminEyebrow, adminGreeting, firstNameOf } from "./_dashboards/shared";
import { auditActionLabel, moneyTRY, relativeTimeTR } from "@/lib/admin-format";
import { planLabel as catalogPlanLabel, PLANS } from "@/lib/billing/plans";
import { exactMrr, exactTrendMrr, type PlatformReportingAggregate } from "@/lib/reporting/platform";
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
const loadDashboard = cache((period: number) => getAdminDashboardData(period));

const statusLabel: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" };

type Data = Awaited<ReturnType<typeof getAdminDashboardData>>;

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
    mrr: exactMrr(aggregate.plan_stats),
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
        series={data.aggregate.mrr_trend.map(exactTrendMrr)}
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

async function KpiGrid({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const { aggregate } = data;
  const weekly = aggregate.weekly;
  const mrrRows = aggregate.mrr_trend;
  const lastMrr = mrrRows.length >= 2 ? exactTrendMrr(mrrRows[mrrRows.length - 1]!) : null;
  const prevMrr = mrrRows.length >= 2 ? exactTrendMrr(mrrRows[mrrRows.length - 2]!) : null;
  const thisWeek = weekly.length ? Number(weekly[weekly.length - 1]!.tenants) : 0;

  const alerts = [
    d.demoCount > 0 ? { href: "/admin/satis", tone: "brand", icon: Handshake, text: `${d.demoCount} yeni demo talebi yanıt bekliyor — satış fırsatı.` } : null,
    d.risk > 0 ? { href: "/admin/tenants?durum=past_due", tone: "danger", icon: AlertTriangle, text: `${d.risk} ofis risk altında (gecikmiş/askıda) — inceleyin.` } : null,
    d.urgentTickets > 0 ? { href: "/admin/tickets?oncelik=urgent", tone: "amber", icon: LifeBuoy, text: `${d.urgentTickets} acil destek talebi yanıt bekliyor.` } : null,
    d.soon > 0 ? { href: "/admin/tenants?durum=trial", tone: "brand", icon: Sparkles, text: `${d.soon} deneme önümüzdeki 7 gün içinde sona eriyor — dönüşüm fırsatı.` } : null,
  ].filter(Boolean) as { href: string; tone: string; icon: typeof AlertTriangle; text: string }[];

  return (
    <div className="space-y-5">
      {alerts.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.map((a) => (
            <Link
              key={a.text}
              href={a.href}
              className={`focus-ring group flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3 text-sm transition ${
                a.tone === "danger"
                  ? "border-danger-500/25 bg-danger-500/[0.06] text-danger-600 hover:bg-danger-500/10"
                  : a.tone === "amber"
                    ? "border-amber-400/30 bg-amber-400/[0.08] text-amber-700 hover:bg-amber-400/15"
                    : "border-brand-300/40 bg-brand-600/[0.06] text-brand-700 hover:bg-brand-600/10"
              }`}
            >
              <a.icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 font-medium">{a.text}</span>
              <ArrowRight className="h-4 w-4 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Aylık yinelenen gelir"
          value={moneyTRY(d.mrr)}
          href="/admin/billing"
          icon={Wallet}
          tone="gold"
          trend={lastMrr !== null && prevMrr !== null ? computeTrend(lastMrr, prevMrr) : undefined}
          previousText={prevMrr !== null ? `Geçen ay sonu ${moneyTRY(prevMrr)}` : undefined}
          hint={`Yıllık ${moneyTRY(d.mrr * 12)}`}
          series={mrrRows.map(exactTrendMrr)}
          seriesUnit="ay"
          seriesLabel="Son 12 ay aylık yinelenen gelir"
        />
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
          label="Açık destek talebi"
          value={d.openTickets}
          href="/admin/tickets?durum=open"
          icon={LifeBuoy}
          tone="warn"
          hint={d.urgentTickets > 0 ? `${d.urgentTickets} acil` : "Kuyruk sakin"}
          attention={d.urgentTickets > 0}
          series={weekly.map((w) => Number(w.tickets))}
          chart="bars"
          seriesUnit="hafta"
          seriesLabel="Son 8 hafta yeni destek talebi"
        />
        <KpiCard
          label={`Yeni destek talebi · ${period} gün`}
          value={data.newTickets}
          href="/admin/tickets"
          icon={Activity}
          tone="neutral"
          trend={computeTrend(data.newTickets, data.prevTickets, true)}
          previousText={`Önceki ${period} gün ${data.prevTickets}`}
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
    </div>
  );
}

async function Details({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const { aggregate } = data;
  const list = data.tenants;
  const auditRows = data.audit;

  const buckets = aggregate.weekly.map((row) => Number(row.tenants));
  const maxBucket = Math.max(1, ...buckets);
  const lastIdx = Math.max(1, buckets.length - 1);
  const growthPts = buckets.map((b, i) => ({ x: (i / lastIdx) * 280, y: 72 - (b / maxBucket) * 52 - 8 }));
  const growthLine = growthPts.map((p) => `${p.x},${p.y}`).join(" ");
  const growthArea = `0,80 ${growthLine} 280,80`;
  const growthLast = growthPts[growthPts.length - 1];
  const thisWeek = buckets.length ? buckets[buckets.length - 1]! : 0;

  const planCounts = PLANS.map((plan) => ({
    key: plan.id,
    label: plan.name,
    count: Number(aggregate.plan_stats.find((row) => row.plan === plan.id)?.tenant_count ?? 0),
  }));
  const maxPlan = Math.max(1, ...planCounts.map((p) => p.count));

  const funnel = [
    { label: "Toplam kayıt", href: "/admin/tenants", value: d.totalTenants, tone: "bg-brand-500" },
    { label: "Deneme", href: "/admin/tenants?durum=trial", value: d.trial, tone: "bg-cyan-400" },
    { label: "Aktif abone", href: "/admin/tenants?durum=active", value: d.active, tone: "bg-mint-500" },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  const quickActions = [
    { href: "/admin/satis", title: "Demo & aday", desc: d.demoCount > 0 ? `${d.demoCount} yeni talep` : "Satış hunisi", icon: Handshake, tone: "bg-mint-500/12 text-mint-600" },
    { href: "/admin/tenants", title: "Ofis yönetimi", desc: "Plan, durum, deneme", icon: Building2, tone: "bg-brand-600/10 text-brand-600" },
    { href: "/admin/billing", title: "Abonelik & fatura", desc: "Aylık gelir & tahsilat", icon: CreditCard, tone: "bg-amber-400/15 text-amber-600" },
    { href: "/admin/tickets", title: "Destek kuyruğu", desc: `${d.openTickets} açık talep`, icon: LifeBuoy, tone: "bg-mint-500/12 text-mint-600" },
    { href: "/admin/raporlar", title: "Raporlar", desc: "Platform analizi", icon: Activity, tone: "bg-cyan-500/12 text-cyan-600" },
    { href: "/admin/geo", title: "Coğrafya", desc: "İl · ilçe · mahalle", icon: MapPin, tone: "bg-brand-600/10 text-brand-600" },
    { href: "/admin/sistem", title: "Sistem sağlığı", desc: "Cron · push · entegrasyon", icon: Radar, tone: "bg-ink-950/6 text-ink-800" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <TrendingUp className="h-4 w-4" aria-hidden="true" /> Kazanım hunisi
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Kayıt → Aktif dönüşüm</h2>
          <div className="mt-5 space-y-3">
            {funnel.map((f, i) => (
              <Link key={f.label} href={f.href} className="focus-ring group block rounded-[var(--radius-control)]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">{f.label}</span>
                  <span className="tabular-nums text-text-muted">{f.value}</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-950/5">
                  <div className={`bar-live h-full rounded-full ${f.tone}`} style={{ width: `${Math.max((f.value / funnelMax) * 100, 4)}%`, animationDelay: `${i * 0.1}s` }} />
                </div>
              </Link>
            ))}
          </div>
          <Link href="/admin/tenants?durum=active" className="focus-ring group mt-5 block rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 text-center transition hover:border-brand-300">
            <p className="font-display text-2xl font-extrabold text-mint-600">%{d.conversion}</p>
            <p className="text-xs text-text-muted">Aktif abonelik dönüşüm oranı</p>
          </Link>
        </section>

        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-600">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Ofis büyümesi · 8 hafta
            </p>
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-600">+{thisWeek} bu hafta</span>
          </div>
          {buckets.length >= 2 && growthLast ? (
            <>
              <svg viewBox="0 0 280 80" className="mt-4 h-28 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label={`Son ${buckets.length} hafta yeni ofis sayısı`}>
                <defs>
                  <linearGradient id="adminGrowth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon points={growthArea} fill="url(#adminGrowth)" />
                <polyline className="chart-draw" style={{ "--len": 420 } as CSSProperties} points={growthLine} fill="none" stroke="var(--brand-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={growthLast.x} cy={growthLast.y} r="3.5" fill="var(--brand-500)" opacity="0.3" className="glow-halo" />
                <circle cx={growthLast.x} cy={growthLast.y} r="3" fill="var(--surface)" stroke="var(--brand-500)" strokeWidth="1.5" />
              </svg>
              <div className="mt-1 flex justify-between text-xs text-text-faint" aria-hidden="true">
                {buckets.map((_, i) => (
                  <span key={i}>{i === buckets.length - 1 ? "bu" : `−${buckets.length - 1 - i}h`}</span>
                ))}
              </div>
            </>
          ) : (
            <EmptyStateV3 variant="compact" title="Henüz haftalık seri yok" description="Yeni ofis kayıtları geldikçe grafik burada görünür." />
          )}
        </section>
      </div>

      <section>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-faint">Hızlı erişim</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {quickActions.map((card) => (
            <Link key={card.title} href={card.href} className="focus-ring lift group relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300">
              <span className={`grid h-10 w-10 place-items-center rounded-[var(--radius-card)] ${card.tone}`}>
                <card.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-display font-bold text-ink-950">{card.title}</p>
              <p className="mt-0.5 text-xs text-text-muted">{card.desc}</p>
              <ArrowUpRight className="absolute right-3 top-3 h-4 w-4 text-text-faint transition group-hover:text-brand-600" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600"><Building2 className="h-4 w-4" aria-hidden="true" /> Paket dağılımı</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Plan karışımı</h2>
          <div className="mt-5 flex h-28 items-end gap-3">
            {planCounts.map((p, i) => (
              <Link key={p.key} href={`/admin/tenants?plan=${p.key}`} className="focus-ring group flex flex-1 flex-col items-center gap-1.5 rounded-[var(--radius-control)]">
                <span className="text-xs font-bold tabular-nums text-ink-950">{p.count}</span>
                <div className="flex h-full w-full items-end justify-center">
                  <div className="bar-live w-full max-w-[28px] rounded-t-[5px] bg-[image:var(--grad-brand)] transition group-hover:brightness-110" style={{ height: `${Math.max((p.count / maxPlan) * 100, 8)}%`, animationDelay: `${i * 0.1}s` }} />
                </div>
                <span className="text-xs text-text-muted transition group-hover:text-brand-600">{p.label}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600"><Users className="h-4 w-4" aria-hidden="true" /> Canlı kayıtlar</p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Son ofisler</h2>
            </div>
            <Link href="/admin/tenants" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-brand-600">Tümü <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
          </div>
          <div className="mt-4 space-y-2.5">
            {list.slice(0, 5).map((t) => (
              <Link key={t.id} href={`/admin/tenants/${t.id}`} className="focus-ring group flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5 transition hover:border-brand-300">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950 transition group-hover:text-brand-600">{t.name}</p>
                  <p className="text-xs text-text-faint">{catalogPlanLabel(t.plan)} · {statusLabel[t.status] ?? t.status}</p>
                </div>
                <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" aria-hidden="true" />
              </Link>
            ))}
            {list.length === 0 ? (
              <EmptyStateV3 variant="compact" title="Henüz ofis yok" description="Yeni kayıtlar burada listelenir." />
            ) : null}
          </div>
        </section>
      </div>

      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Activity className="h-4 w-4" aria-hidden="true" /> Son hareketler</p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Platform aktivite akışı</h2>
          </div>
          <Link href="/admin/aktivite" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-brand-600">Tümü <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </div>
        <div className="mt-4 space-y-1">
          {auditRows.length === 0 ? (
            <EmptyStateV3 variant="compact" title="Henüz hareket kaydı yok" description="Platformdaki işlemler burada akar." />
          ) : (
            auditRows.map((a, i) => {
              const tenantName = Array.isArray(a.tenant) ? a.tenant[0]?.name : (a.tenant as { name?: string } | null)?.name;
              return (
                <Link key={i} href={a.tenant_id ? `/admin/tenants/${a.tenant_id}` : "/admin/aktivite"} className="focus-ring group flex items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 transition hover:bg-canvas">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/8 text-brand-600">
                    <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-950 transition group-hover:text-brand-600">{auditActionLabel(a.action)}</p>
                    <p className="truncate text-xs text-text-faint">{tenantName ?? "Platform"} · {a.entity_type ?? "sistem"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-text-faint">{relativeTimeTR(a.created_at)}</span>
                </Link>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="dashboard-panel h-64 animate-pulse rounded-[var(--radius-panel)] border border-line bg-surface" />
        <div className="dashboard-panel h-64 animate-pulse rounded-[var(--radius-panel)] border border-line bg-surface" />
      </div>
      <div className="dashboard-panel h-56 animate-pulse rounded-[var(--radius-panel)] border border-line bg-surface" />
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

      <Suspense fallback={<KpiGridSkeleton />}>
        <KpiGrid period={period} />
      </Suspense>

      <Suspense fallback={<DetailsSkeleton />}>
        <Details period={period} />
      </Suspense>
    </div>
  );
}
