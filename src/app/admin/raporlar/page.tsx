import Link from "next/link";
import { ArrowUpRight, BarChart3, Building2, LayoutGrid, LineChart, PieChart, TrendingUp, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { exportPlatformReportCsv } from "@/app/actions/platform-export";
import { ExportButton } from "@/components/admin/export-button";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { moneyTRY } from "@/lib/admin-format";
import { now as clockNow } from "@/lib/clock";
import type { CSSProperties } from "react";
import { planLabel as catalogPlanLabel } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { exactMrr, exactTrendMrr, priceMapOf, type PlatformReportingAggregate } from "@/lib/reporting/platform";
import { requireReportingData } from "@/lib/reporting/result";

const statusLabel: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" };
const statusColor: Record<string, string> = { trial: "bg-cyan-400", active: "bg-mint-500", past_due: "bg-amber-400", suspended: "bg-danger-500", cancelled: "bg-ink-950/25" };

const ADOPTION_MODULES = [
  ["customers", "Müşteriler"], ["demands", "Talepler"], ["properties", "Portföyler"],
  ["deals", "Anlaşmalar"], ["tasks", "Görevler"], ["appointments", "Randevular"],
  ["commissions", "Komisyon"], ["contracts", "Sözleşmeler"], ["rentals", "Kiralama"],
  ["campaigns", "Kampanyalar"], ["automations", "Otomasyon"], ["valuations", "Değerleme"],
  ["projects", "Projeler"], ["network", "Ofis ağı"],
] as const;

/** `?from=&to=` — yalnızca geçerli YYYY-AA-GG kabul edilir; bozuk değer yok sayılır. */
function parseDateParam(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  await requirePlatformModule("reports");
  const sp = (await searchParams) ?? {};
  const from = parseDateParam(sp.from);
  const to = parseDateParam(sp.to);
  const dateFiltered = Boolean(from || to);

  const admin = createAdminClient();

  // Tarih aralığı verilirse metrikler o aralıkta OLUŞMUŞ kayıtlardan hesaplanır;
  // parametre yoksa mevcut davranış (tüm veri) korunur.
  const now = new Date(clockNow());
  const aggregateResult = await admin.rpc("platform_reporting_aggregates", {
    p_from: from ?? null,
    p_to: to ?? null,
    p_as_of: now.toISOString(),
  });
  const aggregate = requireReportingData(
    "platform-reporting-aggregates",
    aggregateResult,
  ) as unknown as PlatformReportingAggregate;

  // Modül benimseme sabit son 30 gün penceresinde, DB'de tenant-distinct hesaplanır.
  const summary = aggregate.summary;

  const active = Number(summary.active_count);
  const cancelled = Number(summary.cancelled_count);
  const planDefs = await getPlanDefinitions();
  const prices = priceMapOf(planDefs);
  const mrr = exactMrr(aggregate.plan_stats, prices);
  const arpa = active ? Math.round(mrr / active) : 0;
  const tenantCount = Number(summary.tenant_count);
  const churnRate = tenantCount ? Math.round((cancelled / tenantCount) * 100) : 0;

  // Tarihsel durum tablosu olmadığı için seri, bugün aktif aboneliklerin başlangıç kohortudur.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { label: d.toLocaleDateString("tr-TR", { month: "short" }) };
  });
  const trendFallback = aggregate.mrr_trend.map((row) => exactTrendMrr(row, prices));
  const maxTrend = Math.max(1, ...trendFallback);
  const W = 560, H = 130;
  const pts = trendFallback.map((v, i) => ({ x: (i / 11) * W, y: H - (v / maxTrend) * (H - 16) - 8 }));
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  // Plan geliri
  // Gizli planlar yalnız ofisi varsa listelenir; kayıtlı abonelik MRR'ı değişmez, katalog yalnız aboneliği eksik ofiste kullanılır.
  const planRevenue = planDefs
    .filter((plan) => !plan.hidden || Number(aggregate.plan_stats.find((item) => item.plan === plan.id)?.tenant_count ?? 0) > 0)
    .map((plan) => {
    const row = aggregate.plan_stats.find((item) => item.plan === plan.id);
    return {
      key: plan.id,
      label: plan.name,
      count: Number(row?.tenant_count ?? 0),
      revenue: Number(row?.subscription_mrr ?? 0)
        + Math.max(0, Number(row?.active_count ?? 0) - Number(row?.subscription_count ?? 0)) * plan.monthlyTry,
    };
  });
  const maxRev = Math.max(1, ...planRevenue.map((p) => p.revenue));

  // Durum dağılımı
  const statuses = ["trial", "active", "past_due", "suspended", "cancelled"].map((s) => ({
    key: s,
    label: statusLabel[s],
    count: Number(aggregate.status_stats.find((row) => row.status === s)?.tenant_count ?? 0),
  }));
  const statusTotal = Math.max(1, tenantCount);

  // Top tenant (plan değerine göre)
  const topTenants = aggregate.top_tenants
    .map((tenant) => ({ ...tenant, value: prices.get(tenant.plan) ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Modül benimseme: her modülü son 30 günde en az 1 kez kullanan ofis oranı
  const tenantDenom = Math.max(1, Number(aggregate.all_tenant_count));
  const adoption = ADOPTION_MODULES.map(([id, mod]) => ({
    mod,
    offices: Number(aggregate.adoption.find((row) => row.module === id)?.offices ?? 0),
    pct: Math.round((Number(aggregate.adoption.find((row) => row.module === id)?.offices ?? 0) / tenantDenom) * 100),
  })).sort((a, b) => b.pct - a.pct);
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
    suffix?: string;
    icon: typeof TrendingUp;
    accent: string;
    hint?: string;
  }[] = [
    { label: "Aylık yinelenen gelir", href: "/admin/billing", value: hasData ? mrr : null, money: true, icon: TrendingUp, accent: "text-mint-400", hint: `${active} aktif ofis` },
    { label: "Yıllık yinelenen gelir", href: "/admin/billing", value: hasData ? mrr * 12 : null, money: true, icon: LineChart, accent: "text-brand-300", hint: "MRR × 12" },
    { label: "Ofis başına gelir", href: "/admin/tenants?durum=active", value: active ? arpa : null, money: true, icon: Users, accent: "text-amber-300", hint: "aktif ofis ortalaması" },
    { label: "Müşteri kaybı oranı", href: "/admin/tenants?durum=cancelled", value: hasData ? churnRate : null, suffix: "%", icon: BarChart3, accent: "text-danger-300", hint: `${cancelled} iptal` },
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Platform analizi"
        icon={BarChart3}
        title="Platform raporları"
        description="Gelir, büyüme, paket dağılımı ve destek performansı — tüm ofislerin toplu görünümü."
        glow="mint"
        actions={<ExportButton action={exportPlatformReportCsv} label="Raporu indir" />}
      >
        <AdminStatGrid className="mt-6">
          {kpis.map((k) => (
            <AdminStatCard
              key={k.label}
              tone="dark"
              label={k.label}
              value={k.value}
              href={k.href}
              icon={k.icon}
              accent={k.accent}
              money={k.money}
              suffix={k.suffix}
              hint={k.hint}
              emptyHint="Henüz ofis kaydı yok"
            />
          ))}
        </AdminStatGrid>
      </AdminPageHeader>

      {/* Tarih aralığı — metrikler seçili aralıktaki kayıtlardan hesaplanır */}
      <form action="/admin/raporlar" className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <label className="text-xs font-semibold text-text-muted">
          Başlangıç
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400"
          />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Bitiş
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400"
          />
        </label>
        <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-3 py-2 text-xs font-semibold text-white">
          Uygula
        </button>
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

      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><LineChart className="h-4 w-4 text-brand-600" /> Aktif abonelik kohortu · 12 ay</p>
          <span className="rounded-full bg-mint-500/10 px-2.5 py-1 text-xs font-bold text-mint-600">{moneyTRY(trendFallback[11] ?? 0)}</span>
        </div>
        <p className="mt-1 text-xs text-text-faint">Bugün aktif aboneliklerin başlangıç tarihine göre kümülatif MRR görünümü.</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full overflow-visible" style={{ height: H }} preserveAspectRatio="none">
          <defs>
            <linearGradient id="repTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mint-500)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--mint-500)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#repTrend)" />
          <polyline className="chart-draw" style={{ "--len": W * 1.6 } as CSSProperties} points={line} fill="none" stroke="var(--mint-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Nokta başına native tooltip: ay + o ayki kümülatif gelir */}
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="10" fill="transparent" className="cursor-help">
              <title>{`${months[i]?.label ?? ""}: ${moneyTRY(trendFallback[i] ?? 0)}`}</title>
            </circle>
          ))}
        </svg>
        <div className="mt-1 flex justify-between text-xs text-text-faint">
          {months.map((m, i) => <span key={i}>{m.label}</span>)}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* plan revenue */}
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><Building2 className="h-4 w-4 text-amber-600" /> Plan geliri</p>
          <div className="mt-4 space-y-3">
            {planRevenue.map((p, i) => (
              <Link key={p.key} href={`/admin/tenants?plan=${p.key}`} className="focus-ring group block rounded-[var(--radius-control)]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">{p.label} <span className="text-text-faint">· {p.count} ofis</span></span>
                  <span className="tabular-nums text-text-muted">{moneyTRY(p.revenue)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                  <div className="bar-live h-full rounded-full bg-[image:var(--grad-brand)] transition group-hover:brightness-110" style={{ width: `${Math.max((p.revenue / maxRev) * 100, 3)}%`, animationDelay: `${i * 0.08}s` }} />
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* status distribution */}
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><PieChart className="h-4 w-4 text-brand-600" /> Durum dağılımı</p>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-ink-950/5">
            {statuses.map((s) => s.count > 0 ? (
              <div key={s.key} className={statusColor[s.key]} style={{ width: `${(s.count / statusTotal) * 100}%` }} title={`${s.label}: ${s.count}`} />
            ) : null)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {statuses.map((s) => (
              <Link key={s.key} href={`/admin/tenants?durum=${s.key}`} className="focus-ring group flex items-center justify-between rounded-[var(--radius-control)] border border-line bg-canvas/50 px-3 py-2 text-xs transition hover:border-brand-300">
                <span className="flex items-center gap-2 transition group-hover:text-brand-600"><span className={`h-2 w-2 rounded-full ${statusColor[s.key]}`} /> {s.label}</span>
                <span className="font-bold tabular-nums text-ink-950">{s.count}</span>
              </Link>
            ))}
          </div>
          <Link href="/admin/tickets" className="focus-ring group mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
            <span className="text-text-muted transition group-hover:text-brand-600">Destek çözüm oranı</span>
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
              <span className="shrink-0 font-display text-sm font-extrabold tabular-nums text-ink-950">{moneyTRY(t.value)}<span className="text-xs font-normal text-text-faint">/ay</span></span>
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
          {adoption.map((a, i) => (
            <Link key={a.mod} href="/admin/aktivite" className="focus-ring group block rounded-[var(--radius-control)]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">
                  {a.mod} <span className="text-text-faint">· {a.offices} ofis</span>
                </span>
                <span className="font-bold tabular-nums text-text-muted">%{a.pct}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                <div
                  className={`bar-live h-full rounded-full transition group-hover:brightness-110 ${
                    lowestMods.has(a.mod) ? "bg-amber-400" : "bg-[image:var(--grad-brand)]"
                  }`}
                  style={{ width: `${Math.max(a.pct, 2)}%`, animationDelay: `${i * 0.06}s` }}
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
    </div>
  );
}
