/**
 * TV panosu veri yükleyici (sunucu). Kullanıcı oturumlu client + RLS; service_role YOK.
 *
 * Gizlilik: müşteri telefon/e-posta/adres hiç seçilmez; müşteri adı yalnız `shortName` ile kısaltılarak
 * çıkar; olay akışı sabit etiketlerden oluşur (kayıt içeriği taşımaz). Gelir ve ofis komisyonu yalnız
 * `revenueRequested` VE earnings_all birlikte varsa DTO'ya girer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, formatTrTime, trDayStartMs, trParts } from "@/lib/clock";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { OPEN_DEMAND_STATUSES } from "@/lib/team/advisor-360";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import { loadSampleKpiScope } from "@/lib/sample-scope";
import { buildTvEvents, shortName, type TvEvent } from "@/lib/tv/tv-logic";

export type TvAppointment = {
  id: string;
  at: string;
  time: string;
  status: string;
  advisor: string;
  customer: string;
  type: string | null;
};

export type TvLeagueRow = {
  id: string;
  name: string;
  deals: number;
  appointments: number;
  conversionPct: number | null;
  /** Yalnız gelir görünürse; aksi halde null. */
  revenue: number | null;
};

export type TvProperty = {
  id: string;
  code: string;
  title: string;
  price: number | null;
  coverSrc: string | null;
};

export type TvData = {
  at: string;
  revenueVisible: boolean;
  /** Örnek veri rakamlara karışıyorsa "Örnek veri dahil" etiketi, aksi halde null (lib/sample-scope). */
  sampleLabel: string | null;
  /** Temel sorgulardan biri hata verdi: sayılar eksik olabilir. */
  degraded: boolean;
  monthLabel: string;
  appointments: TvAppointment[];
  goal: {
    deals: number;
    dealTarget: number | null;
    dealPct: number | null;
    revenue: number | null;
    revenueTarget: number | null;
    revenuePct: number | null;
  };
  league: TvLeagueRow[];
  properties: TvProperty[];
  stats: {
    activeDemands: number;
    newCustomers: number;
    openDeals: number;
    monthAppointments: number;
    wonToday: number;
  };
  alerts: {
    overdueTasks: number | null;
    untrackedDemands: number | null;
    /** Kaçan komisyon kaydı SAYISI (tutar yok). */
    leakCount: number;
  };
  announcements: string[];
  events: TvEvent[];
};

type Viewer = { userId: string; role: string; perms: EffectivePermissions };

const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const pct = (done: number, target: number | null): number | null =>
  target && target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null;

