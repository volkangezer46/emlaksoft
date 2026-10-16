/**
 * TV panosu veri yükleyici (sunucu). Oturumlu pano: kullanıcı client + RLS. Eşleşmiş cihaz: çağıran, cihazın kiracısına
 * kilitli istemciyi verir (her sorgu `tenant_id` filtresi taşır).
 *
 * Gizlilik: müşteri telefon/e-posta/adres hiç seçilmez; bütün kişi adları yalnız `shortName` ("Ahmet Y.") ile çıkar;
 * görev başlığı (serbest metin) taşınmaz; olay akışı sabit etiketlerden oluşur. Ciro/komisyon yalnız ofis ayarı
 * `showMoney` + istek (`moneyAllowed`, cihazda hep false) + earnings_all birlikte varsa DTO'ya girer.
 * Tasarım: docs/design/TV_MODU_v2.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, formatTrTime, trDayStartMs, trParts, TR_OFFSET_MS } from "@/lib/clock";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { OPEN_DEMAND_STATUSES } from "@/lib/team/advisor-360";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import { loadSampleKpiScope } from "@/lib/sample-scope";
import { loadAvatarMap } from "@/lib/avatar-read";
import { PUBLIC_COVER_COLUMNS, firstPublicImageByProperty, selectWithDocumentFlag, type PublicCoverCandidate } from "@/lib/public-property-media";
import { confirmationHealth } from "@/lib/listing-confirmation";
import { PORTAL_LABELS, isPortalId, normalizePortalName } from "@/lib/portals/catalog";
import { BADGE_BY_CODE, computeStreak } from "@/lib/gamification";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { TV_CONFIG_KEY } from "@/lib/settings/registry/tv";
import { loadWeather, type Weather } from "@/lib/weather";
import {
  TASK_KIND_LABELS,
  buildTvEvents,
  dailySeries,
  daysInTrMonth,
  leadSourceLabel,
  monthWindowCounts,
  paceProjection,
  parseTvConfig,
  shortName,
  type TvConfig,
  type TvEvent,
} from "@/lib/tv/tv-logic";

export type TvAppointment = { id: string; at: string; time: string; status: string; advisor: string; customer: string; type: string | null };
export type TvTask = { id: string; kind: string; advisor: string | null; time: string | null; overdue: boolean; high: boolean };
export type TvLead = { id: string; name: string; source: string | null; at: string };

export type TvKpi = {
  /** Bu ay (ay başından bugüne). */
  value: number;
  /** Geçen ayın aynı gün sayısındaki dilimi (adil kıyas); bilinmiyorsa null. */
  previous: number | null;
  /** Son 14 TR günü (en eski → bugün). */
  series: number[];
};

export type TvLeagueRow = {
  id: string;
  name: string;
  deals: number;
  appointments: number;
  calls: number;
  conversionPct: number | null;
  /** Aylık hedef gerçekleşme (%); hedef yoksa null. */
  targetPct: number | null;
  targetDeals: number | null;
  /** Kesintisiz aktif gün serisi (randevu / arama / kabul edilen teklif). */
  streak: number;
  revenue: number | null;
  avatarUrl: string | null;
  avatarPreset: string | null;
};

export type TvListing = {
  id: string;
  code: string;
  title: string;
  price: number | null;
  currency: string;
  district: string | null;
  rooms: string | null;
  sqm: number | null;
  transaction: "Satılık" | "Kiralık" | null;
  propertyType: string | null;
  badge: "Yeni" | "Fırsat" | null;
  coverSrc: string | null;
  createdAt: string;
};

export type TvBranchTarget = { id: string; name: string; deals: number; target: number; pct: number };

export type TvWin = { id: string; advisor: string | null; district: string | null; propertyType: string | null; at: string };
export type TvAnniversary = { id: string; name: string; years: number; today: boolean };
export type TvBadgeWin = { id: string; name: string; badge: string; at: string };
export type TvAnnouncement = { id: string; title: string; body: string; level: "info" | "warning" | "success"; pinned: boolean };
export type TvPortalStat = { id: string; label: string; live: number; overdue: number };

