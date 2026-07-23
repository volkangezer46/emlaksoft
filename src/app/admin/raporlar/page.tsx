import { BarChart3, Building2, LineChart, PieChart, TrendingUp, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { CountUp } from "@/components/admin/count-up";
import { moneyTRY } from "@/lib/admin-format";
import type { CSSProperties } from "react";

const planPrice: Record<string, number> = { advisor: 990, office: 2490, professional: 5990, enterprise: 12900 };
const planLabel: Record<string, string> = { advisor: "Danışman", office: "Ofis", professional: "Profesyonel", enterprise: "Kurumsal" };
const statusLabel: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" };
const statusColor: Record<string, string> = { trial: "bg-cyan-400", active: "bg-mint-500", past_due: "bg-amber-400", suspended: "bg-danger-500", cancelled: "bg-ink-950/25" };

export default async function AdminReportsPage() {
  await requirePlatformModule("reports");
  const admin = createAdminClient();

  const [{ data: tenants }, { data: subs }, { data: tickets }] = await Promise.all([
    admin.from("tenants").select("id, name, plan, status, created_at").limit(500),
    admin.from("subscriptions").select("status, amount_try, plan, created_at").limit(500),
    admin.from("support_tickets").select("id, status, created_at").limit(1000),
  ]);

  const list = tenants ?? [];
  const subRows = subs ?? [];
  const ticketRows = tickets ?? [];

  const active = list.filter((t) => t.status === "active").length;
  const cancelled = list.filter((t) => t.status === "cancelled").length;
  const mrr = subRows.filter((s) => s.status === "active").reduce((sum, s) => sum + Number(s.amount_try || 0), 0) ||
    list.filter((t) => t.status === "active").reduce((sum, t) => sum + (planPrice[t.plan] ?? 0), 0);
  const arpa = active ? Math.round(mrr / active) : 0;
  const churnRate = list.length ? Math.round((cancelled / list.length) * 100) : 0;

  // MRR trend — 12 ay kümülatif aktif abonelik geliri
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { label: d.toLocaleDateString("tr-TR", { month: "short" }), cutoff: new Date(d.getFullYear(), d.getMonth() + 1, 0) };
  });
  const trend = months.map((m) =>
    subRows
      .filter((s) => (s.status === "active" || s.status === "trialing") && new Date(s.created_at) <= m.cutoff)
      .reduce((sum, s) => sum + Number(s.amount_try || 0), 0),
  );
  const trendFallback = trend.every((v) => v === 0)
    ? months.map((m) => list.filter((t) => t.status === "active" && new Date(t.created_at) <= m.cutoff).reduce((s, t) => s + (planPrice[t.plan] ?? 0), 0))
    : trend;
  const maxTrend = Math.max(1, ...trendFallback);
  const W = 560, H = 130;
  const pts = trendFallback.map((v, i) => ({ x: (i / 11) * W, y: H - (v / maxTrend) * (H - 16) - 8 }));
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  // Plan geliri
  const planRevenue = ["advisor", "office", "professional", "enterprise"].map((p) => ({
    key: p, label: planLabel[p],
    count: list.filter((t) => t.plan === p).length,
    revenue: list.filter((t) => t.plan === p && t.status === "active").reduce((s) => s + planPrice[p]!, 0),
  }));
  const maxRev = Math.max(1, ...planRevenue.map((p) => p.revenue));

  // Durum dağılımı
  const statuses = ["trial", "active", "past_due", "suspended", "cancelled"].map((s) => ({
    key: s, label: statusLabel[s], count: list.filter((t) => t.status === s).length,
  }));
  const statusTotal = Math.max(1, list.length);

  // Top tenant (plan değerine göre)
  const topTenants = [...list]
    .filter((t) => t.status === "active")
    .map((t) => ({ ...t, value: planPrice[t.plan] ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const resolvedRate = ticketRows.length
    ? Math.round((ticketRows.filter((t) => ["resolved", "closed"].includes(t.status)).length / ticketRows.length) * 100)
    : 0;

  const kpis = [
    { label: "Aylık yinelenen gelir", value: mrr, money: true, icon: TrendingUp, tone: "text-mint-600" },
    { label: "Yıllık yinelenen gelir", value: mrr * 12, money: true, icon: LineChart, tone: "text-brand-600" },
    { label: "Ofis başına gelir", value: arpa, money: true, icon: Users, tone: "text-amber-600" },
    { label: "Müşteri kaybı oranı", value: churnRate, suffix: "%", icon: BarChart3, tone: "text-danger-500" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-extrabold text-ink-950 md:text-2xl">Platform raporları</h1>
        <p className="mt-0.5 text-sm text-text-muted">Gelir, büyüme, paket ve destek performansı.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="dashboard-panel rounded-[18px] border border-line bg-surface p-4">
            <span className={`grid h-9 w-9 place-items-center rounded-[11px] bg-canvas ${k.tone}`}><k.icon className="h-4.5 w-4.5" /></span>
            <p className="mt-3 font-display text-2xl font-extrabold tabular-nums text-ink-950">
              <CountUp value={k.value} money={k.money} suffix={k.suffix} />
            </p>
            <p className="text-xs text-text-muted">{k.label}</p>
          </div>
        ))}
      </div>

      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><LineChart className="h-4 w-4 text-brand-600" /> Aylık gelir trendi · 12 ay</p>
          <span className="rounded-full bg-mint-500/10 px-2.5 py-1 text-xs font-bold text-mint-600">{moneyTRY(trendFallback[11] ?? 0)}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full overflow-visible" style={{ height: H }} preserveAspectRatio="none">
          <defs>
            <linearGradient id="repTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mint-500)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--mint-500)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#repTrend)" />
          <polyline className="chart-draw" style={{ "--len": W * 1.6 } as CSSProperties} points={line} fill="none" stroke="var(--mint-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="mt-1 flex justify-between text-[9px] text-text-faint">
          {months.map((m, i) => <span key={i}>{m.label}</span>)}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* plan revenue */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><Building2 className="h-4 w-4 text-amber-600" /> Plan geliri</p>
          <div className="mt-4 space-y-3">
            {planRevenue.map((p, i) => (
              <div key={p.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950">{p.label} <span className="text-text-faint">· {p.count} ofis</span></span>
                  <span className="tabular-nums text-text-muted">{moneyTRY(p.revenue)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                  <div className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]" style={{ width: `${Math.max((p.revenue / maxRev) * 100, 3)}%`, animationDelay: `${i * 0.08}s` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* status distribution */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><PieChart className="h-4 w-4 text-brand-600" /> Durum dağılımı</p>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-ink-950/5">
            {statuses.map((s) => s.count > 0 ? (
              <div key={s.key} className={statusColor[s.key]} style={{ width: `${(s.count / statusTotal) * 100}%` }} title={`${s.label}: ${s.count}`} />
            ) : null)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {statuses.map((s) => (
              <div key={s.key} className="flex items-center justify-between rounded-[10px] border border-line bg-canvas/50 px-3 py-2 text-xs">
                <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${statusColor[s.key]}`} /> {s.label}</span>
                <span className="font-bold tabular-nums text-ink-950">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
            <span className="text-text-muted">Destek çözüm oranı</span>
            <span className="font-display text-lg font-extrabold text-mint-600">%{resolvedRate}</span>
          </div>
        </section>
      </div>

      {/* top tenants */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-950"><TrendingUp className="h-4 w-4 text-mint-600" /> En değerli ofisler</p>
        <div className="mt-4 space-y-2">
          {topTenants.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Aktif ofis yok.</p>
          ) : topTenants.map((t, i) => (
            <div key={t.id} className="flex items-center gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">{t.name}</p>
                <p className="text-[10px] text-text-faint">{planLabel[t.plan] ?? t.plan}</p>
              </div>
              <span className="shrink-0 font-display text-sm font-extrabold tabular-nums text-ink-950">{moneyTRY(t.value)}<span className="text-[10px] font-normal text-text-faint">/ay</span></span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
