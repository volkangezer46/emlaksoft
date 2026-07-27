import Link from "next/link";
import { Suspense } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  FileCheck,
  Gauge,
  MessageCircle,
  Phone,
  PhoneIncoming,
  PieChart,
  Plus,
  Radar,
  Siren,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Tv,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { moneyTry } from "@/lib/leak-shield";
import { getCachedOfficeScore, getOfficeScoreCached } from "@/lib/office-score";
import { requireModulePage } from "@/lib/require-module-page";
import { DAY_MS, daysAgoIso, msUntil, msSince } from "@/lib/clock";
import { buildDailyBriefing, type BriefingItem } from "@/lib/briefing";
import { generateBriefingSummary } from "@/lib/ai/briefing-summary";
import { computeLeadScore } from "@/lib/lead-score";
import { clearSampleDataForm } from "@/app/actions/sample-data";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OdometerNumber } from "./odometer-number";
import { SampleDataCta } from "./sample-data-cta";
import { AppointmentConfirmButton, TaskQuickRow } from "./dashboard-quick-actions";
import { TvAutoRefresh, TvClock } from "./tv-mode";
import { ProductTour } from "./product-tour";
import { DashboardWidgetProvider, Widget, WidgetEditToggle } from "./dashboard-widgets";
import { AnnouncementsBanner } from "@/components/app/announcements-banner";

type Kpi = {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string;
  trendData?: TrendInfo;
  tone?: "danger" | "warn" | "amber" | "mint" | "brand";
  spark: number[];
  href: string;
};

type TrendInfo = { label: string; dir: "up" | "down" | "flat" | "new"; good?: boolean };

/**
 * Dönem karşılaştırma rozeti — "%+12" / "%-8" / "%0"; önceki dönem 0 ise
 * oran anlamsız olduğundan "yeni" döner. `invert` kayıp gibi "artışı kötü"
 * metriklerde iyi/kötü rengini çevirir (ok yönü gerçek yönü gösterir).
 */