export type TvData = {
  at: string;
  config: TvConfig;
  office: { name: string; city: string | null; logoUrl: string | null };
  weather: Weather | null;
  moneyVisible: boolean;
  /** Bu izleyicide tutar açılabilir mi (ayar çekmecesi ipucu için; cihazda hep false). */
  moneyPossible: boolean;
  sampleLabel: string | null;
  degraded: boolean;
  monthLabel: string;
  /** Ay günü ve ay uzunluğu (hız tahmini için). */
  month: { day: number; days: number };
  today: {
    appointments: TvAppointment[];
    tasks: TvTask[];
    tasksDueToday: number;
    tasksOverdue: number;
    leads: TvLead[];
    newLeadsToday: number;
  };
  kpis: {
    revenue: number | null;
    wonDeals: TvKpi;
    newCustomers: TvKpi;
    newDemands: TvKpi;
    inboundCalls: TvKpi;
    activeDemands: number;
    openDeals: number;
  };
  league: TvLeagueRow[];
  listings: TvListing[];
  goals: {
    deals: number;
    dealTarget: number | null;
    dealPct: number | null;
    projection: number | null;
    revenue: number | null;
    revenueTarget: number | null;
    revenuePct: number | null;
    branches: TvBranchTarget[];
  };
  announcements: TvAnnouncement[];
  wins: TvWin[];
  anniversaries: TvAnniversary[];
  badges: TvBadgeWin[];
  events: TvEvent[];
  health: { liveListings: number; overdueListings: number; healthPct: number | null; portals: TvPortalStat[] };
};

type Viewer = { userId: string; role: string; perms: EffectivePermissions };

const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const TYPE_LABELS: Record<string, string> = {
  daire: "Daire",
  apartment: "Daire",
  residence: "Rezidans",
  rezidans: "Rezidans",
  villa: "Villa",
  mustakil: "Müstakil ev",
  mustakil_ev: "Müstakil ev",
  arsa: "Arsa",
  land: "Arsa",
  tarla: "Tarla",
  isyeri: "İş yeri",
  dukkan: "Dükkân",
  ofis: "Ofis",
  office: "Ofis",
  shop: "Dükkân",
  depo: "Depo",
  yazlik: "Yazlık",
};

export function propertyTypeLabel(t: string | null | undefined): string | null {
  const k = String(t ?? "").trim().toLowerCase();
  if (!k) return null;
  return TYPE_LABELS[k] ?? `${k.charAt(0).toLocaleUpperCase("tr-TR")}${k.slice(1).replace(/_/g, " ")}`;
}

const pct = (done: number, target: number | null): number | null => (target && target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null);

type Row = Record<string, unknown>;
const rows = (res: { data: unknown } | null | undefined): Row[] => (res && Array.isArray(res.data) ? (res.data as Row[]) : []);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const safeUrl = (u: unknown): string | null => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
const trMidnightMs = (y: number, m: number, d: number) => Date.UTC(y, m, d) - TR_OFFSET_MS;
/** Seri tarama tavanı (≤1000: sayfalı okuma sözleşmesi); tavana dayanılırsa kıyas null ("eksik olabilir"). */
const SERIES_CAP = 1000;

