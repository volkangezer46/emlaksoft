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
  Users,
  Zap,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformStaff } from "@/lib/platform";
import { CountUp } from "@/components/admin/count-up";
import { Sparkline } from "@/components/admin/sparkline";
import { BillingHome } from "./_dashboards/billing-home";
import { SupportHome } from "./_dashboards/support-home";
import {
  auditActionLabel,
  greetingTR,
  moneyTRY,
  relativeTimeTR,
  todayTR,
  weekBuckets,
} from "@/lib/admin-format";
import type { CSSProperties } from "react";
import { msUntil } from "@/lib/clock";

const RING_C = 2 * Math.PI * 42;

const planPrice: Record<string, number> = { advisor: 990, office: 2490, professional: 5990, enterprise: 12900 };
const planLabel: Record<string, string> = { advisor: "Danışman", office: "Ofis", professional: "Profesyonel", enterprise: "Kurumsal" };
const statusLabel: Record<string, string> = { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" };

export default async function AdminHomePage() {
  const staff = await requirePlatformStaff();

  // Departmana özel açılış ekranı — aynı /admin adresi, role göre farklı panel.
  if (staff.role === "billing") return <BillingHome staffName={staff.full_name} />;
  if (staff.role === "support") return <SupportHome staffName={staff.full_name} />;

  const admin = createAdminClient();

  const [{ data: tenants }, { count: memberCount }, { data: tickets }, { data: subs }, { data: audit }, { count: newDemos }] =
    await Promise.all([
      admin.from("tenants").select("id, name, plan, status, created_at, trial_ends_at").order("created_at", { ascending: false }).limit(2000),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("support_tickets").select("id, status, priority, created_at").order("created_at", { ascending: false }).limit(80),
      admin.from("subscriptions").select("status, amount_try, plan, created_at").limit(5000),
      admin.from("audit_logs").select("action, entity_type, actor_id, tenant_id, created_at, tenant:tenants(name)").order("created_at", { ascending: false }).limit(10),
      admin.from("demo_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
    ]);

  const list = tenants ?? [];
  const ticketRows = tickets ?? [];
  const subRows = subs ?? [];
  const auditRows = audit ?? [];

  const active = list.filter((t) => t.status === "active").length;
  const trial = list.filter((t) => t.status === "trial").length;
  const risk = list.filter((t) => t.status === "suspended" || t.status === "past_due").length;
  const openTickets = ticketRows.filter((t) => ["open", "in_progress", "waiting"].includes(t.status)).length;
  const urgentTickets = ticketRows.filter((t) => t.priority === "urgent" && !["resolved", "closed"].includes(t.status)).length;

  const mrr = subRows.filter((s) => s.status === "active").reduce((sum, s) => sum + Number(s.amount_try || 0), 0);
  const displayMrr = mrr || list.filter((t) => t.status === "active").reduce((sum, t) => sum + (planPrice[t.plan] ?? 0), 0);
  const arr = displayMrr * 12;

  const healthRate = list.length ? active / list.length : 0;
  const conversion = list.length ? Math.round((active / list.length) * 100) : 0;

  // Trial'ı 7 gün içinde biten tenant'lar
  const soon = list.filter((t) => {
    if (t.status !== "trial" || !t.trial_ends_at) return false;
    const diff = msUntil(t.trial_ends_at);
    return diff > 0 && diff < 7 * 86_400_000;
  }).length;

  // Sparkline serileri (8 hafta)
  const tenantSeries = weekBuckets(list.map((t) => t.created_at));
  const activeSeries = weekBuckets(subRows.filter((s) => s.status === "active").map((s) => s.created_at));
  const trialSeries = weekBuckets(list.filter((t) => t.status === "trial").map((t) => t.created_at));
  const ticketSeries = weekBuckets(ticketRows.map((t) => t.created_at));

  // Büyüme grafiği (8 hafta, kümülatif his için tenant kovaları)
  const buckets = tenantSeries;
  const maxBucket = Math.max(1, ...buckets);
  const growthPts = buckets.map((b, i) => ({ x: (i / 7) * 280, y: 72 - (b / maxBucket) * 52 - 8 }));
  const growthLine = growthPts.map((p) => `${p.x},${p.y}`).join(" ");
  const growthArea = `0,80 ${growthLine} 280,80`;
  const growthLast = growthPts[growthPts.length - 1]!;

  const planCounts = ["advisor", "office", "professional", "enterprise"].map((p) => ({
    key: p,
    label: planLabel[p],
    count: list.filter((t) => t.plan === p).length,
  }));
  const maxPlan = Math.max(1, ...planCounts.map((p) => p.count));

  const kpis = [
    { label: "Toplam ofis", value: list.length, sub: `+${buckets[7]} bu hafta`, icon: Building2, tone: "text-amber-500", stroke: "var(--amber-400)", fill: "rgba(242,184,75,0.14)", series: tenantSeries },
    { label: "Aktif abone", value: active, sub: `%${conversion} dönüşüm`, icon: TrendingUp, tone: "text-mint-600", stroke: "var(--mint-500)", fill: "rgba(16,185,163,0.14)", series: activeSeries },
    { label: "Deneme", value: trial, sub: soon > 0 ? `${soon} yakında bitiyor` : "aktif deneme", icon: Sparkles, tone: "text-cyan-500", stroke: "var(--cyan-400)", fill: "rgba(34,211,238,0.14)", series: trialSeries },
    { label: "Açık talep", value: openTickets, sub: urgentTickets > 0 ? `${urgentTickets} acil` : "kuyruk sakin", icon: LifeBuoy, tone: "text-danger-500", stroke: "var(--danger-500)", fill: "rgba(229,72,77,0.12)", series: ticketSeries },
  ];

  const demoCount = newDemos ?? 0;

  const alerts = [
    demoCount > 0 ? { href: "/admin/satis", tone: "brand", icon: Handshake, text: `${demoCount} yeni demo talebi yanıt bekliyor — satış fırsatı.` } : null,
    risk > 0 ? { href: "/admin/tenants", tone: "danger", icon: AlertTriangle, text: `${risk} ofis risk altında (gecikmiş/askıda) — inceleyin.` } : null,
    urgentTickets > 0 ? { href: "/admin/tickets", tone: "amber", icon: LifeBuoy, text: `${urgentTickets} acil destek talebi yanıt bekliyor.` } : null,
    soon > 0 ? { href: "/admin/tenants", tone: "brand", icon: Sparkles, text: `${soon} deneme önümüzdeki 7 gün içinde sona eriyor — dönüşüm fırsatı.` } : null,
  ].filter(Boolean) as { href: string; tone: string; icon: typeof AlertTriangle; text: string }[];

  const funnel = [
    { label: "Toplam kayıt", value: list.length, tone: "bg-brand-500" },
    { label: "Deneme", value: trial, tone: "bg-cyan-400" },
    { label: "Aktif abone", value: active, tone: "bg-mint-500" },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

  const quickActions = [
    { href: "/admin/satis", title: "Demo & aday", desc: demoCount > 0 ? `${demoCount} yeni talep` : "Satış hunisi", icon: Handshake, tone: "bg-mint-500/12 text-mint-600" },
    { href: "/admin/tenants", title: "Ofis yönetimi", desc: "Plan, durum, deneme", icon: Building2, tone: "bg-brand-600/10 text-brand-600" },
    { href: "/admin/billing", title: "Abonelik & fatura", desc: "Aylık gelir & tahsilat", icon: CreditCard, tone: "bg-amber-400/15 text-amber-600" },
    { href: "/admin/tickets", title: "Destek kuyruğu", desc: `${openTickets} açık talep`, icon: LifeBuoy, tone: "bg-mint-500/12 text-mint-600" },
    { href: "/admin/raporlar", title: "Raporlar", desc: "Platform analizi", icon: Activity, tone: "bg-cyan-500/12 text-cyan-600" },
    { href: "/admin/geo", title: "Coğrafya", desc: "İl · ilçe · mahalle", icon: MapPin, tone: "bg-brand-600/10 text-brand-600" },
    { href: "/admin/sistem", title: "Sistem sağlığı", desc: "Cron · push · entegrasyon", icon: Radar, tone: "bg-ink-950/6 text-ink-800" },
  ];

  return (
    <div className="space-y-5">
      {/* greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold text-ink-950 md:text-2xl">
            {greetingTR()}, {staff.full_name.split(" ")[0]} 👋
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {staff.role === "ops" ? "Operasyon" : "Süper admin"} kontrol paneli · {todayTR()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-500/10 px-3 py-1.5 text-xs font-bold text-mint-600">
            <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-500" /> Sistem çalışıyor
          </span>
        </div>
      </div>

      {/* alerts */}
      {alerts.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.map((a, i) => (
            <Link
              key={i}
              href={a.href}
              className={`group flex items-center gap-3 rounded-[14px] border px-4 py-3 text-sm transition ${
                a.tone === "danger"
                  ? "border-danger-500/25 bg-danger-500/[0.06] text-danger-600 hover:bg-danger-500/10"
                  : a.tone === "amber"
                    ? "border-amber-400/30 bg-amber-400/[0.08] text-amber-700 hover:bg-amber-400/15"
                    : "border-brand-300/40 bg-brand-600/[0.06] text-brand-700 hover:bg-brand-600/10"
              }`}
            >
              <a.icon className="h-4.5 w-4.5 shrink-0" />
              <span className="min-w-0 flex-1 font-medium">{a.text}</span>
              <ArrowRight className="h-4 w-4 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </Link>
          ))}
        </div>
      ) : null}

      {/* KPI cards with sparklines */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="dashboard-panel group relative overflow-hidden rounded-[18px] border border-line bg-surface p-4">
            <div className="flex items-start justify-between">
              <span className={`grid h-9 w-9 place-items-center rounded-[11px] bg-canvas ${k.tone}`}>
                <k.icon className="h-4.5 w-4.5" />
              </span>
              <span className="text-[10px] font-semibold text-text-faint">8 hafta</span>
            </div>
            <p className="mt-3 font-display text-3xl font-extrabold tabular-nums text-ink-950">
              <CountUp value={k.value} />
            </p>
            <p className="text-xs text-text-muted">{k.label}</p>
            <div className="mt-2 h-9">
              <Sparkline data={k.series} stroke={k.stroke} fill={k.fill} height={36} />
            </div>
            <p className="mt-1 text-[11px] font-medium text-text-faint">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* finance card + funnel */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-6 text-white">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-mint-500/20 blur-[90px]" />
          <div className="relative grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-center">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-400">
                <Zap className="h-3.5 w-3.5" /> Gelir motoru
              </p>
              <p className="mt-2 font-display text-4xl font-extrabold tabular-nums text-white">
                <CountUp value={displayMrr} money />
              </p>
              <p className="mt-1 text-sm text-white/75">Aylık yinelenen gelir</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-[12px] border border-white/12 bg-white/8 p-3">
                  <p className="font-display text-lg font-extrabold text-white">{moneyTRY(arr)}</p>
                  <p className="text-[10px] text-white/70">Yıllık yinelenen gelir</p>
                </div>
                <div className="rounded-[12px] border border-white/12 bg-white/8 p-3">
                  <p className="font-display text-lg font-extrabold text-white">{memberCount ?? 0}</p>
                  <p className="text-[10px] text-white/70">Toplam kullanıcı</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-5">
              <div className="relative grid h-28 w-28 place-items-center">
                <div
                  className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                  style={{ background: "conic-gradient(from 0deg, var(--mint-500), var(--cyan-400), var(--mint-500))" }}
                />
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="42" fill="none" stroke="var(--mint-500)" strokeWidth="8" strokeLinecap="round"
                    className="ring-sweep"
                    style={{ "--circ": RING_C, "--dash": RING_C * (1 - healthRate) } as CSSProperties}
                  />
                </svg>
                <div className="absolute text-center">
                  <p className="font-display text-xl font-extrabold text-white">%{Math.round(healthRate * 100)}</p>
                  <p className="text-[9px] text-white/70">sağlık</p>
                </div>
              </div>
              <div className="space-y-2 text-xs text-white/85">
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint-500" /> {active} aktif</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-cyan-400" /> {trial} deneme</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-danger-500" /> {risk} riskli</div>
              </div>
            </div>
          </div>
        </section>

        {/* funnel */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <TrendingUp className="h-4 w-4" /> Kazanım hunisi
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Kayıt → Aktif dönüşüm</h2>
          <div className="mt-5 space-y-3">
            {funnel.map((f, i) => (
              <div key={f.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950">{f.label}</span>
                  <span className="tabular-nums text-text-muted">{f.value}</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-950/5">
                  <div className={`bar-live h-full rounded-full ${f.tone}`} style={{ width: `${Math.max((f.value / funnelMax) * 100, 4)}%`, animationDelay: `${i * 0.1}s` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-[12px] border border-line bg-canvas/60 p-3 text-center">
            <p className="font-display text-2xl font-extrabold text-mint-600">%{conversion}</p>
            <p className="text-[11px] text-text-muted">Aktif abonelik dönüşüm oranı</p>
          </div>
        </section>
      </div>

      {/* quick actions */}
      <section>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-faint">Hızlı erişim</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {quickActions.map((card) => (
            <Link key={card.title} href={card.href} className="lift group relative overflow-hidden rounded-[16px] border border-line bg-surface p-4 transition hover:border-brand-300">
              <span className={`grid h-10 w-10 place-items-center rounded-[12px] ${card.tone}`}>
                <card.icon className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-display font-bold text-ink-950">{card.title}</p>
              <p className="mt-0.5 text-[11px] text-text-muted">{card.desc}</p>
              <ArrowUpRight className="absolute right-3 top-3 h-4 w-4 text-text-faint transition group-hover:text-brand-600" />
            </Link>
          ))}
        </div>
      </section>

      {/* growth + plan mix + recent */}
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-600">
              <Activity className="h-3.5 w-3.5" /> Ofis büyümesi · 8 hafta
            </p>
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[10px] font-bold text-brand-600">+{buckets[7]} bu hafta</span>
          </div>
          <svg viewBox="0 0 280 80" className="mt-4 h-28 w-full overflow-visible" preserveAspectRatio="none">
            <defs>
              <linearGradient id="adminGrowth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={growthArea} fill="url(#adminGrowth)" />
            <polyline className="chart-draw" style={{ "--len": 420 } as CSSProperties} points={growthLine} fill="none" stroke="var(--brand-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={growthLast.x} cy={growthLast.y} r="3.5" fill="var(--brand-500)" opacity="0.3" className="glow-halo" />
            <circle cx={growthLast.x} cy={growthLast.y} r="3" fill="#fff" stroke="var(--brand-500)" strokeWidth="1.5" />
          </svg>
          <div className="mt-1 flex justify-between text-[9px] text-text-faint">
            {["−7h", "−6h", "−5h", "−4h", "−3h", "−2h", "−1h", "bu"].map((l) => <span key={l}>{l}</span>)}
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600"><Building2 className="h-4 w-4" /> Paket dağılımı</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Plan karışımı</h2>
          <div className="mt-5 flex h-28 items-end gap-3">
            {planCounts.map((p, i) => (
              <div key={p.key} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[11px] font-bold tabular-nums text-ink-950">{p.count}</span>
                <div className="flex h-full w-full items-end justify-center">
                  <div className="bar-live w-full max-w-[28px] rounded-t-[5px] bg-[image:var(--grad-brand)] shadow-[0_0_12px_-2px_rgba(20,99,255,0.45)]" style={{ height: `${Math.max((p.count / maxPlan) * 100, 8)}%`, animationDelay: `${i * 0.1}s` }} />
                </div>
                <span className="text-[9px] text-text-muted">{p.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600"><Users className="h-4 w-4" /> Canlı kayıtlar</p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Son ofisler</h2>
            </div>
            <Link href="/admin/tenants" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Tümü <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="mt-4 space-y-2.5">
            {list.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{t.name}</p>
                  <p className="text-[10px] text-text-faint">{planLabel[t.plan] ?? t.plan} · {statusLabel[t.status] ?? t.status}</p>
                </div>
                <span className="status-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-mint-500" />
              </div>
            ))}
            {list.length === 0 ? <p className="py-6 text-center text-sm text-text-muted">Henüz ofis yok.</p> : null}
          </div>
        </section>
      </div>

      {/* activity feed */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Activity className="h-4 w-4" /> Son hareketler</p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Platform aktivite akışı</h2>
          </div>
          <Link href="/admin/aktivite" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Tümü <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="mt-4 space-y-1">
          {auditRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Henüz kayıt yok.</p>
          ) : (
            auditRows.map((a, i) => {
              const tenantName = Array.isArray(a.tenant) ? a.tenant[0]?.name : (a.tenant as { name?: string } | null)?.name;
              return (
                <div key={i} className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition hover:bg-canvas">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-brand-600/8 text-brand-600">
                    <Activity className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-950">{auditActionLabel(a.action)}</p>
                    <p className="truncate text-[11px] text-text-faint">{tenantName ?? "Platform"} · {a.entity_type ?? "sistem"}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-text-faint">{relativeTimeTR(a.created_at)}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