function calcTrend(current: number, previous: number, invert = false): TrendInfo {
  if (previous <= 0) {
    return current > 0 ? { label: "yeni", dir: "new" } : { label: "%0", dir: "flat" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { label: "%0", dir: "flat" };
  const up = pct > 0;
  return {
    label: `%${up ? "+" : "-"}${Math.abs(pct)}`,
    dir: up ? "up" : "down",
    good: invert ? !up : up,
  };
}

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

/** Dönem karşılaştırma rozeti: yeşil ↑ / kırmızı ↓ / nötr → ("yeni" KPI tonunda). */
function TrendBadge({ trend, tone }: { trend: TrendInfo; tone?: string }) {
  const Icon = trend.dir === "down" ? TrendingDown : trend.dir === "flat" ? ArrowRight : TrendingUp;
  const cls =
    trend.dir === "new"
      ? toneText[tone ?? "brand"]
      : trend.dir === "flat"
        ? "text-text-muted"
        : trend.good
          ? "text-mint-600"
          : "text-danger-500";
  return (
    <span className={`flex items-center gap-1 rounded-full bg-canvas px-2 py-1 text-xs font-semibold tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" /> {trend.label}
    </span>
  );
}

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

// customer_lead_signals RPC satırı — bkz. /app/musteriler sayfasındaki aynı desen
type LeadSignalRow = {
  customer_id: string;
  active_demands: number;
  comms: number;
  appts: number;
  calls: number;
  last_activity: string | null;
};

/**
 * Opsiyonel AI özet satırı — Suspense içinde ayrı stream edilir, sayfanın
 * ilk boyamasını bekletmez. OpenAI anahtarı yoksa/hata olursa hiç görünmez.
 */
async function BriefingAiLine({ items }: { items: BriefingItem[] }) {
  const summary = await generateBriefingSummary(items);
  if (!summary) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-[10px] bg-brand-600/[0.06] px-3 py-2 text-xs font-medium text-brand-600">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{summary}</span>
    </p>
  );
}

export default async function AppHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ tv?: string }>;
}) {
  const { tv = "" } = (await searchParams) ?? {};
  const tvMode = tv === "1";

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
  // targets.period_start date kolonu "YYYY-AA-01" tutar (bkz. actions/targets-openhouse-sources)
  const monthStartKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const fifteenDaysFromNow = new Date();
  fifteenDaysFromNow.setDate(fifteenDaysFromNow.getDate() + 15);

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Dönem karşılaştırmaları için önceki dönem sınırları
  const prevMonthStart = new Date(monthStart);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  const yesterdayStart = new Date(dayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const last24h = daysAgoIso(1);

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
    { data: customerDates },
    { data: expiringAuthority },
    { data: recentCustomers24h },
    { data: recentCalls24h },
    { data: recentAppts24h },
    { data: recentProperties24h },
    { data: todayAppts, count: todayApptsTotal },
    { count: customersThisMonth },
    { count: customersPrevMonth },
    { count: callsYesterday },
    { data: prevMonthClosures },
    { count: tasksDueToday },
    { count: tasksOverdue },
    { data: briefCustomers },
    { data: leadSignals },
    { data: openTasks },
    { data: tenantRow },
    { data: officeTarget },
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
      .gte("started_at", daysAgoIso(49))
      .order("started_at", { ascending: false })
      .limit(100),
    supabase.from("customer_demands").select("status").neq("status", "closed").limit(200),
    // Son 3 ay + limit
    supabase
      .from("deals")
      .select("stage, deal_value, assigned_to, updated_at")
      .gte("updated_at", daysAgoIso(90))
      .limit(100),
    supabase.from("profiles").select("id, full_name, role").limit(50),
    // 500 → 100, sadece 7 haftalık pencere
    supabase
      .from("customers")
      .select("created_at")
      .is("deleted_at", null)
      .gte("created_at", daysAgoIso(49))
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
    // Son 24s — müşteri eklemeler (telefon: hızlı ara/WhatsApp aksiyonu için)
    supabase.from("customers").select("id, full_name, phone, created_at").is("deleted_at", null)
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
    // Bugünkü randevular (widget + brifing) — count: brifingde gerçek toplam gerekir
    supabase.from("appointments").select("id, appointment_type, scheduled_at, status, customer:customers(full_name, phone)", { count: "exact" })
      .gte("scheduled_at", dayStart.toISOString()).lt("scheduled_at", dayEnd.toISOString())
      .order("scheduled_at", { ascending: true }).limit(5),
    // Trend rozetleri — yalnız sayaç (head:true), satır çekilmez
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null)
      .gte("created_at", monthStart.toISOString()),
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null)
      .gte("created_at", prevMonthStart.toISOString()).lt("created_at", monthStart.toISOString()),
    supabase.from("calls").select("id", { count: "exact", head: true })
      .gte("started_at", yesterdayStart.toISOString()).lt("started_at", dayStart.toISOString()),
    // Geçen ay kayıp toplamı — tutar toplamı gerektiği için dar satır seti
    supabase.from("listing_closures").select("estimated_lost_commission")
      .gte("created_at", prevMonthStart.toISOString()).lt("created_at", monthStart.toISOString()).limit(50),
    // Brifing — bugün vadesi gelen açık görevler (yalnız sayaç)
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "open")
      .gte("due_at", dayStart.toISOString()).lt("due_at", dayEnd.toISOString()),
    // Brifing — vadesi geçmiş (bugünden önce) açık görevler (yalnız sayaç)
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "open").lt("due_at", dayStart.toISOString()),
    // Brifing — sıcak lead sayısı için müşteri sinyalleri (bkz. /app/musteriler deseni)
    supabase.from("customers").select("id, phone, email, source, blacklist, created_at")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    tenantId
      ? supabase.rpc("customer_lead_signals", { p_tenant_id: tenantId })
      : Promise.resolve({ data: [] as LeadSignalRow[] }),
    // Bugünün gerçek görevleri (gecikmiş dahil) — hover'da tek tıkla tamamlanır
    supabase.from("tasks").select("id, title, due_at, priority")
      .eq("status", "open").lt("due_at", dayEnd.toISOString())
      .order("due_at", { ascending: true }).limit(3),
    // Ofis adı (TV modu üst satırı) + örnek veri durumu (onboarding CTA/şeridi)
    tenantId
      ? supabase.from("tenants").select("name, sample_seeded_at").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null as { name: string; sample_seeded_at: string | null } | null }),
    // Bu ayın OFİS GENELİ hedefi (profile_id null) — yoksa hedef kartı gizli
    supabase
      .from("targets")
      .select("target_deals, target_revenue")
      .eq("period", "monthly")
      .eq("period_start", monthStartKey)
      .is("profile_id", null)
      .maybeSingle(),
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
  const chartLast = chartPts[chartPts.length - 1] ?? null;
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
  // /app/talepler mevcut ?status= paramını kullanıyor (new|active|matched)
  const pipeline = [
    { label: "Yeni talep", value: demandCounts.new, color: "bg-brand-600", href: "/app/talepler?status=new" },
    { label: "Aktif talep", value: demandCounts.active, color: "bg-cyan-400", href: "/app/talepler?status=active" },
    { label: "Eşleşen", value: demandCounts.matched, color: "bg-mint-500", href: "/app/talepler?status=matched" },
    { label: "Kazanılan anlaşma", value: dealWon, color: "bg-amber-400", href: "/app/anlasmalar" },
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

  const tasks: { t: string; meta: string; tone: "brand" | "warn" | "amber" | "mint"; href: string }[] = [
    ...overdueListings.slice(0, 3).map((r) => ({
      t: `${r.portal_name}${r.portal_listing_id ? ` #${r.portal_listing_id}` : ""} — teyit et`,
      meta: `${daysSince(r.last_confirmed_at)} gündür teyit yok`,
      tone: "warn" as const,
      href: "/app/portallar?durum=teyit",
    })),
    ...(recentClosures ?? [])
      .filter((c) => Number(c.estimated_lost_commission || 0) > 0)
      .slice(0, 2)
      .map((c) => ({
        t: `Kayıp: ${c.reason}`,
        meta: moneyTry(Number(c.estimated_lost_commission || 0)),
        tone: "amber" as const,
        href: "/app/kayip-kacak",
      })),
  ];
  if (openDeals > 0) {
    tasks.push({ t: `${openDeals} açık anlaşma`, meta: "Satış hattını ilerletin", tone: "mint", href: "/app/anlasmalar" });
  }
  if (tasks.length === 0) {
    tasks.push({ t: "Portal Kontrol’ü gözden geçir", meta: "Teyit ve kapanışları güncelle", tone: "brand", href: "/app/portallar" });
  }

  // Bugünün gerçek görevleri — tek tıkla tamamlanabilir satırlar
  const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const dueTasks = (openTasks ?? []).map((t) => {
    const overdueDays = t.due_at
      ? Math.max(0, Math.floor((dayStart.getTime() - new Date(t.due_at).getTime()) / DAY_MS))
      : 0;
    return {
      id: t.id as string,
      title: (t.title as string) ?? "Görev",
      meta: t.due_at
        ? overdueDays > 0
          ? `${overdueDays} gün gecikmiş`
          : `Bugün ${timeFmt.format(new Date(t.due_at))}`
        : "Vadesiz",
      urgent: overdueDays > 0 || t.priority === "high",
    };
  });

  const custSpark = weekBuckets((customerDates ?? []).map((c) => c.created_at));
  const callSpark = weekBuckets((callDates ?? []).map((c) => c.started_at));
  const commSpark = weekBuckets((commissions ?? []).map((c) => c.created_at));

  // Gerçek dönem karşılaştırmaları — bu ay vs geçen ay / bugün vs dün.
  // Komisyon trendi mevcut monthTotals serisinden (son 2 ay), ek sorgu yok.
  const lostPrevMonth = (prevMonthClosures ?? []).reduce(
    (sum, row) => sum + Number(row.estimated_lost_commission || 0),
    0,
  );
  const customerTrend = calcTrend(customersThisMonth ?? 0, customersPrevMonth ?? 0);
  const callTrend = calcTrend(callsToday ?? 0, callsYesterday ?? 0);
  const commissionTrend = calcTrend(monthTotals[5] ?? 0, monthTotals[4] ?? 0);
  const lostTrend = calcTrend(lostMonth, lostPrevMonth, true);

  // Aylık ofis hedefi kartı — gerçekleşen gelir: bu ay oluşan komisyon toplamı
  // (mevcut monthTotals serisinin son ayı, ek sorgu yok); anlaşma: bu ay won'a
  // geçen kartlar (dealRows updated_at yaklaşımı — won sonrası güncelleme nadir).
  const targetRevenue = Number(officeTarget?.target_revenue ?? 0);
  const targetDeals = Number(officeTarget?.target_deals ?? 0);
  const monthCommission = monthTotals[5] ?? 0;
  const monthStartIso = monthStart.toISOString();
  const wonThisMonth = (dealRows ?? []).filter(
    (d) => d.stage === "won" && (d.updated_at ?? "") >= monthStartIso,
  ).length;
  const targetRevenuePct = targetRevenue > 0 ? Math.round((monthCommission / targetRevenue) * 100) : 0;
  const targetDealsPct = targetDeals > 0 ? Math.round((wonThisMonth / targetDeals) * 100) : 0;
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  const monthElapsedPct = Math.max(
    0,
    Math.min(100, Math.round((msSince(monthStart) / (monthEnd.getTime() - monthStart.getTime())) * 100)),
  );
  // Tempo: /app/hedefler ile aynı 10 puanlık tolerans — geride kalınca amber
  const targetProgress = Math.max(targetRevenuePct, targetDealsPct);
  const targetBehind = monthElapsedPct < 100 && targetProgress < monthElapsedPct - 10;
  const targetExceeded = targetRevenue > 0 && targetRevenuePct >= 100;
  const showTargetCard = Boolean(officeTarget) && (targetRevenue > 0 || targetDeals > 0);

  const kpis: Kpi[] = [
    {
      label: "Toplam müşteri",
      value: String(customerCount),
      icon: Users,
      trendData: customerTrend,
      tone: "brand",
      spark: custSpark,
      href: "/app/musteriler",
    },
    {
      label: "Bugün gelen arama",
      value: String(callsToday ?? 0),
      icon: PhoneIncoming,
      trendData: callTrend,
      tone: "mint",
      spark: callSpark,
      href: "/app/arama",
    },
    {
      label: "Aktif portföy",
      value: String(propertyCount ?? 0),
      icon: Building2,
      trend: "canlı",
      tone: "brand",
      spark: [0, 0, 0, 0, 0, 0, propertyCount ?? 0],
      href: "/app/portfoyler",
    },
    {
      label: "Teyitsiz ilan",
      value: String(overdueListings.length),
      icon: FileCheck,
      trend: overdueListings.length ? "dikkat" : "temiz",
      tone: overdueListings.length ? "warn" : "mint",
      spark: [0, 0, 0, 0, 0, 0, overdueListings.length],
      href: "/app/portallar?durum=teyit",
    },
    {
      label: "Bekleyen komisyon",
      value: moneyTry(pendingCommission),
      icon: Wallet,
      trendData: commissionTrend,
      tone: "amber",
      spark: commSpark,
      href: "/app/komisyon?durum=bekleyen",
    },
    {
      label: "Tahmini kayıp (ay)",
      value: moneyTry(lostMonth),
      icon: Siren,
      trendData: lostTrend,
      tone: "danger",
      spark: [0, 0, 0, 0, 0, 0, Math.max(0, Math.round(lostMonth / 1000))],
      href: "/app/kayip-kacak",
    },
  ];

  // Son 24s unified aktivite feed — tip bazlı hızlı aksiyonlarla
  type FeedAction = { key: string; kind: "tel" | "wa" | "link"; href: string; label?: string };
  type FeedItem = { key: string; icon: string; text: string; time: string; tone: string; href: string; actions?: FeedAction[] };
  const feed24h: FeedItem[] = [
    ...(recentCustomers24h ?? []).map((c) => ({
      key: `cust-${c.id}`,
      icon: "👤",
      text: `Yeni müşteri: ${c.full_name}`,
      time: c.created_at,
      tone: "text-brand-600",
      href: `/app/musteriler/${c.id}`,
      actions: c.phone
        ? [
            { key: "tel", kind: "tel" as const, href: `tel:${c.phone}` },
            { key: "wa", kind: "wa" as const, href: `https://wa.me/${String(c.phone).replace(/\D/g, "")}` },
          ]
        : [],
    })),
    ...(recentProperties24h ?? []).map((p) => ({
      key: `prop-${p.id}`,
      icon: "🏠",
      text: `Portföy eklendi: ${p.title ?? p.property_code}`,
      time: p.created_at,
      tone: "text-mint-600",
      href: `/app/portfoyler/${p.id}`,
      actions: [
        { key: "portal", kind: "link" as const, href: `/app/portallar?property=${p.id}`, label: "Portala bas →" },
      ],
    })),
    ...(recentCalls24h ?? []).map((c) => ({
      key: `call-${c.id}`,
      icon: c.direction === "inbound" ? "📲" : "📞",
      text: `${c.direction === "inbound" ? "Gelen" : "Giden"} arama: ${c.phone}`,
      time: c.started_at,
      tone: "text-cyan-600",
      href: "/app/arama",
      actions: c.phone ? [{ key: "tel", kind: "tel" as const, href: `tel:${c.phone}` }] : [],
    })),
    ...(recentAppts24h ?? []).map((a) => ({
      key: `appt-${a.id}`,
      icon: "📅",
      text: `Randevu: ${a.appointment_type === "showing" ? "Yer gösterme" : a.appointment_type}`,
      time: a.scheduled_at,
      tone: "text-amber-600",
      href: "/app/randevular",
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
   .slice(0, 8);

  // Bugünkü randevular widget'ı — customer join'i obje/dizi gelebilir
  const apptTypeLabel: Record<string, string> = {
    showing: "Yer gösterme",
    office: "Ofis görüşmesi",
    valuation: "Değerleme",
    contract: "Sözleşme",
  };
  const todayAppointments = (todayAppts ?? []).map((a) => {
    const cust = Array.isArray(a.customer) ? a.customer[0] : a.customer;
    return {
      id: a.id,
      time: timeFmt.format(new Date(a.scheduled_at)),
      type: apptTypeLabel[a.appointment_type] ?? a.appointment_type,
      status: a.status as string,
      customerName: cust?.full_name ?? null,
      customerPhone: (cust?.phone as string | null | undefined) ?? null,
    };
  });

  const expiringList = expiringAuthority ?? [];
  const officeName = (tenantRow as { name?: string } | null)?.name ?? "EmlakSoft Ofis";

  // Örnek veri onboarding'i — boş ofiste (müşteri+portföy 0, hiç yüklenmemiş)
  // hero altında CTA; yüklüyken üstte ince amber şerit (bkz. actions/sample-data.ts)
  const sampleSeededAt =
    (tenantRow as { sample_seeded_at?: string | null } | null)?.sample_seeded_at ?? null;
  const showSampleCta =
    !tvMode && customerCount === 0 && (propertyCount ?? 0) === 0 && !sampleSeededAt;

  // Sıcak lead sayısı — /app/musteriler ile aynı skor mantığı (lib/lead-score)
  const signalMap = new Map<string, LeadSignalRow>();
  for (const s of (leadSignals ?? []) as LeadSignalRow[]) signalMap.set(s.customer_id, s);
  const hotLeadCount = (briefCustomers ?? []).filter((c) => {
    const s = signalMap.get(c.id);
    return (
      computeLeadScore({
        hasPhone: Boolean(c.phone),
        hasEmail: Boolean(c.email),
        source: c.source,
        activeDemands: s?.active_demands ?? 0,
        communications: s?.comms ?? 0,
        appointments: s?.appts ?? 0,
        calls: s?.calls ?? 0,
        lastActivityAt: s?.last_activity ?? null,
        createdAt: c.created_at,
        blacklist: Boolean(c.blacklist),
      }).tier === "hot"
    );
  }).length;

  // Günaydın brifingi — kural tabanlı, hazır sayılardan (bkz. lib/briefing)
  const briefingItems = buildDailyBriefing({
    todayAppointments: todayApptsTotal ?? todayAppointments.length,
    firstAppointment: todayAppointments[0]
      ? { time: todayAppointments[0].time, type: todayAppointments[0].type }
      : null,
    expiringAuthority: expiringList.length,
    tasksDueToday: tasksDueToday ?? 0,
    tasksOverdue: tasksOverdue ?? 0,
    unconfirmedListings: overdueListings.length,
    hotLeads: hotLeadCount,
    pendingCommission,
  });

  return (
    <DashboardWidgetProvider>
    <div className={tvMode ? "tv-zoom space-y-6" : "space-y-6"}>
      {/* İlk giriş ürün turu — TV modunda hiç mount edilmez (bileşen içinde de kontrol var) */}
      {!tvMode && <ProductTour />}
      {/* TV modu: üst bilgi satırı (ofis adı + canlı saat) + 60sn otomatik yenileme */}
      {tvMode && (
        <>
          <TvAutoRefresh intervalMs={60_000} />
          <div className="theme-dark flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-[image:var(--grad-ink)] px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="status-pulse h-2.5 w-2.5 rounded-full bg-mint-400" />
              <p className="font-display text-lg font-bold text-white">{officeName}</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/70">
                Canlı panel · 60 sn’de bir yenilenir
              </span>
            </div>
            <div className="flex items-center gap-4">
              <TvClock />
              <Link
                href="/app"
                className="focus-ring press rounded-[9px] border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                Çık
              </Link>
            </div>
          </div>
        </>
      )}

      {/* Örnek veri yüklüyken ince amber bilgi şeridi — temizleme kalıcıdır, onaylı */}
      {!tvMode && sampleSeededAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-400/40 bg-amber-400/[0.08] px-4 py-2.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            Örnek verilerle geziyorsunuz — hazır olduğunuzda temizleyip kendi kayıtlarınızı ekleyin.
          </p>
          <ConfirmDialog
            trigger={
              <button
                type="button"
                className="focus-ring press shrink-0 rounded-[8px] border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-400/20"
              >
                Temizle
              </button>
            }
            title="Örnek veriler silinsin mi?"
            description="Tüm örnek müşteri, portföy, talep, görev, randevu ve anlaşma kayıtları kalıcı olarak silinir. Gerçek kayıtlarınıza dokunulmaz."
            confirmLabel="Kalıcı sil"
            formAction={clearSampleDataForm}
          />
        </div>
      )}

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
                const daysLeft = Math.ceil(msUntil(expires) / DAY_MS);
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

      {/* Günaydın brifingi — kural tabanlı günün özeti; madde yoksa gizli */}
      {briefingItems.length > 0 && (
        <section data-tour="brifing" className="surface-card rounded-[18px] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-ink-950">
              {fullName ? `Günaydın, ${firstName}` : "Günaydın"} — bugünün özeti
            </h2>
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-600">
              {briefingItems.length}
            </span>
          </div>
          {/* grid-cols-[minmax(0,1fr)]: truncate'li içerik li'yi min-content'e açıp
              mobilde yatay taşma yaratıyordu */}
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {briefingItems.map((item) => (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  className="focus-ring group flex items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-base ${toneBg[item.tone]}`}>
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-950">{item.text}</span>
                  <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
          <Suspense fallback={null}>
            <BriefingAiLine items={briefingItems} />
          </Suspense>
        </section>
      )}

      {/* Ofis duyuru bandı — okunmamış aktif duyuru yoksa kendini gizler */}
      {!tvMode && <AnnouncementsBanner />}

      {/* Hero — katmanlı derinlik: aurora + noise + grid + gradient hairline çerçeve.
          data-tour="brifing" burada yedek hedef: brifing kartı koşullu render edilir,
          yoksa tur ilk adımda hero'yu spotlar (querySelector ilk görüneni alır). */}
      <div data-tour="brifing" className="premium-ring rounded-[26px]">
        <div className="theme-dark relative overflow-hidden rounded-[26px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
          <div className="hero-aurora" style={{ inset: "-45% -10%", height: "220%", opacity: 0.4 }} />
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-40" />
          <div className="noise pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay" />
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-600/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-mint-500/25 blur-3xl" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white/60">
                {new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold text-white md:text-3xl">Merhaba, {firstName}</h1>
              <p className="mt-1 text-sm text-white/70">Tüm metrikler canlı ofis verisinden — sahte skor yok.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/app/raporlar"
                className="focus-ring press block rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-center backdrop-blur transition hover:border-white/25 hover:bg-white/10"
              >
                <p className="font-display text-2xl font-extrabold text-mint-400">{officeScore.score}</p>
                <p className="text-[11px] text-white/60">Ofis skoru · {officeScore.label}</p>
              </Link>
              {!tvMode && (
                <>
                  <Link
                    href="/app/musteriler"
                    className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
                  >
                    <Plus className="h-4 w-4" /> Müşteri
                  </Link>
                  <div className="flex items-center gap-2">
                    <WidgetEditToggle className="border-white/15 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white" />
                    <Link
                      href="/app?tv=1"
                      title="TV modu — büyük ekran görünümü"
                      aria-label="TV modunu aç"
                      className="focus-ring press grid h-9 w-9 place-items-center rounded-[10px] border border-white/15 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
                    >
                      <Tv className="h-4 w-4" />
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Aylık ofis hedefi — targets (profile_id null, bu ay); tanımlı hedef yoksa gizli */}
      {showTargetCard && (
        <Link
          href="/app/hedefler"
          className="surface-card focus-ring group block rounded-[18px] p-5 transition hover:border-brand-300"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
              <Trophy className="h-4 w-4" /> Aylık hedef
              <span className="font-medium text-text-faint">
                · ofis geneli · ayın %{monthElapsedPct}&apos;i geçti
              </span>
            </p>
            {targetExceeded ? (
              <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600">
                Hedef aşıldı 🎉
              </span>
            ) : (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${
                  targetBehind ? "bg-amber-400/15 text-amber-600" : "bg-brand-600/10 text-brand-600"
                }`}
              >
                %{targetRevenue > 0 ? targetRevenuePct : targetDealsPct}
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-[1.6fr_1fr]">
            {targetRevenue > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-text-muted">Komisyon geliri</span>
                  <span className="font-semibold tabular-nums text-ink-950">
                    {moneyTry(monthCommission)} / {moneyTry(targetRevenue)}
                  </span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`h-full rounded-full transition-all ${
                      targetExceeded ? "bg-mint-500" : targetBehind ? "bg-amber-400" : "bg-[image:var(--grad-brand)]"
                    }`}
                    style={{ width: `${Math.min(100, targetRevenuePct)}%` }}
                  />
                  {/* Ayın geçen yüzdesi referans çizgisi (bkz. /app/hedefler tempo çubuğu) */}
                  <div className="absolute inset-y-0 w-0.5 bg-ink-950/30" style={{ left: `${monthElapsedPct}%` }} />
                </div>
              </div>
            )}
            {targetDeals > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-text-muted">Anlaşma</span>
                  <span className="font-semibold tabular-nums text-ink-950">
                    {wonThisMonth} / {targetDeals}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`h-full rounded-full transition-all ${
                      targetDealsPct >= 100 ? "bg-mint-500" : targetBehind ? "bg-amber-400" : "bg-brand-600"
                    }`}
                    style={{ width: `${Math.min(100, targetDealsPct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </Link>
      )}

      {/* Boş ofis onboarding'i — örnek veriyle keşif CTA'sı (koşul yukarıda) */}
      {showSampleCta && <SampleDataCta />}

      {/* KPI kartları — 3D mikro-tilt + ton glow + odometre + stagger giriş */}
      <div data-tour="kpi" className="stagger-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi, i) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className={`focus-ring press tilt-card kpi-glow kpi-glow-${kpi.tone ?? "brand"} group block rounded-[18px] border border-line bg-surface p-5 hover:border-brand-300`}
          >
            <div className="flex items-start justify-between">
              <span className={`kpi-chip-shine grid h-10 w-10 place-items-center rounded-[12px] ${toneBg[kpi.tone ?? "brand"]}`}>
                <kpi.icon className="h-5 w-5" />
              </span>
              <span className="flex items-center gap-2">
                {kpi.trendData ? (
                  <TrendBadge trend={kpi.trendData} tone={kpi.tone} />
                ) : kpi.trend ? (
                  <span className={`flex items-center gap-1 rounded-full bg-canvas px-2 py-1 text-xs font-semibold ${toneText[kpi.tone ?? "brand"]}`}>
                    <TrendingUp className="h-3 w-3" /> {kpi.trend}
                  </span>
                ) : null}
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </span>
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
                <OdometerNumber value={kpi.value} />
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
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Widget id="komisyon" className="h-full">
        <section className="dashboard-panel surface-card relative h-full overflow-hidden rounded-[20px] p-5 md:p-6">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                <BarChart3 className="h-4 w-4" /> Finansal görünüm
              </p>
              <h2 className="mt-1 font-display text-lg font-bold text-ink-950">Komisyon akışı</h2>
              <p className="mt-1 text-xs text-text-muted">Son 6 ay · gerçek kayıtlar</p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/app/komisyon?durum=tahsil"
                className="focus-ring press block rounded-[11px] bg-mint-500/10 px-3 py-2 text-right transition hover:bg-mint-500/20"
              >
                <p className="text-[11px] font-semibold text-mint-600">TAHSİL</p>
                <p className="font-display text-lg font-extrabold text-ink-950">
                  <OdometerNumber value={moneyTry(paidCommission)} />
                </p>
              </Link>
              <Link
                href="/app/komisyon?durum=bekleyen"
                className="focus-ring press block rounded-[11px] bg-amber-400/12 px-3 py-2 text-right transition hover:bg-amber-400/25"
              >
                <p className="text-[11px] font-semibold text-amber-500">BEKLEYEN</p>
                <p className="font-display text-lg font-extrabold text-ink-950">
                  <OdometerNumber value={moneyTry(pendingCommission)} />
                </p>
              </Link>
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
                      <stop offset="0%" stopColor="var(--brand-600)" stopOpacity=".38" />
                      <stop offset="55%" stopColor="var(--brand-500)" stopOpacity=".14" />
                      <stop offset="100%" stopColor="var(--mint-500)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Grid çizgileri — %5 opaklık, veri öne çıkar */}
                  {[30, 78, 126, 174].map((y) => (
                    <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="var(--ink-950)" strokeOpacity="0.05" strokeWidth="1" />
                  ))}
                  <path d={chartArea} fill="url(#appRevenueArea)" />
                  <path d={chartLine} fill="none" stroke="var(--brand-600)" strokeWidth="4" strokeLinecap="round" className="dashboard-chart-line" />
                  {chartPts.map((p) => (
                    <circle key={p.x} cx={p.x} cy={p.y} r="4" fill="white" stroke="var(--brand-600)" strokeWidth="2" />
                  ))}
                  {/* Son değere canlı glow-dot */}
                  {chartLast && (
                    <>
                      <circle className="glow-halo" cx={chartLast.x} cy={chartLast.y} r="7" fill="var(--brand-500)" opacity="0.4" />
                      <circle className="glow-dot" cx={chartLast.x} cy={chartLast.y} r="4" fill="var(--brand-600)" stroke="white" strokeWidth="1.5" />
                    </>
                  )}
                </svg>
                <div className="grid grid-cols-6 text-center text-[11px] text-text-faint">
                  {monthLabels.map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
        </Widget>

        <Widget id="huni" className="h-full">
        <section className="dashboard-panel surface-card h-full rounded-[20px] p-5 md:p-6">
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
              <Link
                key={stage.label}
                href={stage.href}
                className="focus-ring group -mx-1 block rounded-[10px] px-1 py-0.5 transition hover:bg-brand-600/[0.04]"
              >
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-text-muted transition group-hover:text-brand-600">{stage.label}</span>
                  <span className="flex items-center gap-1.5 font-display font-bold text-ink-950">
                    {stage.value}
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className={`pipeline-fill h-full rounded-full ${stage.color}`}
                    style={{ width: `${Math.max(6, (stage.value / pipeMax) * 100)}%`, animationDelay: `${index * 100}ms` }}
                  />
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <Link href="/app/anlasmalar" className="focus-ring group block rounded-[10px] p-1 -m-1 transition hover:bg-brand-600/[0.04]">
              <p className="text-[11px] text-text-faint transition group-hover:text-brand-600">Kazanma oranı</p>
              <p className="font-display text-xl font-extrabold text-ink-950">%{conversion}</p>
            </Link>
            <Link href="/app/anlasmalar" className="focus-ring group block rounded-[10px] p-1 -m-1 transition hover:bg-brand-600/[0.04]">
              <p className="text-[11px] text-text-faint transition group-hover:text-brand-600">Açık anlaşma</p>
              <p className="font-display text-xl font-extrabold text-ink-950">{openDeals}</p>
            </Link>
          </div>
        </section>
        </Widget>
      </div>

      <div className="stagger-grid grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {/* Görevler + randevular aynı grid hücresinde — 4 kolonlu düzen bozulmaz */}
        <div className="space-y-4">
          <Widget id="gorevler">
          <section data-tour="aksiyonlar" className="surface-card rounded-[18px] p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-ink-950">Bugünkü görevler</h2>
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-600">
                  {dueTasks.length + tasks.length}
                </span>
                <Link href="/app/gorevler" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                  Tümü <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </span>
            </div>
            <ul className="mt-4 space-y-2.5">
              {/* Gerçek görev kayıtları — hover'da tek tıkla "Tamamla" */}
              {dueTasks.map((task) => (
                <li key={task.id}>
                  <TaskQuickRow id={task.id} showAction={!tvMode}>
                    <div className="relative flex items-start gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 transition group-hover/task:border-brand-300 group-hover/task:bg-surface">
                      <Link
                        href="/app/gorevler"
                        className="focus-ring absolute inset-0 rounded-[12px]"
                        aria-label={task.title}
                      />
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${task.urgent ? "bg-danger-500" : "bg-brand-600"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-950">{task.title}</span>
                        <span className={`block text-xs ${task.urgent ? "font-semibold text-danger-500" : "text-text-muted"}`}>
                          {task.meta}
                        </span>
                      </span>
                    </div>
                  </TaskQuickRow>
                </li>
              ))}
              {tasks.map((task) => (
                <li key={task.t}>
                  <Link
                    href={task.href}
                    className="focus-ring group flex items-start gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
                  >
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        task.tone === "warn" ? "bg-warn-500" : task.tone === "amber" ? "bg-amber-500" : task.tone === "mint" ? "bg-mint-500" : "bg-brand-600"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-950">{task.t}</span>
                      <span className="block text-xs text-text-muted">{task.meta}</span>
                    </span>
                    <ArrowUpRight className="hover-action mt-1 h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          </Widget>

          <Widget id="randevular">
          <section className="surface-card rounded-[18px] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-amber-500" />
                <h2 className="font-display font-bold text-ink-950">Bugünkü randevular</h2>
              </div>
              <Link href="/app/randevular" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                Tümü <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {todayAppointments.length === 0 ? (
              <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-3 py-6 text-center text-sm text-text-muted">
                Bugün planlı randevu yok.
              </p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {todayAppointments.map((appt) => (
                  <li key={appt.id} className="group relative">
                    <div className="flex items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5 transition group-hover:border-brand-300 group-hover:bg-surface">
                      <Link
                        href="/app/randevular"
                        className="focus-ring absolute inset-0 z-0 rounded-[12px]"
                        aria-label={`${appt.time} — ${appt.type}`}
                      />
                      <span className="shrink-0 rounded-[8px] bg-amber-400/15 px-2 py-1 text-xs font-bold tabular-nums text-amber-600">
                        {appt.time}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-950">{appt.type}</span>
                        {appt.customerName ? (
                          <span className="block truncate text-xs text-text-muted">{appt.customerName}</span>
                        ) : null}
                      </span>
                      {!tvMode && (
                        <span className="hover-action absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                          {appt.customerPhone ? (
                            <a
                              href={`tel:${appt.customerPhone}`}
                              title="Müşteriyi ara"
                              aria-label="Müşteriyi ara"
                              className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] border border-line bg-surface text-mint-600 transition hover:border-mint-500/50 hover:bg-mint-500/10"
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                          {appt.status === "pending" ? <AppointmentConfirmButton id={appt.id} /> : null}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </Widget>
        </div>

        <Widget id="kayip">
        <section className="surface-card h-full rounded-[18px] p-5">
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
              <Link
                href="/app/portallar?durum=teyit"
                className="focus-ring group block rounded-[12px] border border-warn-500/30 bg-warn-500/5 px-3 py-3 transition hover:border-warn-500/50 hover:bg-warn-500/10"
              >
                <p className="flex items-center justify-between gap-2 font-semibold text-ink-950">
                  {overdueListings.length} ilanda 7+ gün teyit yok
                  <span className="hover-action shrink-0 text-[11px] font-bold text-brand-600 opacity-0 transition group-hover:opacity-100">
                    İncele →
                  </span>
                </p>
                <p className="mt-1 text-text-muted">Portal Kontrol’den teyit edin</p>
              </Link>
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
                  <Link
                    key={c.id}
                    href={`/app/kayip-kacak?neden=${encodeURIComponent(c.reason ?? "")}`}
                    className="focus-ring group block rounded-[12px] border border-danger-500/30 bg-danger-500/5 px-3 py-3 transition hover:border-danger-500/50 hover:bg-danger-500/10"
                  >
                    <p className="flex items-center justify-between gap-2 font-semibold text-ink-950">
                      {c.reason}
                      <span className="hover-action shrink-0 text-[11px] font-bold text-brand-600 opacity-0 transition group-hover:opacity-100">
                        İncele →
                      </span>
                    </p>
                    <p className="mt-1 text-text-muted">
                      {listing?.portal_name ?? "Portal"}
                      {listing?.portal_listing_id ? ` #${listing.portal_listing_id}` : ""} · −
                      {moneyTry(Number(c.estimated_lost_commission || 0))}
                    </p>
                  </Link>
                );
              })}
          </div>
        </section>
        </Widget>

        {!tvMode && (
          <Widget id="hizli">
          <section className="surface-card h-full rounded-[18px] p-5">
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
          </Widget>
        )}

        <Widget id="musteriler">
        <section className="surface-card h-full rounded-[18px] p-5">
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
        </Widget>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1fr]">
        <Widget id="portal" className="h-full">
        <section className="dashboard-panel surface-card h-full rounded-[20px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                <Gauge className="h-4 w-4" /> Yayın ağı
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Portal sağlığı</h2>
            </div>
            <Link href="/app/portallar" className="focus-ring rounded-[8px] font-display text-2xl font-extrabold text-mint-600 transition hover:text-mint-500">
              %{portalHealthPct}
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {portalHealthRows.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-8 text-center text-sm text-text-muted">
                Canlı portal kaydı yok.
              </p>
            ) : (
              portalHealthRows.map((portal) => (
                <Link
                  key={portal.name}
                  href={`/app/portallar?portal=${encodeURIComponent(portal.name)}`}
                  className="focus-ring group block rounded-[11px] border border-line bg-canvas/60 px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-semibold text-ink-950">
                      <span className={`h-2 w-2 rounded-full ${portal.tone}`} />
                      {portal.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-text-faint">
                      {portal.healthy}/{portal.live} teyitli
                      <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full ${portal.tone}`}
                      style={{ width: `${portal.live ? (portal.healthy / portal.live) * 100 : 0}%` }}
                    />
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
        </Widget>

        <Widget id="ekip" className="h-full">
        <section className="dashboard-panel surface-card h-full rounded-[20px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-500">
                <Trophy className="h-4 w-4" /> Ekip performansı
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Anlaşma değeri liderliği</h2>
            </div>
            <Link href="/app/ekip" className="text-[11px] font-semibold text-brand-600">
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
                  className="group relative flex items-center gap-3 rounded-[12px] border border-line bg-canvas/60 p-3 transition hover:border-brand-300 hover:bg-surface"
                >
                  <Link
                    href={`/app/ekip/${member.id}`}
                    className="focus-ring absolute inset-0 z-0 rounded-[12px]"
                    aria-label={member.name}
                  />
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-extrabold ${
                      index === 0 ? "bg-amber-400 text-ink-950" : "bg-ink-950/5 text-text-muted"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[image:var(--grad-brand)] text-[11px] font-bold text-white">
                    {member.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink-950">{member.name}</p>
                    <p className="truncate text-[11px] text-text-faint">{member.role}</p>
                  </div>
                  <p className="hover-action-hide text-xs font-bold text-ink-950 transition group-hover:opacity-0">{moneyTry(member.value)}</p>
                  {!tvMode && (
                    <Link
                      href="/app/danisman-kpi"
                      className="hover-action focus-ring absolute right-3 z-10 rounded-[8px] bg-brand-600/10 px-2 py-1 text-xs font-bold text-brand-600 opacity-0 transition hover:bg-brand-600/20 group-hover:opacity-100"
                    >
                      KPI →
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
        </Widget>

        <Widget id="akis" className="h-full">
        <section className="dashboard-panel surface-card h-full rounded-[20px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
                <Zap className="h-4 w-4" /> Canlı akış
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Son 24 saat</h2>
            </div>
            <Link href="/app/denetim" className="text-[11px] font-semibold text-brand-600">
              Denetim
            </Link>
          </div>
          <div className="relative mt-5 space-y-3 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
            {feed24h.length === 0 ? (
              <p className="text-sm text-text-muted">Son 24 saatte aktivite yok.</p>
            ) : (
              feed24h.map((item) => (
                <div key={item.key} className="group relative flex items-center gap-3">
                  <Link
                    href={item.href}
                    className="focus-ring absolute inset-0 z-0 rounded-[9px]"
                    aria-label={item.text}
                  />
                  <span className="pointer-events-none z-10 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-line bg-surface text-base transition group-hover:border-brand-300">
                    {item.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-xs font-semibold ${item.tone} group-hover:underline`}>{item.text}</p>
                  </div>
                  {!tvMode && item.actions && item.actions.length > 0 ? (
                    <span className="hover-action relative z-10 flex shrink-0 items-center gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      {item.actions.map((a) =>
                        a.kind === "tel" ? (
                          <a
                            key={a.key}
                            href={a.href}
                            title="Ara"
                            aria-label="Telefonla ara"
                            className="focus-ring press grid h-6 w-6 min-h-9 min-w-9 place-items-center rounded-[7px] border border-line bg-surface text-mint-600 transition hover:border-mint-500/50 hover:bg-mint-500/10"
                          >
                            <Phone className="h-3 w-3" />
                          </a>
                        ) : a.kind === "wa" ? (
                          <a
                            key={a.key}
                            href={a.href}
                            target="_blank"
                            rel="noreferrer"
                            title="WhatsApp"
                            aria-label="WhatsApp ile yaz"
                            className="focus-ring press grid h-6 w-6 min-h-9 min-w-9 place-items-center rounded-[7px] border border-line bg-surface text-mint-600 transition hover:border-mint-500/50 hover:bg-mint-500/10"
                          >
                            <MessageCircle className="h-3 w-3" />
                          </a>
                        ) : (
                          <Link
                            key={a.key}
                            href={a.href}
                            className="focus-ring rounded-[7px] text-[11px] font-bold text-brand-600 hover:underline"
                          >
                            {a.label}
                          </Link>
                        ),
                      )}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[11px] text-text-faint">
                    {timeFmt.format(new Date(item.time))}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
        </Widget>
      </div>
    </div>
    </DashboardWidgetProvider>
  );
}