export async function loadTvData(
  supabase: SupabaseClient,
  opts: {
    viewer: Viewer;
    tenantId: string;
    /** Bu istekte ciro gösterilebilir mi (cihazda hep false). Ofis ayarı `showMoney` + earnings_all ayrıca şarttır. */
    moneyAllowed: boolean;
    /** Kapaklar: oturumlu pano korumalı indirme ucunu, cihaz yalnız herkese açık (yayındaki ilan) ucunu kullanır. */
    coverMode: "session" | "public";
    nowMs: number;
  },
): Promise<TvData> {
  const { viewer, tenantId, nowMs } = opts;
  const period = currentMonthPeriod(nowMs);
  const p = trParts(nowMs);
  const dayStart = trDayStartMs(nowMs);
  const dayStartIso = new Date(dayStart).toISOString();
  const dayEndIso = new Date(dayStart + DAY_MS).toISOString();
  const monthStartMs = trMidnightMs(p.year, p.month, 1);
  const prevMonthStartMs = trMidnightMs(p.year, p.month - 1, 1);
  // Seri penceresi: geçen ay başı ya da 14 gün öncesi (hangisi daha eskiyse).
  const seriesSinceIso = new Date(Math.min(prevMonthStartMs, dayStart - 13 * DAY_MS)).toISOString();
  const streakSinceIso = new Date(dayStart - 40 * DAY_MS).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  // PostgREST oluşturucusunun zincirleme tipi burada gereksiz karmaşık (advisor-metrics ile aynı gerekçe).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tq = (q: any) => q.eq("tenant_id", tenantId);
  const sample = await loadSampleKpiScope(supabase, tenantId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tsq = (q: any) => sample.apply(tq(q));

  const [
    metrics,
    settings,
    tenantRes,
    apptRes,
    taskRes,
    officeTargetRes,
    branchTargetRes,
    branchRes,
    propRes,
    dropRes,
    demandOpenRes,
    openDealsRes,
    custSeriesRes,
    demandSeriesRes,
    wonSeriesRes,
    callSeriesRes,
    annRes,
    winsRes,
    evAppts,
    evProps,
    badgeRes,
    hiredRes,
    streakAppts,
    streakCalls,
    portalRes,
  ] = await Promise.all([
    loadAdvisorMetrics(supabase, { viewer, tenantId, period, nowMs, withTargets: true, withLeadSignals: true, sample }),
    readTenantSettings(supabase, tenantId, [TV_CONFIG_KEY]),
    supabase.from("tenants").select("name, city, logo_url, province:geo_provinces(name, lat, lng)").eq("id", tenantId).maybeSingle(),
    tsq(supabase.from("appointments").select("id, scheduled_at, status, assigned_to, appointment_type, customer:customers!appointments_customer_id_fkey(full_name)"))
      .neq("status", "cancelled")
      .gte("scheduled_at", dayStartIso)
      .lt("scheduled_at", dayEndIso)
      .order("scheduled_at", { ascending: true })
      .limit(60),
    // Görev: BAŞLIK seçilmez (serbest metin, kişisel veri içerebilir); yalnız tür/öncelik/vade/sorumlu.
    tsq(supabase.from("tasks").select("id, kind, priority, due_at, assigned_to"))
      .eq("status", "open")
      .lt("due_at", dayEndIso)
      .order("due_at", { ascending: true })
      .limit(200),
    tq(supabase.from("targets").select("target_deals, target_revenue"))
      .eq("period", "monthly")
      .eq("period_start", period.startDateKey)
      .is("profile_id", null)
      .is("team_id", null)
      .is("branch_id", null)
      .limit(1),
    tq(supabase.from("targets").select("branch_id, target_deals"))
      .eq("period", "monthly")
      .eq("period_start", period.startDateKey)
      .is("profile_id", null)
      .not("branch_id", "is", null)
      .limit(50),
    tq(supabase.from("branches").select("id, name")).limit(50),
    tsq(
      supabase
        .from("properties")
        .select("id, property_code, title, list_price, currency, status, transaction_type, property_type, features, created_at, district:geo_districts(name)"),
    )
      .is("deleted_at", null)
      .in("status", ["live", "reserved"])
      .order("created_at", { ascending: false })
      .limit(16),
    tq(supabase.from("property_price_history").select("property_id"))
      .eq("price_field", "list_price")
      .lt("change_pct", 0)
      .gte("created_at", new Date(nowMs - 30 * DAY_MS).toISOString())
      .limit(300),
    tsq(supabase.from("customer_demands").select("id", { count: "exact", head: true })).in("status", [...OPEN_DEMAND_STATUSES]),
    tsq(supabase.from("deals").select("id", { count: "exact", head: true })).not("stage", "in", "(won,lost)"),
    tsq(supabase.from("customers").select("id, created_at, full_name, source"))
      .is("deleted_at", null)
      .gte("created_at", seriesSinceIso)
      .order("created_at", { ascending: false })
      .limit(SERIES_CAP),
    tsq(supabase.from("customer_demands").select("created_at")).gte("created_at", seriesSinceIso).order("created_at", { ascending: false }).limit(SERIES_CAP),
    tsq(supabase.from("offers").select("id, created_at")).eq("status", "accepted").gte("created_at", seriesSinceIso).order("created_at", { ascending: false }).limit(SERIES_CAP),
    tsq(supabase.from("calls").select("started_at")).in("direction", ["inbound", "missed"]).gte("started_at", seriesSinceIso).order("started_at", { ascending: false }).limit(SERIES_CAP),
    tq(supabase.from("announcements").select("id, title, body, level, pinned"))
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6),
    // Kapanan satışlar (son 7 gün): danışman kısa adı + ilçe + tür. Müşteri ve tutar YOK.
    tsq(supabase.from("offers").select("id, created_at, property:properties!offers_property_id_fkey(assigned_to, property_type, district:geo_districts(name))"))
      .eq("status", "accepted")
      .gte("created_at", new Date(nowMs - 7 * DAY_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(12),
    tsq(supabase.from("appointments").select("id, updated_at")).eq("status", "completed").order("updated_at", { ascending: false }).limit(10),
    tsq(supabase.from("properties").select("id, created_at")).is("deleted_at", null).order("created_at", { ascending: false }).limit(10),
    tq(supabase.from("agent_badges").select("id, staff_id, badge_code, earned_at")).order("earned_at", { ascending: false }).limit(10),
    // İş yıldönümü: hassas olmayan iş verisi (advisor_profiles). Doğum tarihi (KVKK: personel özel tablosu) BİLİNÇLİ okunmaz.
    tq(supabase.from("advisor_profiles").select("profile_id, hired_at")).not("hired_at", "is", null).is("left_at", null).limit(300),
    tsq(supabase.from("appointments").select("assigned_to, scheduled_at")).eq("status", "completed").gte("scheduled_at", streakSinceIso).limit(SERIES_CAP),
    tsq(supabase.from("calls").select("handled_by, started_at")).gte("started_at", streakSinceIso).limit(SERIES_CAP),
    tq(supabase.from("portal_listings").select("portal_name, last_confirmed_at, published_at, created_at")).eq("status", "live").limit(1000),
  ]);

  const config = parseTvConfig(settings[TV_CONFIG_KEY]);
  const moneyVisible = opts.moneyAllowed && config.showMoney && metrics.seeAllEarnings;
  const staffName = new Map(metrics.rows.map((r) => [r.id, shortName(r.fullName, "Danışman")] as const));
  const advisorOf = (id: unknown): string | null => (typeof id === "string" ? (staffName.get(id) ?? null) : null);

  /* ---- Ofis kimliği + hava ---- */
  const tenant = (tenantRes.data ?? null) as Row | null;
  const prov = one(tenant?.province as { name?: string | null; lat?: number | null; lng?: number | null } | null);
  const coords = typeof prov?.lat === "number" && typeof prov?.lng === "number" ? { lat: prov.lat, lng: prov.lng } : null;
  const weather = await loadWeather(coords).catch(() => null);

  /* ---- Bugün ---- */
  const appointments: TvAppointment[] = rows(apptRes).map((a) => {
    const cust = one(a.customer as { full_name?: string | null } | null);
    return {
      id: String(a.id),
      at: String(a.scheduled_at),
      time: formatTrTime(String(a.scheduled_at)),
      status: String(a.status ?? ""),
      advisor: advisorOf(a.assigned_to) ?? "Danışman",
      customer: shortName(cust?.full_name ?? ""),
      type: str(a.appointment_type),
    };
  });
  const taskRows = rows(taskRes);
  const tasks: TvTask[] = taskRows
    .map((t) => {
      const due = str(t.due_at);
      const overdue = due ? Date.parse(due) < dayStart : false;
      return {
        id: String(t.id),
        kind: TASK_KIND_LABELS[String(t.kind ?? "")] ?? "Görev",
        advisor: advisorOf(t.assigned_to),
        time: due && !overdue ? formatTrTime(due) : null,
        overdue,
        high: t.priority === "high",
      };
    })
    // Önce bugünün yüksek öncelikli/yakın vadelileri, sonra gecikenler.
    .sort((a, b) => Number(a.overdue) - Number(b.overdue) || Number(b.high) - Number(a.high));
  const custRows = rows(custSeriesRes);
  const leads: TvLead[] = custRows.slice(0, 8).map((r) => ({
    id: String(r.id),
    name: shortName(String(r.full_name ?? "")),
    source: leadSourceLabel(r.source as string | null),
    at: String(r.created_at),
  }));

  /* ---- KPI'lar ---- */
  const kpi = (res: { data: unknown; error?: unknown } | null, col: string): TvKpi => {
    const list = rows(res).map((r) => r[col] as string | null);
    const w = monthWindowCounts(list, monthStartMs, prevMonthStartMs, nowMs);
    const capped = list.length >= SERIES_CAP;
    return { value: w.current, previous: capped || (res as { error?: unknown } | null)?.error ? null : w.previous, series: dailySeries(list, nowMs, 14) };
  };
  const wonDeals = kpi(wonSeriesRes, "created_at");
  // Başlık sayısı lig/hedefle aynı tek kaynaktan (metrics); seri ve kıyas kendi sorgusundan.
  if (!metrics.failed) wonDeals.value = metrics.totals.dealCount;

  /* ---- Lig ---- */
  const activity = new Map<string, string[]>();
  const pushDay = (id: unknown, iso: unknown) => {
    if (typeof id !== "string" || typeof iso !== "string") return;
    const d = new Date(Date.parse(iso) + TR_OFFSET_MS).toISOString().slice(0, 10);
    const list = activity.get(id) ?? [];
    list.push(d);
    activity.set(id, list);
  };
  for (const r of rows(streakAppts)) pushDay(r.assigned_to, r.scheduled_at);
  for (const r of rows(streakCalls)) pushDay(r.handled_by, r.started_at);
  const todayKey = new Date(nowMs + TR_OFFSET_MS).toISOString().slice(0, 10);

  const league: TvLeagueRow[] = metrics.rows
    .map((r) => ({
      id: r.id,
      name: shortName(r.fullName, "Danışman"),
      deals: r.dealCount,
      appointments: r.appointCount,
      calls: r.callCount,
      conversionPct: r.conversionPct,
      targetPct: r.targetPct,
      targetDeals: r.target?.deals ? r.target.deals : null,
      streak: computeStreak(activity.get(r.id) ?? [], todayKey),
      revenue: moneyVisible ? r.revenue : null,
      avatarUrl: null as string | null,
      avatarPreset: null as string | null,
    }))
    .filter((r) => r.deals > 0 || r.appointments > 0 || r.calls > 0 || r.streak > 0)
    .sort(
      (a, b) =>
        (moneyVisible ? (b.revenue ?? 0) - (a.revenue ?? 0) : 0) ||
        b.deals - a.deals ||
        b.appointments - a.appointments ||
        b.calls - a.calls ||
        a.name.localeCompare(b.name, "tr"),
    )
    .slice(0, 10);
  const avatars = await loadAvatarMap(league.map((r) => r.id), supabase);
  for (const r of league) {
    r.avatarUrl = avatars.get(r.id)?.avatar_url ?? null;
    r.avatarPreset = avatars.get(r.id)?.avatar_preset ?? null;
  }

  /* ---- İlanlar ---- */
  const propRows = rows(propRes);
  let covers = new Map<string, string>();
  if (propRows.length) {
    // Ofis TV'si ziyaretçiye açık ekrandır -> public kuralı: belge kapak gösterilmez (KVKK P0-9).
    const { data } = await selectWithDocumentFlag<PublicCoverCandidate[]>(PUBLIC_COVER_COLUMNS, (columns) =>
      tq(supabase.from("property_media").select(columns)).in("property_id", propRows.map((r) => String(r.id))).eq("kind", "image").eq("is_cover", true),
    );
    covers = firstPublicImageByProperty(data);
  }
  const dropped = new Set(rows(dropRes).map((d) => String(d.property_id)));
  const listings: TvListing[] = propRows.map((r) => {
    const features = (r.features ?? {}) as { rooms?: unknown; sqm?: unknown };
    const coverId = covers.get(String(r.id));
    const createdAt = String(r.created_at ?? nowIso);
    const isNew = nowMs - Date.parse(createdAt) <= 7 * DAY_MS;
    const sqm = Number(features.sqm);
    const coverOk = coverId && (opts.coverMode === "session" || r.status === "live");
    return {
      id: String(r.id),
      code: String(r.property_code ?? ""),
      title: str(r.title) ?? str(r.property_code) ?? "Portföy",
      price: r.list_price != null && Number.isFinite(Number(r.list_price)) ? Number(r.list_price) : null,
      currency: typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency) ? r.currency : "TRY",
      district: str(one(r.district as { name?: string | null } | null)?.name),
      rooms: str(features.rooms),
      sqm: Number.isFinite(sqm) && sqm > 0 ? Math.round(sqm) : null,
      transaction: r.transaction_type === "sale" ? "Satılık" : r.transaction_type === "rent" ? "Kiralık" : null,
      propertyType: propertyTypeLabel(r.property_type as string | null),
      badge: dropped.has(String(r.id)) ? "Fırsat" : isNew ? "Yeni" : null,
      coverSrc: coverOk ? (opts.coverMode === "session" ? `/api/property-media/${coverId}/download` : `/api/property-media/${coverId}`) : null,
      createdAt,
    };
  });

  /* ---- Hedefler ---- */
  const advisorTargets = metrics.rows.reduce((s, r) => s + (r.target?.deals ?? 0), 0);
  const officeTarget = rows(officeTargetRes)[0];
  const dealTarget = Number(officeTarget?.target_deals) > 0 ? Number(officeTarget.target_deals) : advisorTargets > 0 ? advisorTargets : null;
  const revenueTarget = moneyVisible && Number(officeTarget?.target_revenue) > 0 ? Number(officeTarget.target_revenue) : null;
  const revenue = moneyVisible ? (metrics.office.commissionGrossCollected ?? 0) : null;
  const days = daysInTrMonth(p.year, p.month);
  const branchNames = new Map(rows(branchRes).map((b) => [String(b.id), String(b.name ?? "Şube")] as const));
  const branchDeals = new Map<string, number>();
  for (const r of metrics.rows) if (r.branchId) branchDeals.set(r.branchId, (branchDeals.get(r.branchId) ?? 0) + r.dealCount);
  const branches: TvBranchTarget[] = rows(branchTargetRes)
    .filter((t) => Number(t.target_deals) > 0 && branchNames.has(String(t.branch_id)))
    .map((t) => {
      const id = String(t.branch_id);
      const target = Number(t.target_deals);
      const deals = branchDeals.get(id) ?? 0;
      return { id, name: branchNames.get(id)!, deals, target, pct: pct(deals, target) ?? 0 };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  /* ---- Duyurular & kutlamalar ---- */
  const announcements: TvAnnouncement[] = rows(annRes)
    .map((a) => ({
      id: String(a.id),
      title: String(a.title ?? "").trim(),
      body: String(a.body ?? "").trim().slice(0, 280),
      level: (a.level === "warning" || a.level === "success" ? a.level : "info") as TvAnnouncement["level"],
      pinned: a.pinned === true,
    }))
    .filter((a) => a.title);
  const wins: TvWin[] = rows(winsRes).map((w) => {
    const prop = one(w.property as { assigned_to?: string | null; property_type?: string | null; district?: unknown } | null);
    return {
      id: String(w.id),
      advisor: advisorOf(prop?.assigned_to),
      district: str(one(prop?.district as { name?: string | null } | null)?.name),
      propertyType: propertyTypeLabel(prop?.property_type),
      at: String(w.created_at),
    };
  });
  const anniversaries: TvAnniversary[] = rows(hiredRes)
    .map((h) => {
      const name = advisorOf(h.profile_id);
      const hired = str(h.hired_at);
      if (!name || !hired || !/^\d{4}-\d{2}-\d{2}/.test(hired)) return null;
      const [y, m, d] = hired.slice(0, 10).split("-").map(Number);
      const years = p.year - y;
      // Bu hafta (bugün dahil sonraki 6 gün) dolan yıllar.
      const thisYear = Date.UTC(p.year, m - 1, d);
      const today = Date.UTC(p.year, p.month, p.day);
      const diff = Math.round((thisYear - today) / DAY_MS);
      if (years < 1 || diff < 0 || diff > 6) return null;
      return { id: String(h.profile_id), name, years, today: diff === 0 };
    })
    .filter((x): x is TvAnniversary => x !== null)
    .slice(0, 6);
  const badges: TvBadgeWin[] = rows(badgeRes)
    .filter((b) => Date.parse(String(b.earned_at)) >= nowMs - 7 * DAY_MS)
    .map((b) => ({
      id: String(b.id),
      name: advisorOf(b.staff_id) ?? "Danışman",
      badge: BADGE_BY_CODE.get(String(b.badge_code))?.name ?? "Yeni rozet",
      at: String(b.earned_at),
    }))
    .slice(0, 6);

  const events = buildTvEvents([
    ...custRows.slice(0, 10).map((r) => ({ id: String(r.id), kind: "customer" as const, at: r.created_at as string })),
    ...rows(evAppts).map((r) => ({ id: String(r.id), kind: "appointment" as const, at: r.updated_at as string })),
    ...rows(wonSeriesRes).slice(0, 10).map((r) => ({ id: String(r.id), kind: "deal" as const, at: r.created_at as string })),
    ...rows(evProps).map((r) => ({ id: String(r.id), kind: "property" as const, at: r.created_at as string })),
    ...rows(badgeRes).map((r) => ({ id: String(r.id), kind: "badge" as const, at: r.earned_at as string })),
  ]);

  /* ---- Sistem sağlığı ---- */
  const live = rows(portalRes) as { portal_name?: string | null; last_confirmed_at?: string | null; published_at?: string | null; created_at?: string | null }[];
  const health = confirmationHealth(live as never[], nowMs);
  const byPortal = new Map<string, typeof live>();
  for (const l of live) {
    const k = normalizePortalName(l.portal_name);
    byPortal.set(k, [...(byPortal.get(k) ?? []), l]);
  }
  const portals: TvPortalStat[] = [...byPortal.entries()]
    .map(([k, list]) => {
      const h = confirmationHealth(list as never[], nowMs);
      return { id: k || "diger", label: isPortalId(k) ? PORTAL_LABELS[k] : k ? `${k.charAt(0).toLocaleUpperCase("tr-TR")}${k.slice(1)}` : "Diğer", live: h.total, overdue: h.overdue };
    })
    .sort((a, b) => b.live - a.live)
    .slice(0, 5);

  return {
    at: nowIso,
    config,
    office: { name: str(tenant?.name) ?? "Ofis", city: str(prov?.name) ?? str(tenant?.city), logoUrl: safeUrl(tenant?.logo_url) },
    weather,
    moneyVisible,
    moneyPossible: opts.moneyAllowed && metrics.seeAllEarnings,
    sampleLabel: sample.label,
    degraded: metrics.failed || metrics.partial,
    monthLabel: `${MONTHS_TR[p.month]} ${p.year}`,
    month: { day: p.day, days },
    today: {
      appointments,
      tasks: tasks.slice(0, 6),
      tasksDueToday: tasks.filter((t) => !t.overdue).length,
      tasksOverdue: tasks.filter((t) => t.overdue).length,
      leads,
      newLeadsToday: custRows.filter((r) => Date.parse(String(r.created_at)) >= dayStart).length,
    },
    kpis: {
      revenue,
      wonDeals,
      newCustomers: kpi(custSeriesRes, "created_at"),
      newDemands: kpi(demandSeriesRes, "created_at"),
      inboundCalls: kpi(callSeriesRes, "started_at"),
      activeDemands: demandOpenRes.count ?? 0,
      openDeals: openDealsRes.count ?? 0,
    },
    league,
    listings,
    goals: {
      deals: metrics.totals.dealCount,
      dealTarget,
      dealPct: pct(metrics.totals.dealCount, dealTarget),
      projection: paceProjection(metrics.totals.dealCount, p.day, days),
      revenue,
      revenueTarget,
      revenuePct: revenue !== null ? pct(revenue, revenueTarget) : null,
      branches,
    },
    announcements,
    wins,
    anniversaries,
    badges,
    events,
    health: { liveListings: health.total, overdueListings: health.overdue, healthPct: health.pct, portals },
  };
}
