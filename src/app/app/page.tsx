import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  FileCheck,
  Gauge,
  PhoneIncoming,
  PieChart,
  Plus,
  Radar,
  Siren,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { moneyTry } from "@/lib/leak-shield";
import { getCachedOfficeScore, getOfficeScoreCached } from "@/lib/office-score";
import { requireModulePage } from "@/lib/require-module-page";

type Kpi = {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string;
  tone?: "danger" | "warn" | "amber" | "mint" | "brand";
  spark: number[];
};

function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  const safe = data.length ? data : [0, 0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe);
  const range = max - min || 1;
  const coords = safe.map((d, i) => ({
    x: safe.length === 1 ? 50 : (i / (safe.length - 1)) * 100,
    y: 28 - ((d - min) / range) * 24 - 2,
  }));
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `0,28 ${line} 100,28`;
  const last = coords[coords.length - 1]!;
  return (
    <svg viewBox="0 0 100 28" className="h-8 w-full overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#spark-${id})`} />
      <polyline
        className="chart-draw"
        style={{ "--len": 240 } as React.CSSProperties}
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r="1.9" fill={color} />
    </svg>
  );
}

const toneText: Record<string, string> = {
  danger: "text-danger-500",
  warn: "text-warn-500",
  amber: "text-amber-500",
  mint: "text-mint-600",
  brand: "text-brand-600",
};
const toneBg: Record<string, string> = {
  danger: "bg-danger-500/10 text-danger-500",
  warn: "bg-warn-500/10 text-warn-500",
  amber: "bg-amber-400/15 text-amber-500",
  mint: "bg-mint-500/12 text-mint-600",
  brand: "bg-brand-600/10 text-brand-600",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function daysSince(value: string | null) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

function weekBuckets(dates: string[], weeks = 7) {
  const buckets = Array.from({ length: weeks }, () => 0);
  const now = Date.now();
  const weekMs = 7 * 86_400_000;
  dates.forEach((iso) => {
    const idx = weeks - 1 - Math.floor((now - new Date(iso).getTime()) / weekMs);
    if (idx >= 0 && idx < weeks) buckets[idx] += 1;
  });
  return buckets;
}

export default async function AppHomePage() {
  const { tenantId } = await requireModulePage("dashboard");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";
  const firstName = fullName.split(" ")[0] || "hoş geldiniz";

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const fifteenDaysFromNow = new Date();
  fifteenDaysFromNow.setDate(fifteenDaysFromNow.getDate() + 15);

  const last24h = new Date(Date.now() - 86_400_000).toISOString();

  const [
    { count },
    { data: latest },
    { count: propertyCount },
    { data: liveListings },
    { data: monthClosures },
    { data: recentClosures },
    { data: commissions },
    { count: callsToday },
    { data: callDates },
    { data: demandRows },
    { data: dealRows },
    { data: profiles },
    { data: auditLive },
    { data: customerDates },
    { data: expiringAuthority },
    { data: recentCustomers24h },
    { data: recentCalls24h },
    { data: recentAppts24h },
    { data: recentProperties24h },
  ] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase
      .from("customers")
      .select("id, full_name, customer_types, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(4),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    // Limit 200 → 100, sadece gerekli alanlar
    supabase
      .from("portal_listings")
      .select("id, portal_name, portal_listing_id, last_confirmed_at")
      .eq("status", "live")
      .limit(100),
    // Sadece bu ay
    supabase
      .from("listing_closures")
      .select("estimated_lost_commission, created_at")
      .gte("created_at", monthStart.toISOString())
      .limit(50),
    supabase
      .from("listing_closures")
      .select("id, reason, competitor_closed, estimated_lost_commission, created_at, portal_listing:portal_listings(portal_name, portal_listing_id)")
      .order("created_at", { ascending: false })
      .limit(5),
    // Sadece son 6 ay komisyonları — limit ekle, deal join kaldır (gereksiz)
    supabase
      .from("commissions")
      .select("gross_amount, status, created_at")
      .gte("created_at", sixMonthsAgo.toISOString())
      .limit(500),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("started_at", dayStart.toISOString()),
    // 500 → 100, sadece 7 haftalık pencere
    supabase
      .from("calls")
      .select("started_at")
      .gte("started_at", new Date(Date.now() - 49 * 86_400_000).toISOString())
      .order("started_at", { ascending: false })
      .limit(100),
    supabase.from("customer_demands").select("status").neq("status", "closed").limit(200),
    // Son 3 ay + limit
    supabase
      .from("deals")
      .select("stage, deal_value, assigned_to, updated_at")
      .gte("updated_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
      .limit(100),
    supabase.from("profiles").select("id, full_name, role").limit(50),
    supabase
      .from("audit_logs")
      .select("id, action, entity_type, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    // 500 → 100, sadece 7 haftalık pencere
    supabase
      .from("customers")
      .select("created_at")
      .is("deleted_at", null)
      .gte("created_at", new Date(Date.now() - 49 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(100),
    // Yetki belgesi 15 gün içinde dolacak portföyler
    supabase
      .from("properties")
      .select("id, property_code, title, authority_expires_at")
      .is("deleted_at", null)
      .not("authority_expires_at", "is", null)
      .lte("authority_expires_at", fifteenDaysFromNow.toISOString())
      .gte("authority_expires_at", new Date().toISOString())
      .order("authority_expires_at", { ascending: true })
      .limit(10),
    // Son 24s — müşteri eklemeler
    supabase.from("customers").select("id, full_name, created_at").is("deleted_at", null)
      .gte("created_at", last24h).order("created_at", { ascending: false }).limit(5),
    // Son 24s — aramalar
    supabase.from("calls").select("id, phone, direction, started_at").gte("started_at", last24h)
      .order("started_at", { ascending: false }).limit(5),
    // Son 24s — randevular
    supabase.from("appointments").select("id, appointment_type, scheduled_at, status")
      .gte("created_at", last24h).order("created_at", { ascending: false }).limit(5),
    // Son 24s — yeni portföyler
    supabase.from("properties").select("id, property_code, title, created_at").is("deleted_at", null)
      .gte("created_at", last24h).order("created_at", { ascending: false }).limit(5),
  ]);

  const customerCount = count ?? 0;
  const overdueListings = (liveListings ?? []).filter((r) => daysSince(r.last_confirmed_at) >= 7);
  const lostMonth = (monthClosures ?? []).reduce(
    (sum, row) => sum + Number(row.estimated_lost_commission || 0),
    0,
  );

  const paidCommission = (commissions ?? [])
    .filter((c) => c.status === "paid" || c.status === "collected")
    .reduce((s, c) => s + Number(c.gross_amount || 0), 0);
  const pendingCommission = (commissions ?? [])
    .filter((c) => c.status !== "paid" && c.status !== "collected")
    .reduce((s, c) => s + Number(c.gross_amount || 0), 0);

  // Son 6 ay komisyon serisi
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthTotals = monthKeys.map((key) => {
    const sum = (commissions ?? [])
      .filter((c) => (c.created_at ?? "").slice(0, 7) === key)
      .reduce((s, c) => s + Number(c.gross_amount || 0), 0);
    return sum;
  });
  const maxMonth = Math.max(1, ...monthTotals);
  const chartPts = monthTotals.map((v, i) => {
    const x = (i / 5) * 700;
    const y = 200 - (v / maxMonth) * 160;
    return { x, y };
  });
  const chartLine = chartPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const chartArea = `${chartLine} L700 220 L0 220 Z`;
  const monthLabels = monthKeys.map((k) => {
    const [y, m] = k.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("tr-TR", { month: "short" });
  });

  // Pipeline: talepler + deal aşamaları
  const demandCounts = {
    new: (demandRows ?? []).filter((d) => d.status === "new").length,
    active: (demandRows ?? []).filter((d) => d.status === "active").length,
    matched: (demandRows ?? []).filter((d) => d.status === "matched").length,
  };
  const dealWon = (dealRows ?? []).filter((d) => d.stage === "won").length;
  const pipeline = [
    { label: "Yeni talep", value: demandCounts.new, color: "bg-brand-600" },
    { label: "Aktif talep", value: demandCounts.active, color: "bg-cyan-400" },
    { label: "Eşleşen", value: demandCounts.matched, color: "bg-mint-500" },
    { label: "Kazanılan anlaşma", value: dealWon, color: "bg-amber-400" },
  ];
  const pipeMax = Math.max(1, ...pipeline.map((p) => p.value));
  const openDeals = (dealRows ?? []).filter((d) => !["won", "lost"].includes(d.stage)).length;
  const conversion =
    demandCounts.new + demandCounts.active + demandCounts.matched > 0
      ? Math.round((dealWon / Math.max(1, demandCounts.new + demandCounts.active + demandCounts.matched + dealWon)) * 1000) / 10
      : 0;

  // Ekip: atanmış deal değeri
  const byAdvisor = new Map<string, number>();
  (dealRows ?? []).forEach((d) => {
    if (!d.assigned_to) return;
    byAdvisor.set(d.assigned_to, (byAdvisor.get(d.assigned_to) ?? 0) + Number(d.deal_value || 0));
  });
  const team = [...byAdvisor.entries()]
    .map(([id, value]) => {
      const p = (profiles ?? []).find((x) => x.id === id);
      return {
        id,
        name: p?.full_name ?? "Danışman",
        role: p?.role ?? "advisor",
        value,
        initials: initials(p?.full_name ?? "ES"),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // Portal sağlığı gerçek
  const portalMap = new Map<string, { live: number; overdue: number }>();
  (liveListings ?? []).forEach((l) => {
    const cur = portalMap.get(l.portal_name) ?? { live: 0, overdue: 0 };
    cur.live += 1;
    if (daysSince(l.last_confirmed_at) >= 7) cur.overdue += 1;
    portalMap.set(l.portal_name, cur);
  });
  const portalHealthRows = [...portalMap.entries()]
    .map(([name, v]) => ({
      name,
      live: v.live,
      healthy: v.live - v.overdue,
      tone: v.overdue ? "bg-amber-400" : "bg-mint-500",
    }))
    .sort((a, b) => b.live - a.live)
    .slice(0, 5);
  const portalHealthPct =
    (liveListings ?? []).length === 0
      ? 100
      : Math.round((((liveListings ?? []).length - overdueListings.length) / (liveListings ?? []).length) * 100);

  const officeScore = tenantId ? await getOfficeScoreCached(tenantId) : await getCachedOfficeScore();

  const tasks: { t: string; meta: string; tone: "brand" | "warn" | "amber" | "mint" }[] = [
    ...overdueListings.slice(0, 3).map((r) => ({
      t: `${r.portal_name}${r.portal_listing_id ? ` #${r.portal_listing_id}` : ""} — teyit et`,
      meta: `${daysSince(r.last_confirmed_at)} gündür teyit yok`,
      tone: "warn" as const,
    })),
    ...(recentClosures ?? [])
      .filter((c) => Number(c.estimated_lost_commission || 0) > 0)
      .slice(0, 2)
      .map((c) => ({
        t: `Kayıp: ${c.reason}`,
        meta: moneyTry(Number(c.estimated_lost_commission || 0)),
        tone: "amber" as const,
      })),
  ];
  if (openDeals > 0) {
    tasks.push({ t: `${openDeals} açık anlaşma`, meta: "Satış hattını ilerletin", tone: "mint" });
  }
  if (tasks.length === 0) {
    tasks.push({ t: "Portal Kontrol’ü gözden geçir", meta: "Teyit ve kapanışları güncelle", tone: "brand" });
  }

  const custSpark = weekBuckets((customerDates ?? []).map((c) => c.created_at));
  const callSpark = weekBuckets((callDates ?? []).map((c) => c.started_at));
  const commSpark = weekBuckets((commissions ?? []).map((c) => c.created_at));

  const kpis: Kpi[] = [
    {
      label: "Toplam müşteri",
      value: String(customerCount),
      icon: Users,
      trend: "canlı",
      tone: "brand",
      spark: custSpark,
    },
    {
      label: "Bugün gelen arama",
      value: String(callsToday ?? 0),
      icon: PhoneIncoming,
      trend: "canlı",
      tone: "mint",
      spark: callSpark,
    },
    {
      label: "Aktif portföy",
      value: String(propertyCount ?? 0),
      icon: Building2,
      trend: "canlı",
      tone: "brand",
      spark: [0, 0, 0, 0, 0, 0, propertyCount ?? 0],
    },
    {
      label: "Teyitsiz ilan",
      value: String(overdueListings.length),
      icon: FileCheck,
      trend: overdueListings.length ? "dikkat" : "temiz",
      tone: overdueListings.length ? "warn" : "mint",
      spark: [0, 0, 0, 0, 0, 0, overdueListings.length],
    },
    {
      label: "Bekleyen komisyon",
      value: moneyTry(pendingCommission),
      icon: Wallet,
      trend: "canlı",
      tone: "amber",
      spark: commSpark,
    },
    {
      label: "Tahmini kayıp (ay)",
      value: moneyTry(lostMonth),
      icon: Siren,
      trend: lostMonth > 0 ? "kayıp" : "temiz",
      tone: "danger",
      spark: [0, 0, 0, 0, 0, 0, Math.max(0, Math.round(lostMonth / 1000))],
    },
  ];

  // Son 24s unified aktivite feed
  type FeedItem = { key: string; icon: string; text: string; time: string; tone: string };
  const feed24h: FeedItem[] = [
    ...(recentCustomers24h ?? []).map((c) => ({
      key: `cust-${c.id}`,
      icon: "👤",
      text: `Yeni müşteri: ${c.full_name}`,
      time: c.created_at,
      tone: "text-brand-600",
    })),
    ...(recentProperties24h ?? []).map((p) => ({
      key: `prop-${p.id}`,
      icon: "🏠",
      text: `Portföy eklendi: ${p.title ?? p.property_code}`,
      time: p.created_at,
      tone: "text-mint-600",
    })),
    ...(recentCalls24h ?? []).map((c) => ({
      key: `call-${c.id}`,
      icon: c.direction === "inbound" ? "📲" : "📞",
      text: `${c.direction === "inbound" ? "Gelen" : "Giden"} arama: ${c.phone}`,
      time: c.started_at,
      tone: "text-cyan-600",
    })),
    ...(recentAppts24h ?? []).map((a) => ({
      key: `appt-${a.id}`,
      icon: "📅",
      text: `Randevu: ${a.appointment_type === "showing" ? "Yer gösterme" : a.appointment_type}`,
      time: a.scheduled_at,
      tone: "text-amber-600",
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
   .slice(0, 8);

  const actionLabel: Record<string, string> = {
    "workflow.deal_won": "Satış kapandı",
    "deal.stage": "Anlaşma aşaması",
    "deal.create": "Anlaşma oluşturuldu",
    "commission.paid": "Komisyon tahsil",
    "property.create": "Portföy eklendi",
    "customer.create": "Müşteri eklendi",
    "call.create": "Çağrı kaydı",
    "appointment.create": "Randevu",
  };

  const expiringList = expiringAuthority ?? [];

  return (
    <div className="space-y-6">
      {/* Yetki belgesi uyarı kartı — sadece yaklaşan kayıt varsa görünür */}
      {expiringList.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-[16px] border border-amber-400/40 bg-amber-400/[0.06] p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-amber-400/20 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-700">
              {expiringList.length} portföyün yetki belgesi 15 gün içinde bitiyor
            </p>
            <ul className="mt-2 space-y-1">
              {expiringList.map((p) => {
                const expires = new Date(p.authority_expires_at as string);
                const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86_400_000);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-700/80">
                    <Link
                      href={`/app/portfoyler/${p.id}`}
                      className="font-semibold hover:underline"
                    >
                      {p.title ?? p.property_code}
                    </Link>
                    <span className="text-amber-600/60">·</span>
                    <span className={daysLeft <= 5 ? "font-bold text-red-600" : ""}>
                      {daysLeft} gün kaldı
                    </span>
                    <span className="text-amber-600/60">
                      ({expires.toLocaleDateString("tr-TR")})
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <Link
            href="/app/portfoyler"
            className="shrink-0 rounded-[9px] border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-400/20"
          >
            Portföylere git
          </Link>
        </div>
      )}

      <div className="theme-dark relative overflow-hidden rounded-[20px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-40" />
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-600/40 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-white/60">
              {new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold text-white md:text-3xl">Merhaba, {firstName}</h1>
            <p className="mt-1 text-sm text-white/70">Tüm metrikler canlı ofis verisinden — sahte skor yok.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-center backdrop-blur">
              <p className="font-display text-2xl font-extrabold text-mint-400">{officeScore.score}</p>
              <p className="text-[11px] text-white/60">Ofis skoru · {officeScore.label}</p>
            </div>
            <Link
              href="/app/musteriler"
              className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
            >
              <Plus className="h-4 w-4" /> Müşteri
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi, i) => (
          <div key={kpi.label} className="lift rounded-[18px] border border-line bg-surface p-5">
            <div className="flex items-start justify-between">
              <span className={`grid h-10 w-10 place-items-center rounded-[12px] ${toneBg[kpi.tone ?? "brand"]}`}>
                <kpi.icon className="h-5 w-5" />
              </span>
              {kpi.trend ? (
                <span className={`flex items-center gap-1 rounded-full bg-canvas px-2 py-1 text-xs font-semibold ${toneText[kpi.tone ?? "brand"]}`}>
                  <TrendingUp className="h-3 w-3" /> {kpi.trend}
                </span>
              ) : null}
            </div>
            <p className="mt-4 text-sm text-text-muted">{kpi.label}</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <p
                className={`font-display text-2xl font-extrabold tabular-nums ${
                  kpi.tone === "danger"
                    ? "text-danger-500"
                    : kpi.tone === "warn"
                      ? "text-warn-500"
                      : kpi.tone === "amber"
                        ? "text-amber-500"
                        : "text-ink-950"
                }`}
              >
                {kpi.value}
              </p>
              <div className="w-24">
                <Sparkline
                  id={String(i)}
                  data={kpi.spark}
                  color={
                    kpi.tone === "danger"
                      ? "var(--danger-500)"
                      : kpi.tone === "warn"
                        ? "var(--warn-500)"
                        : kpi.tone === "amber"
                          ? "var(--amber-500)"
                          : kpi.tone === "mint"
                            ? "var(--mint-500)"
                            : "var(--brand-600)"
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <section className="dashboard-panel relative overflow-hidden rounded-[20px] border border-line bg-surface p-5 md:p-6">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                <BarChart3 className="h-4 w-4" /> Finansal görünüm
              </p>
              <h2 className="mt-1 font-display text-lg font-bold text-ink-950">Komisyon akışı</h2>
              <p className="mt-1 text-xs text-text-muted">Son 6 ay · gerçek kayıtlar</p>
            </div>
            <div className="flex gap-2">
              <div className="rounded-[11px] bg-mint-500/10 px-3 py-2 text-right">
                <p className="text-[9px] font-semibold text-mint-600">TAHSİL</p>
                <p className="font-display text-lg font-extrabold text-ink-950">{moneyTry(paidCommission)}</p>
              </div>
              <div className="rounded-[11px] bg-amber-400/12 px-3 py-2 text-right">
                <p className="text-[9px] font-semibold text-amber-500">BEKLEYEN</p>
                <p className="font-display text-lg font-extrabold text-ink-950">{moneyTry(pendingCommission)}</p>
              </div>
            </div>
          </div>
          <div className="relative mt-5">
            {monthTotals.every((v) => v === 0) ? (
              <div className="grid h-56 place-items-center rounded-[14px] border border-dashed border-line-strong text-sm text-text-muted">
                Henüz komisyon serisi yok — ilk anlaşma kapanınca grafik dolacak.
              </div>
            ) : (
              <>
                <svg viewBox="0 0 700 220" className="relative h-56 w-full" preserveAspectRatio="none" role="img" aria-label="Komisyon grafiği">
                  <defs>
                    <linearGradient id="appRevenueArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand-600)" stopOpacity=".3" />
                      <stop offset="100%" stopColor="var(--brand-600)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={chartArea} fill="url(#appRevenueArea)" />
                  <path d={chartLine} fill="none" stroke="var(--brand-600)" strokeWidth="4" strokeLinecap="round" className="dashboard-chart-line" />
                  {chartPts.map((p) => (
                    <circle key={p.x} cx={p.x} cy={p.y} r="4" fill="white" stroke="var(--brand-600)" strokeWidth="2" />
                  ))}
                </svg>
                <div className="grid grid-cols-6 text-center text-[10px] text-text-faint">
                  {monthLabels.map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5 md:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
                <PieChart className="h-4 w-4" /> Canlı satış hattı
              </p>
              <h2 className="mt-1 font-display text-lg font-bold text-ink-950">Talep → anlaşma hunisi</h2>
            </div>
            <Link href="/app/anlasmalar" className="text-xs font-semibold text-brand-600">
              Board
            </Link>
          </div>
          <div className="mt-6 space-y-4">
            {pipeline.map((stage, index) => (
              <div key={stage.label}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-text-muted">{stage.label}</span>
                  <span className="font-display font-bold text-ink-950">{stage.value}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`pipeline-fill h-full rounded-full ${stage.color}`}
                    style={{ width: `${Math.max(6, (stage.value / pipeMax) * 100)}%`, animationDelay: `${index * 100}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div>
              <p className="text-[10px] text-text-faint">Kazanma oranı</p>
              <p className="font-display text-xl font-extrabold text-ink-950">%{conversion}</p>
            </div>
            <div>
              <p className="text-[10px] text-text-faint">Açık anlaşma</p>
              <p className="font-display text-xl font-extrabold text-ink-950">{openDeals}</p>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <section className="rounded-[18px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-ink-950">Bugünkü görevler</h2>
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-600">{tasks.length}</span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {tasks.map((task) => (
              <li key={task.t} className="flex items-start gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    task.tone === "warn" ? "bg-warn-500" : task.tone === "amber" ? "bg-amber-500" : task.tone === "mint" ? "bg-mint-500" : "bg-brand-600"
                  }`}
                />
                <span>
                  <span className="block text-sm font-medium text-ink-950">{task.t}</span>
                  <span className="block text-xs text-text-muted">{task.meta}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[18px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-danger-500" />
              <h2 className="font-display font-bold text-ink-950">Kayıp-kaçak</h2>
            </div>
            <Link href="/app/kayip-kacak" className="text-xs font-semibold text-brand-600">
              Detay
            </Link>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            {overdueListings.length > 0 ? (
              <div className="rounded-[12px] border border-warn-500/30 bg-warn-500/5 px-3 py-3">
                <p className="font-semibold text-ink-950">{overdueListings.length} ilanda 7+ gün teyit yok</p>
                <p className="mt-1 text-text-muted">Portal Kontrol’den teyit edin</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-[12px] border border-mint-500/30 bg-mint-500/5 px-3 py-3">
                <Bell className="h-4 w-4 text-mint-600" />
                <p className="font-semibold text-mint-600">Teyit kuyruğu temiz</p>
              </div>
            )}
            {(recentClosures ?? [])
              .filter((c) => Number(c.estimated_lost_commission || 0) > 0)
              .slice(0, 2)
              .map((c) => {
                const listing = Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
                return (
                  <div key={c.id} className="rounded-[12px] border border-danger-500/30 bg-danger-500/5 px-3 py-3">
                    <p className="font-semibold text-ink-950">{c.reason}</p>
                    <p className="mt-1 text-text-muted">
                      {listing?.portal_name ?? "Portal"}
                      {listing?.portal_listing_id ? ` #${listing.portal_listing_id}` : ""} · −
                      {moneyTry(Number(c.estimated_lost_commission || 0))}
                    </p>
                  </div>
                );
              })}
          </div>
        </section>

        <section className="rounded-[18px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-ink-950">Hızlı aksiyonlar</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              href="/app/musteriler"
              className="group flex flex-col items-center gap-2 rounded-[12px] border border-line bg-canvas px-3 py-4 transition hover:border-brand-300 hover:bg-surface"
            >
              <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-brand-600/10 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                <Users className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-ink-950">Müşteri</span>
            </Link>
            <Link
              href="/app/portfoyler"
              className="group flex flex-col items-center gap-2 rounded-[12px] border border-line bg-canvas px-3 py-4 transition hover:border-brand-300 hover:bg-surface"
            >
              <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-mint-500/10 text-mint-600 transition group-hover:bg-mint-500 group-hover:text-white">
                <Building2 className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-ink-950">Portföy</span>
            </Link>
            <Link
              href="/app/arama"
              className="group flex flex-col items-center gap-2 rounded-[12px] border border-line bg-canvas px-3 py-4 transition hover:border-brand-300 hover:bg-surface"
            >
              <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-cyan-500/10 text-cyan-600 transition group-hover:bg-cyan-500 group-hover:text-white">
                <PhoneIncoming className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-ink-950">Arama</span>
            </Link>
            <Link
              href="/app/randevular"
              className="group flex flex-col items-center gap-2 rounded-[12px] border border-line bg-canvas px-3 py-4 transition hover:border-brand-300 hover:bg-surface"
            >
              <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-amber-400/10 text-amber-600 transition group-hover:bg-amber-400 group-hover:text-white">
                <Bell className="h-5 w-5" />
              </div>
              <span className="text-xs font-semibold text-ink-950">Randevu</span>
            </Link>
          </div>
        </section>

        <section className="rounded-[18px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-ink-950">Son müşteriler</h2>
            <Link href="/app/musteriler" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              Tümü <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {latest && latest.length > 0 ? (
            <ul className="mt-4 space-y-2.5">
              {latest.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/app/musteriler/${c.id}`}
                    className="group flex items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-800 text-xs font-bold text-white">
                      {initials(c.full_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-950">{c.full_name}</span>
                      <span className="block text-xs text-text-muted">
                        {c.customer_types && c.customer_types.length > 0 ? c.customer_types[0] : "—"}
                      </span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 rounded-[12px] border border-dashed border-line-strong px-3 py-8 text-center">
              <p className="text-sm text-text-muted">Henüz müşteri yok</p>
              <Link href="/app/musteriler" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
                <Plus className="h-4 w-4" /> İlk müşteriyi ekle
              </Link>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1fr]">
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                <Gauge className="h-4 w-4" /> Yayın ağı
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Portal sağlığı</h2>
            </div>
            <span className="font-display text-2xl font-extrabold text-mint-600">%{portalHealthPct}</span>
          </div>
          <div className="mt-5 space-y-3">
            {portalHealthRows.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-8 text-center text-sm text-text-muted">
                Canlı portal kaydı yok.
              </p>
            ) : (
              portalHealthRows.map((portal) => (
                <div key={portal.name} className="rounded-[11px] border border-line bg-canvas/60 px-3 py-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-semibold text-ink-950">
                      <span className={`h-2 w-2 rounded-full ${portal.tone}`} />
                      {portal.name}
                    </span>
                    <span className="text-text-faint">
                      {portal.healthy}/{portal.live} teyitli
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full ${portal.tone}`}
                      style={{ width: `${portal.live ? (portal.healthy / portal.live) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-500">
                <Trophy className="h-4 w-4" /> Ekip performansı
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Anlaşma değeri liderliği</h2>
            </div>
            <Link href="/app/ekip" className="text-[10px] font-semibold text-brand-600">
              Ekip
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {team.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-8 text-center text-sm text-text-muted">
                Atanmış anlaşma yok — satış hattından anlaşma ekleyin.
              </p>
            ) : (
              team.map((member, index) => (
                <div
                  key={member.id}
                  className="group flex items-center gap-3 rounded-[12px] border border-line bg-canvas/60 p-3 transition hover:border-brand-300 hover:bg-surface"
                >
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-extrabold ${
                      index === 0 ? "bg-amber-400 text-ink-950" : "bg-ink-950/5 text-text-muted"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[image:var(--grad-brand)] text-[10px] font-bold text-white">
                    {member.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink-950">{member.name}</p>
                    <p className="truncate text-[10px] text-text-faint">{member.role}</p>
                  </div>
                  <p className="text-xs font-bold text-ink-950">{moneyTry(member.value)}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
                <Zap className="h-4 w-4" /> Canlı akış
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Son 24 saat</h2>
            </div>
            <Link href="/app/denetim" className="text-[10px] font-semibold text-brand-600">
              Denetim
            </Link>
          </div>
          <div className="relative mt-5 space-y-3 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
            {feed24h.length === 0 ? (
              <p className="text-sm text-text-muted">Son 24 saatte aktivite yok.</p>
            ) : (
              feed24h.map((item) => (
                <div key={item.key} className="relative flex gap-3">
                  <span className="z-10 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-line bg-surface text-base">
                    {item.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-xs font-semibold ${item.tone}`}>{item.text}</p>
                  </div>
                  <span className="shrink-0 text-[9px] text-text-faint">
                    {new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.time))}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