type Row = Record<string, unknown>;
const rows = (res: { data: unknown } | null | undefined): Row[] => (res && Array.isArray(res.data) ? (res.data as Row[]) : []);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadTvData(
  supabase: SupabaseClient,
  opts: { viewer: Viewer; tenantId: string; revenueRequested: boolean; nowMs: number },
): Promise<TvData> {
  const { viewer, tenantId, nowMs } = opts;
  const period = currentMonthPeriod(nowMs);
  const dayStart = trDayStartMs(nowMs);
  const dayStartIso = new Date(dayStart).toISOString();
  const dayEndIso = new Date(dayStart + DAY_MS).toISOString();
  // PostgREST oluşturucusunun zincirleme tipi burada gereksiz karmaşık (advisor-metrics ile aynı gerekçe).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tq = (q: any) => q.eq("tenant_id", tenantId);
  // Örnek veri kapsamı: ana ekran/ekip/raporlarla AYNI tek karar noktası.
  const sample = await loadSampleKpiScope(supabase, tenantId);
  // is_sample taşıyan tablolar için tenant + örnek veri kapsamı.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tsq = (q: any) => sample.apply(tq(q));
  const nowIso = new Date(nowMs).toISOString();

  const [
    metrics,
    apptRes,
    officeTargetRes,
    propRes,
    demandRes,
    openDealsRes,
    wonTodayRes,
    leakRes,
    annRes,
    evCustomers,
    evAppts,
    evOffers,
    evProps,
  ] = await Promise.all([
    loadAdvisorMetrics(supabase, { viewer, tenantId, period, nowMs, withTargets: true, withLeadSignals: true, sample }),
    tsq(supabase.from("appointments").select("id, scheduled_at, status, assigned_to, appointment_type, customer:customers!appointments_customer_id_fkey(full_name)"))
      .neq("status", "cancelled")
      .gte("scheduled_at", dayStartIso)
      .lt("scheduled_at", dayEndIso)
      .order("scheduled_at", { ascending: true })
      .limit(60),
    tq(supabase.from("targets").select("target_deals, target_revenue"))
      .eq("period", "monthly")
      .eq("period_start", period.startDateKey)
      .is("profile_id", null)
      .limit(1),
    tsq(supabase.from("properties").select("id, property_code, title, list_price"))
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    tsq(supabase.from("customer_demands").select("id", { count: "exact", head: true })).in("status", [...OPEN_DEMAND_STATUSES]),
    tsq(supabase.from("deals").select("id", { count: "exact", head: true })).not("stage", "in", "(won,lost)"),
    tsq(supabase.from("offers").select("id", { count: "exact", head: true })).eq("status", "accepted").gte("created_at", dayStartIso),
    tq(supabase.from("listing_closures").select("id", { count: "exact", head: true }))
      .gt("estimated_lost_commission", 0)
      .gte("created_at", period.startIso)
      .lt("created_at", period.endIso),
    tq(supabase.from("announcements").select("title"))
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    tsq(supabase.from("customers").select("id, created_at")).is("deleted_at", null).order("created_at", { ascending: false }).limit(10),
    tsq(supabase.from("appointments").select("id, updated_at")).eq("status", "completed").order("updated_at", { ascending: false }).limit(10),
    tsq(supabase.from("offers").select("id, created_at")).eq("status", "accepted").order("created_at", { ascending: false }).limit(10),
    tsq(supabase.from("properties").select("id, created_at")).is("deleted_at", null).order("created_at", { ascending: false }).limit(10),
  ]);

  const revenueVisible = opts.revenueRequested && metrics.seeAllEarnings;
  const names = new Map(metrics.rows.map((r) => [r.id, r.fullName] as const));

  const appointments: TvAppointment[] = rows(apptRes).map((a) => {
    const cust = one(a.customer as { full_name?: string | null } | { full_name?: string | null }[] | null);
    return {
      id: String(a.id),
      at: String(a.scheduled_at),
      time: formatTrTime(String(a.scheduled_at)),
      status: String(a.status ?? ""),
      advisor: shortName(names.get(String(a.assigned_to)) ?? ""),
      customer: shortName(cust?.full_name ?? ""),
      type: (a.appointment_type as string | null) ?? null,
    };
  });

  const advisorTargets = metrics.rows.reduce((s, r) => s + (r.target?.deals ?? 0), 0);
  const officeTarget = rows(officeTargetRes)[0];
  const dealTarget = Number(officeTarget?.target_deals) > 0 ? Number(officeTarget.target_deals) : advisorTargets > 0 ? advisorTargets : null;
  const revenueTarget = revenueVisible && Number(officeTarget?.target_revenue) > 0 ? Number(officeTarget.target_revenue) : null;
  const grossCollected = revenueVisible ? (metrics.office.commissionGrossCollected ?? 0) : null;

  const league: TvLeagueRow[] = metrics.rows
    .map((r) => ({
      id: r.id,
      name: r.fullName,
      deals: r.dealCount,
      appointments: r.appointCount,
      conversionPct: r.conversionPct,
      revenue: revenueVisible ? r.revenue : null,
    }))
    .filter((r) => r.deals > 0 || r.appointments > 0)
    .sort((a, b) => (revenueVisible ? (b.revenue ?? 0) - (a.revenue ?? 0) : 0) || b.deals - a.deals || b.appointments - a.appointments || a.name.localeCompare(b.name, "tr"))
    .slice(0, 20);

  const propRows = rows(propRes);
  const propIds = propRows.map((p) => String(p.id));
  let covers = new Map<string, string>();
  if (propIds.length) {
    const { data } = await supabase.from("property_media").select("id, property_id").in("property_id", propIds).eq("kind", "image").eq("is_cover", true);
    covers = new Map(((data ?? []) as { id: string; property_id: string }[]).map((c) => [c.property_id, c.id] as const));
  }
  const properties: TvProperty[] = propRows.map((p) => {
    const coverId = covers.get(String(p.id));
    return {
      id: String(p.id),
      code: String(p.property_code ?? ""),
      title: String(p.title ?? p.property_code ?? "Portföy"),
      price: p.list_price != null ? Number(p.list_price) : null,
      coverSrc: coverId ? `/api/property-media/${coverId}/download` : null,
    };
  });

  const sumNullable = (pick: (r: (typeof metrics.rows)[number]) => number | null): number | null =>
    metrics.rows.some((r) => pick(r) === null) ? null : metrics.rows.reduce((s, r) => s + (pick(r) ?? 0), 0);

  const events = buildTvEvents([
    ...rows(evCustomers).map((r) => ({ id: String(r.id), kind: "customer" as const, at: r.created_at as string })),
    ...rows(evAppts).map((r) => ({ id: String(r.id), kind: "appointment" as const, at: r.updated_at as string })),
    ...rows(evOffers).map((r) => ({ id: String(r.id), kind: "deal" as const, at: r.created_at as string })),
    ...rows(evProps).map((r) => ({ id: String(r.id), kind: "property" as const, at: r.created_at as string })),
  ]);

  const p = trParts(nowMs);
  return {
    at: nowIso,
    revenueVisible,
    sampleLabel: sample.label,
    degraded: metrics.failed || metrics.partial,
    monthLabel: `${MONTHS_TR[p.month]} ${p.year}`,
    appointments,
    goal: {
      deals: metrics.totals.dealCount,
      dealTarget,
      dealPct: pct(metrics.totals.dealCount, dealTarget),
      revenue: grossCollected,
      revenueTarget,
      revenuePct: grossCollected !== null ? pct(grossCollected, revenueTarget) : null,
    },
    league,
    properties,
    stats: {
      activeDemands: demandRes.count ?? 0,
      newCustomers: metrics.rows.reduce((s, r) => s + r.newCustomerCount, 0),
      openDeals: openDealsRes.count ?? 0,
      monthAppointments: metrics.totals.appointCount,
      wonToday: wonTodayRes.count ?? 0,
    },
    alerts: {
      overdueTasks: sumNullable((r) => r.overdueTaskCount),
      untrackedDemands: sumNullable((r) => r.untrackedDemandCount),
      leakCount: leakRes.count ?? 0,
    },
    announcements: rows(annRes).map((a) => String(a.title ?? "")).filter(Boolean),
    events,
  };
}
