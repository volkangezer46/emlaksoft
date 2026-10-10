/**
 * "Bugün" ana ekranı — veri yükleyicileri.
 *
 * Eskiden tek bir 33'lü Promise.all tüm sayfayı bekletiyordu. Şimdi her bölüm
 * kendi küçük yükleyicisini çağırır; React `cache()` aynı istekte aynı `ctx`
 * ile gelen çağrıları tekilleştirir (ör. KPI + Gorevler + BugunOzet aynı
 * canlı-ilan sorgusunu paylaşır). Her yükleyici kendi sorgu grubunu
 * `assertQueryBatchSucceeded` ile doğrular — sahte sıfır yok.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadCustomerStates } from "@/lib/customer-state/load";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { TR_OFFSET_MS, daysAgoIso, daysFromNowIso, now, trDayKey, trParts } from "@/lib/clock";
import type { Period } from "@/components/ui/premium";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import type { SampleKpiScope } from "@/lib/sample-scope";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import {
  commissionSummaryFromAggregate,
  type CommissionAggregate,
  type DealRow,
  type DemandCounts,
  type ListingRow,
  lastSixMonthKeys,
} from "./helpers";
import { EMPTY_SNAPSHOT, loadDashboardSnapshot, loadHomeScopeSnapshot, type DashboardSnapshot } from "./data-batch";
import { periodStatsFromSnapshot, type HomeScopeSnapshot, type TaskOpenRow, type TodayAppointmentRow } from "./snapshot-core";
import { getSetting } from "@/lib/settings/read";
import { loadInsightBundle } from "./insight-veri";
import { moneyTry } from "@/lib/leak-shield";
import { STALE_DAYS as DEFAULT_STALE_DAYS } from "../anlasmalar/deal-list-logic";
import { buildAttentionItems, type HomeAttentionItem } from "./home-metrics";

/**
 * Anlık görüntü RPC'leri (tek tur) — yükleyiciler ÖNCE buna bakar. Örnek-veri kararı (`sample_included`) kodun
 * kararıyla (`ctx.sample.include`) aynı değilse o alan kullanılmaz (aynı kural, iki farklı anda hesaplanmış olabilir).
 * RPC yoksa/hata verdiyse alanlar null → mevcut sorgular aynen çalışır.
 */
const snapshotFor = cache(async (ctx: HomeCtx): Promise<DashboardSnapshot> => {
  if (!ctx.tenantId) return EMPTY_SNAPSHOT;
  const snap = await loadDashboardSnapshot(ctx.tenantId, ctx.userId);
  return {
    insights: snap.insights,
    metrics: snap.metrics && snap.metrics.sampleIncluded === ctx.sample.include ? snap.metrics : null,
    tasks: snap.tasks && snap.tasks.sampleIncluded === ctx.sample.include ? snap.tasks : null,
  };
});

/**
 * Kapsama (ben/ofis) özgü ilk ekran okumaları — `home_snapshot` RPC'si, TEK tur (bugünün randevuları, hareketsiz anlaşma
 * sayısı, bu ayın hedefleri, bos-ofis sayaçları). Eşik varsayılanı platform ayarından (süreç içi 30 sn önbellek, DB turu yok);
 * ofis ayarı SQL'de çözülür. Örnek-veri kararı kodla uyuşmazsa ya da RPC yoksa/hata verirse null → eski sorgular.
 */
const homeScopeFor = cache(async (ctx: HomeCtx): Promise<HomeScopeSnapshot | null> => {
  if (!ctx.tenantId) return null;
  let staleDefault = DEFAULT_STALE_DAYS;
  try {
    const v = await getSetting<number>("office.alert.deal_stale_days");
    if (typeof v === "number" && Number.isFinite(v)) staleDefault = v;
  } catch {
    // varsayılan
  }
  const snap = await loadHomeScopeSnapshot(ctx.tenantId, ctx.scopeMine ? "ben" : "ofis", staleDefault);
  return snap && snap.sampleIncluded === ctx.sample.include ? snap : null;
});

export type HomeCtx = {
  tenantId: string | null;
  /** Oturumdaki kullanıcı (görev/randevu/müşteri `assigned_to` süzgeci için). */
  userId: string;
  role: string;
  /** Etkin izinler (ekip metrikleri kapsam/kazanç kuralları için). */
  perms: EffectivePermissions;
  canSeeExpenses: boolean;
  /** Yönetim rolü (owner/gm/branch_manager): "Bugün karar bekleyenler" + Ofis görünümü anahtarı. */
  isManagement: boolean;
  /** true → görev/randevu/müşteri/portföy sorguları `assigned_to = ben` ile daralır (varsayılan). */
  scopeMine: boolean;
  /** Başkasının kazancını görme hakkı (`earnings_all`); yoksa komisyon yalnız kendi anlaşmalarıdır. */
  seeAllEarnings: boolean;
  canSeeCommissions: boolean;
  tvMode: boolean;
  canSeeRentals: boolean;
  canSeeProjects: boolean;
  canSeeProperties: boolean;
  /** Örnek (demo) veri KPI kapsamı, tek karar noktası: `lib/sample-scope` (eşik altında dahil + etiket, üstünde dışlanır). */
  sample: SampleKpiScope;
  fullName: string;
  firstName: string;
  /** Dönem seçici (?donem=7|30|90): yalnız dönem-duyarlı hero özeti ve kartlar kullanır. */
  period: Period;
  /** targets.period_start date kolonu "YYYY-AA-01" tutar */
  monthStartKey: string;
  monthStartIso: string;
  prevMonthStartIso: string;
  dayStartIso: string;
  dayEndIso: string;
  yesterdayStartIso: string;
  sixMonthsAgoIso: string;
  last24hIso: string;
};

export function buildHomeBounds(): Pick<
  HomeCtx,
  | "monthStartKey"
  | "monthStartIso"
  | "prevMonthStartIso"
  | "dayStartIso"
  | "dayEndIso"
  | "yesterdayStartIso"
  | "sixMonthsAgoIso"
  | "last24hIso"
> {
  // Gün/ay sınırları Türkiye saatine göre (sunucu UTC'de olsa da 00:00–03:00 TRT
  // arasında "bugün" doğru günü gösterir). Sınırlar gerçek anlara (ISO) çevrilir.
  const nowMs = now();
  const p = trParts(nowMs);
  const trMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - TR_OFFSET_MS);
  const monthStart = trMidnight(p.year, p.month, 1);
  const dayStart = trMidnight(p.year, p.month, p.day);
  const dayEnd = trMidnight(p.year, p.month, p.day + 1);
  const sixMonthsAgo = trMidnight(p.year, p.month - 5, 1);
  const prevMonthStart = trMidnight(p.year, p.month - 1, 1);
  const yesterdayStart = trMidnight(p.year, p.month, p.day - 1);
  return {
    monthStartKey: `${p.year}-${String(p.month + 1).padStart(2, "0")}-01`,
    monthStartIso: monthStart.toISOString(),
    prevMonthStartIso: prevMonthStart.toISOString(),
    dayStartIso: dayStart.toISOString(),
    dayEndIso: dayEnd.toISOString(),
    yesterdayStartIso: yesterdayStart.toISOString(),
    sixMonthsAgoIso: sixMonthsAgo.toISOString(),
    last24hIso: daysAgoIso(1),
  };
}

/* ------------------------------ Dönem (7/30/90) ----------------------------- */

const PERIOD_SERIES_LIMIT = 500;

/**
 * Seçili dönemde (son N gün) yeni müşteri ve yeni talep sayısı + bir önceki aynı
 * uzunlukta dönem (karşılaştırma). Sayılar `head count` (kırpılmaz). Seri için
 * yalnız cari dönemin tarih kolonu çekilir; satır sınırına çarparsa seri
 * `null` döner (kırpık seri çizilmez — uydurma yok).
 */
export const loadPeriodStats = cache(async (ctx: HomeCtx) => {
  const days = ctx.period;
  const curStart = daysAgoIso(days);
  const prevStart = daysAgoIso(days * 2);
  // Anlık görüntü: sayaçlar + 90 günlük seriden türetilen dönem serisi. Seri TAM değilse (tavan) eski sorgu
  // çalışır ki 7/30 günlük kısa seri yine çizilebilsin (kural değişmez: kırpık seri çizilmez).
  const snapMetrics = (await snapshotFor(ctx)).metrics;
  if (snapMetrics) {
    const s = periodStatsFromSnapshot(snapMetrics, days, curStart);
    if (s.customerDates !== null && s.demandDates !== null) return s;
  }
  const supabase = await createClient();
  const customers = () => ctx.sample.apply(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null));
  const demands = () => ctx.sample.apply(supabase.from("customer_demands").select("id", { count: "exact", head: true }));
  const results = await Promise.all([
    customers().gte("created_at", curStart),
    customers().gte("created_at", prevStart).lt("created_at", curStart),
    demands().gte("created_at", curStart),
    demands().gte("created_at", prevStart).lt("created_at", curStart),
    ctx.sample.apply(supabase.from("customers").select("created_at").is("deleted_at", null))
      .gte("created_at", curStart).order("created_at", { ascending: false }).limit(PERIOD_SERIES_LIMIT),
    ctx.sample.apply(supabase.from("customer_demands").select("created_at"))
      .gte("created_at", curStart).order("created_at", { ascending: false }).limit(PERIOD_SERIES_LIMIT),
  ]);
  assertQueryBatchSucceeded(
    results,
    ["period-customers", "period-customers-prev", "period-demands", "period-demands-prev", "period-customer-dates", "period-demand-dates"],
    "Ana panel",
  );
  const dates = (r: { data: { created_at: string | null }[] | null }) =>
    (r.data ?? []).length >= PERIOD_SERIES_LIMIT ? null : (r.data ?? []).map((x) => x.created_at ?? "");
  return {
    customers: results[0].count ?? 0,
    customersPrev: results[1].count ?? 0,
    demands: results[2].count ?? 0,
    demandsPrev: results[3].count ?? 0,
    customerDates: dates(results[4] as never),
    demandDates: dates(results[5] as never),
  };
});

/* ------------------------------ Bugünün işleri ------------------------------ */

export const loadTaskSummary = cache(async (ctx: HomeCtx) => {
  const snapTasks = (await snapshotFor(ctx)).tasks;
  if (snapTasks) {
    const t = ctx.scopeMine ? snapTasks.mine : snapTasks.office;
    return { dueToday: t.dueToday, overdue: t.overdue, open: t.open };
  }
  const supabase = await createClient();
  // Danışman kapsamı: yalnız bana atanan görevler (ofis görünümünde süzgeç yok).
  // Bugün vadesi gelen açık görevler (yalnız sayaç)
  let dueQ = ctx.sample.apply(supabase.from("tasks").select("id", { count: "exact", head: true }))
    .eq("status", "open").gte("due_at", ctx.dayStartIso).lt("due_at", ctx.dayEndIso);
  // Vadesi geçmiş (bugünden önce) açık görevler (yalnız sayaç)
  let overdueQ = ctx.sample.apply(supabase.from("tasks").select("id", { count: "exact", head: true }))
    .eq("status", "open").lt("due_at", ctx.dayStartIso);
  // Bugünün gerçek görevleri (gecikmiş dahil) — hover'da tek tıkla tamamlanır
  let openQ = ctx.sample.apply(supabase.from("tasks").select("id, title, due_at, priority"))
    .eq("status", "open").lt("due_at", ctx.dayEndIso)
    .order("due_at", { ascending: true }).limit(5);
  if (ctx.scopeMine) {
    dueQ = dueQ.eq("assigned_to", ctx.userId);
    overdueQ = overdueQ.eq("assigned_to", ctx.userId);
    openQ = openQ.eq("assigned_to", ctx.userId);
  }
  const results = await Promise.all([dueQ, overdueQ, openQ]);
  assertQueryBatchSucceeded(results, ["tasks-due-today", "tasks-overdue", "open-tasks"], "Ana panel");
  const [due, overdue, open] = results;
  return {
    dueToday: due.count ?? 0,
    overdue: overdue.count ?? 0,
    open: (open.data ?? []) as TaskOpenRow[],
  };
});

export const loadTodayAppointments = cache(async (ctx: HomeCtx): Promise<{ rows: TodayAppointmentRow[]; total: number }> => {
  const home = await homeScopeFor(ctx);
  if (home) return { rows: home.appointments.rows, total: home.appointments.total };
  const supabase = await createClient();
  // count: brifingde gerçek toplam gerekir. Açık ilişki adı ipucu korunur.
  let apptQ = ctx.sample.apply(supabase
    .from("appointments")
    .select("id, appointment_type, scheduled_at, status, duration_min, location, customer:customers!appointments_customer_id_fkey(full_name, phone), property:properties!appointments_property_id_fkey(lat, lng)", { count: "exact" }))
    .gte("scheduled_at", ctx.dayStartIso).lt("scheduled_at", ctx.dayEndIso)
    .order("scheduled_at", { ascending: true }).limit(8);
  if (ctx.scopeMine) apptQ = apptQ.eq("assigned_to", ctx.userId);
  const result = await apptQ;
  assertQueryBatchSucceeded([result], ["today-appointments"], "Ana panel");
  return { rows: (result.data ?? []) as unknown as TodayAppointmentRow[], total: result.count ?? 0 };
});

/** `reasons`: lead-skoru bileşenlerinden NEDEN etiketleri ("Bugün ara" tablosu skor yerine gerekçe gösterir). */
export type HotLead = { id: string; fullName: string; phone: string | null; score: number; reasons: string[] };

/**
 * Sıcak (hot) müşteriler, puana göre azalan. Danışman kapsamında yalnız bana atanan müşteriler.
 * Hem "Bugün kuyruğu" sayacı hem "Bugün aranacaklar" listesi bunu paylaşır (tek sorgu).
 */
export const loadHotLeads = cache(async (ctx: HomeCtx): Promise<HotLead[]> => {
  const supabase = await createClient();
  let custQ = ctx.sample.apply(supabase.from("customers").select("id, full_name, phone, email, source, blacklist, created_at, customer_types"))
    .is("deleted_at", null).order("created_at", { ascending: false }).limit(200);
  if (ctx.scopeMine) custQ = custQ.eq("assigned_to", ctx.userId);
  const custRes = await custQ;
  assertQueryBatchSucceeded([custRes], ["briefing-customers"], "Ana panel");
  const customers = (custRes.data ?? []) as {
    id: string; full_name: string | null; phone: string | null; email: string | null; source: string | null;
    blacklist: boolean | null; created_at: string; customer_types: string[] | null;
  }[];
  // Sıcaklık: müşteri listesi / 360 / Akıllı Listelerle AYNI tek okuyucu (lib/customer-state).
  const states = await loadCustomerStates(supabase, ctx.tenantId, customers, { context: "Ana panel" });
  const hot: HotLead[] = [];
  for (const c of customers) {
    const st = states.get(c.id);
    if (st && st.temperature === "sicak" && !c.blacklist) {
      hot.push({ id: c.id, fullName: c.full_name ?? "Müşteri", phone: c.phone ?? null, score: st.scores.heat.score, reasons: st.reasons.slice(0, 3).map((r) => r.label) });
    }
  }
  return hot.sort((a, b) => b.score - a.score);
});

export const loadHotLeadCount = cache(async (ctx: HomeCtx) => (await loadHotLeads(ctx)).length);

export type ExpiringAuthority = { id: string; property_code: string | null; title: string | null; authority_expires_at: string };

/**
 * Yetki belgesi 15 gün içinde dolacak yayındaki portföyler. Kaynak kolon
 * `properties.authorization_end` (date; `authority_expires_at` kolonu YOKTUR — eski sorgu 42703 verirdi).
 * Danışman kapsamında yalnız bana atanan portföyler.
 */
export const loadExpiringAuthority = cache(async (ctx: HomeCtx) => {
  const snapMetrics = (await snapshotFor(ctx)).metrics;
  if (snapMetrics) {
    return { data: (ctx.scopeMine ? snapMetrics.expiringAuthority.mine : snapMetrics.expiringAuthority.office) as ExpiringAuthority[] };
  }
  const supabase = await createClient();
  let q = supabase
    .from("properties")
    .select("id, property_code, title, authorization_end")
    .eq("status", "live")
    .is("deleted_at", null)
    .not("authorization_end", "is", null)
    .gte("authorization_end", trDayKey())
    .lte("authorization_end", trDayKey(daysFromNowIso(15)))
    .order("authorization_end", { ascending: true })
    .limit(12);
  if (ctx.scopeMine) q = q.eq("assigned_to", ctx.userId);
  const result = await q;
  assertQueryBatchSucceeded([result], ["expiring-authority"], "Ana panel");
  const data: ExpiringAuthority[] = (result.data ?? []).map((r) => ({
    id: r.id as string,
    property_code: (r.property_code as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    authority_expires_at: r.authorization_end as string,
  }));
  return { data };
});

/* ------------------------------- Ortak kümeler ------------------------------ */

/** `ctx` verilir ve danışman kapsamındaysa yalnız bana atanan portföylerin ilanları (inner join). */
export const loadLiveListings = cache(async (ctx?: HomeCtx) => {
  const supabase = await createClient();
  const mine = Boolean(ctx?.scopeMine);
  let q = supabase
    .from("portal_listings")
    .select(
      mine
        ? "id, portal_name, portal_listing_id, last_confirmed_at, property:properties!portal_listings_property_id_fkey!inner(assigned_to)"
        : "id, portal_name, portal_listing_id, last_confirmed_at",
    )
    .eq("status", "live")
    .limit(100);
  if (mine && ctx) q = q.eq("property.assigned_to", ctx.userId);
  const result = await q;
  assertQueryBatchSucceeded([result], ["live-listings"], "Ana panel");
  return (result.data ?? []) as unknown as ListingRow[];
});

/**
 * Son 6 ay komisyon özeti — tam kapsamlı SQL aggregate (`tenant_commission_aggregates`).
 * Eskiden 500 satır çekilip JS'te toplanıyordu (500'ü aşan ofiste kırpılırdı).
 * Kapsam aynı: RLS ile RPC aynı tenant + commissions:view kapısını kullanır. Ana ekran
 * yalnız "dashboard" yetkisi istediği için commissions:view olmayan kullanıcıda RPC 42501
 * döner; RLS altında eski sorgu boş dönüyordu → aynı şekilde sıfır özet.
 */
export const loadCommissionSummary = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  // Kazanç gizliliği: ofis geneli toplam (RPC) yalnız `earnings_all` ile; diğer roller yalnız
  // kendi anlaşmalarının komisyonunu görür (bkz. /app/komisyon, earnings-bypass-contract).
  if (!ctx.seeAllEarnings) {
    const own = await ctx.sample.apply(supabase
      .from("commissions")
      .select("gross_amount, status, created_at, deal:deals!commissions_deal_id_fkey!inner(assigned_to)"))
      .eq("deal.assigned_to", ctx.userId)
      .gte("created_at", ctx.sixMonthsAgoIso)
      .order("created_at", { ascending: false })
      .limit(500);
    if (own.error?.code === "42501") return commissionSummaryFromAggregate(null);
    assertQueryBatchSucceeded([own], ["own-commissions"], "Ana panel");
    const monthly = lastSixMonthKeys(now()).map((key) => {
      const rows = (own.data ?? []).filter((r) => trDayKey(r.created_at as string).slice(0, 7) === key);
      const accrued = rows.reduce((t, r) => t + Number(r.gross_amount ?? 0), 0);
      const paid = rows
        .filter((r) => r.status === "paid" || r.status === "collected")
        .reduce((t, r) => t + Number(r.gross_amount ?? 0), 0);
      return { month_start: `${key}-01`, accrued, paid };
    });
    return commissionSummaryFromAggregate({ monthly });
  }
  const result = await supabase.rpc("tenant_commission_aggregates", { p_as_of: new Date(now()).toISOString() });
  if (result.error?.code === "42501") return commissionSummaryFromAggregate(null);
  assertQueryBatchSucceeded([result], ["commission-aggregates"], "Ana panel");
  return commissionSummaryFromAggregate(result.data as unknown as CommissionAggregate);
});

/** KPI sparkline: yalnız son 7 haftanın komisyon oluşturma tarihleri (tek kolon). */
export const loadCommissionWeekDates = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  const result = await ctx.sample.apply(supabase
    .from("commissions")
    .select("created_at"))
    .gte("created_at", daysAgoIso(49))
    .order("created_at", { ascending: false })
    .limit(500);
  assertQueryBatchSucceeded([result], ["commission-trend"], "Ana panel");
  return (result.data ?? []).map((c) => (c.created_at as string | null) ?? "");
});

export const loadClosures = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  const results = await Promise.all([
    // Bu ay + geçen ay tek sorguda (tutar toplamı için dar satır seti); JS'te ayrılır
    supabase.from("listing_closures").select("estimated_lost_commission, created_at")
      .gte("created_at", ctx.prevMonthStartIso).limit(200),
    supabase
      .from("listing_closures")
      .select("id, reason, competitor_closed, estimated_lost_commission, created_at, portal_listing:portal_listings!listing_closures_portal_listing_id_fkey(portal_name, portal_listing_id)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  assertQueryBatchSucceeded(results, ["closures-two-months", "recent-closures"], "Ana panel");
  const rows = results[0].data ?? [];
  return {
    thisMonth: rows.filter((r) => (r.created_at ?? "") >= ctx.monthStartIso),
    prevMonth: rows.filter((r) => (r.created_at ?? "") < ctx.monthStartIso),
    recent: results[1].data ?? [],
  };
});

/** Talep durumları: ham satır çekmek yerine üç sayaç (200 satır sınırı sayıyı kırpıyordu). */
export const loadDemandCounts = cache(async (ctx: HomeCtx): Promise<DemandCounts> => {
  const snapMetrics = (await snapshotFor(ctx)).metrics;
  if (snapMetrics) return { new: snapMetrics.demands.new, active: snapMetrics.demands.active, matched: snapMetrics.demands.matched };
  const supabase = await createClient();
  const count = (status: string) =>
    ctx.sample.apply(supabase.from("customer_demands").select("id", { count: "exact", head: true })).eq("status", status);
  const results = await Promise.all([count("new"), count("active"), count("matched")]);
  assertQueryBatchSucceeded(results, ["demands-new", "demands-active", "demands-matched"], "Ana panel");
  return { new: results[0].count ?? 0, active: results[1].count ?? 0, matched: results[2].count ?? 0 };
});

export const loadDeals = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  // Son 3 ay
  const sinceIso = daysAgoIso(90);
  // PostgREST 1000 satır sınırı: toplamlar kesilmesin diye sayfalı okunur (fetchAllRows).
  const result = await fetchAllRows((from, to) =>
    ctx.sample.apply(supabase
      .from("deals")
      .select("stage, deal_value, assigned_to, updated_at"))
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  assertQueryBatchSucceeded([result], ["deals"], "Ana panel");
  return (result.data ?? []) as DealRow[];
});

export const loadProfiles = cache(async () => {
  const supabase = await createClient();
  const result = await supabase.from("profiles").select("id, full_name, role").order("full_name").limit(500);
  assertQueryBatchSucceeded([result], ["profiles"], "Ana panel");
  return result.data ?? [];
});

/* ---------------------------------- KPI ------------------------------------ */

export const loadKpiCounts = cache(async (ctx: HomeCtx) => {
  const snapMetrics = (await snapshotFor(ctx)).metrics;
  if (snapMetrics) {
    const k = snapMetrics.kpi;
    return {
      customerCount: k.customerCount,
      propertyCount: k.propertyCount,
      callsToday: k.callsToday,
      customersThisMonth: k.customersThisMonth,
      customersPrevMonth: k.customersPrevMonth,
      callsYesterday: k.callsYesterday,
      callDates: k.callDates,
      customerDates: k.customerDates,
    };
  }
  const supabase = await createClient();
  const liveCustomers = () => ctx.sample.apply(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null));
  const results = await Promise.all([
    liveCustomers(),
    ctx.sample.apply(supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    ctx.sample.apply(supabase.from("calls").select("id", { count: "exact", head: true })).gte("started_at", ctx.dayStartIso),
    liveCustomers().gte("created_at", ctx.monthStartIso),
    liveCustomers().gte("created_at", ctx.prevMonthStartIso).lt("created_at", ctx.monthStartIso),
    ctx.sample.apply(supabase.from("calls").select("id", { count: "exact", head: true }))
      .gte("started_at", ctx.yesterdayStartIso).lt("started_at", ctx.dayStartIso),
    // Sparkline: yalnız 7 haftalık pencere, yalnız tarih kolonu
    ctx.sample.apply(supabase.from("calls").select("started_at")).gte("started_at", daysAgoIso(49))
      .order("started_at", { ascending: false }).limit(100),
    ctx.sample.apply(supabase.from("customers").select("created_at").is("deleted_at", null))
      .gte("created_at", daysAgoIso(49)).order("created_at", { ascending: false }).limit(100),
  ]);
  assertQueryBatchSucceeded(
    results,
    ["customer-count", "property-count", "calls-today", "customers-this-month", "customers-previous-month", "calls-yesterday", "call-trend", "customer-trend"],
    "Ana panel",
  );
  return {
    customerCount: results[0].count ?? 0,
    propertyCount: results[1].count ?? 0,
    callsToday: results[2].count ?? 0,
    customersThisMonth: results[3].count ?? 0,
    customersPrevMonth: results[4].count ?? 0,
    callsYesterday: results[5].count ?? 0,
    callDates: (results[6].data ?? []).map((c) => c.started_at as string),
    customerDates: (results[7].data ?? []).map((c) => c.created_at as string),
  };
});

export const loadOfficeTarget = cache(async (ctx: HomeCtx) => {
  const home = await homeScopeFor(ctx);
  if (home) return home.officeTarget;
  const supabase = await createClient();
  // Bu ayın OFİS GENELİ hedefi (profile_id null) — yoksa hedef kartı gizli
  const result = await supabase
    .from("targets")
    .select("target_deals, target_revenue")
    .eq("period", "monthly")
    .eq("period_start", ctx.monthStartKey)
    .is("profile_id", null)
    .maybeSingle();
  assertQueryBatchSucceeded([result], ["office-target"], "Ana panel");
  return result.data;
});

/** Kişisel aylık hedef (targets.profile_id = ben) — yoksa kişisel hedef kartı "hedef belirle" önerir. */
export const loadMyTarget = cache(async (ctx: HomeCtx) => {
  const home = await homeScopeFor(ctx);
  if (home) return home.myTarget;
  const supabase = await createClient();
  const result = await supabase
    .from("targets")
    .select("target_deals, target_revenue")
    .eq("period", "monthly")
    .eq("period_start", ctx.monthStartKey)
    .eq("profile_id", ctx.userId)
    .maybeSingle();
  assertQueryBatchSucceeded([result], ["my-target"], "Ana panel");
  return result.data;
});

export const loadRentalsAndProjects = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  // Modül yetkisi yoksa sorgu bile atılmaz.
  const results = await Promise.all([
    ctx.canSeeRentals
      ? supabase.from("rentals").select("id", { count: "exact", head: true }).eq("status", "active")
      : Promise.resolve({ count: 0 }),
    // Bu ayın tahakkukları + (hangi aya ait olursa olsun) gecikmişler — tek sorgu
    ctx.canSeeRentals
      ? fetchAllRows((from, to) =>
          supabase
            .from("rent_charges")
            .select("amount, status, period")
            .or(`period.eq.${ctx.monthStartKey},status.eq.overdue`)
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: null }),
    // Proje + birim durumları tek gidiş-dönüşte (bkz. actions/projects.ts listProjects)
    ctx.canSeeProjects
      ? supabase.from("projects").select("id, status, units:project_units!project_units_project_id_fkey(status)").limit(200)
      : Promise.resolve({ data: null }),
  ]);
  assertQueryBatchSucceeded(results, ["active-rentals", "rent-charges", "projects"], "Ana panel");
  return {
    activeRentals: (results[0] as { count: number | null }).count ?? 0,
    rentCharges: ((results[1] as { data: unknown[] | null }).data ?? []) as {
      amount: number | string | null;
      status: string;
      period: string;
    }[],
    projects: ((results[2] as { data: unknown[] | null }).data ?? []) as {
      id: string;
      status: string;
      units: { status: string }[] | null;
    }[],
  };
});

/**
 * Müşteri kaynağı dağılımı: yalnız `source` kolonu. Satır sınırına çarparsa `null`
 * döner (kırpık dağılım çizilmez — uydurma yüzde yok).
 */
const SOURCE_ROW_LIMIT = 5000;
export const loadCustomerSources = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  // PostgREST 1000 satır sınırı: sayfalı okunur; üst sınırı (5 sayfa) aşan ofiste dağılım çizilmez.
  const result = await fetchAllRows(
    (from, to) =>
      ctx.sample.apply(supabase.from("customers").select("source").is("deleted_at", null))
        .order("id", { ascending: true })
        .range(from, to),
    1000,
    SOURCE_ROW_LIMIT / 1000,
  );
  if (result.error && /üst sınırı/.test(result.error.message)) return null;
  assertQueryBatchSucceeded([result], ["customer-sources"], "Ana panel");
  const rows = (result.data ?? []) as { source: string | null }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.source?.trim() || "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { total: rows.length, counts: Object.fromEntries(counts) as Record<string, number> };
});

/** Portföy şeridi: son eklenenler + son 30 günde liste fiyatı düşenler (property_price_history). */
export type StripProperty = {
  id: string;
  code: string | null;
  title: string | null;
  price: number | null;
  transaction: string | null;
  district: string | null;
  createdAt: string | null;
  dropPct?: number;
};
type RawStripProperty = {
  id: string;
  property_code: string | null;
  title: string | null;
  list_price: number | null;
  transaction_type: string | null;
  created_at?: string | null;
  district: { name: string | null } | { name: string | null }[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const toStrip = (r: RawStripProperty, dropPct?: number): StripProperty => ({
  id: r.id,
  code: r.property_code,
  title: r.title,
  price: r.list_price == null ? null : Number(r.list_price),
  transaction: r.transaction_type,
  district: one(r.district)?.name ?? null,
  createdAt: r.created_at ?? null,
  dropPct,
});
export const loadPropertyStrip = cache(async () => {
  const supabase = await createClient();
  const cols = "id, property_code, title, list_price, transaction_type, created_at, district:geo_districts(name)";
  const results = await Promise.all([
    supabase.from("properties").select(cols).is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
    supabase
      .from("property_price_history")
      .select(
        "change_pct, created_at, property:properties!property_price_history_property_id_fkey(id, property_code, title, list_price, transaction_type, district:geo_districts(name))",
      )
      .eq("price_field", "list_price")
      .lt("change_pct", 0)
      .gte("created_at", daysAgoIso(30))
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  assertQueryBatchSucceeded(results, ["strip-recent", "strip-price-drops"], "Ana panel");
  const recent = ((results[0].data ?? []) as unknown as RawStripProperty[]).map((r) => toStrip(r));
  const seen = new Set<string>();
  const drops: StripProperty[] = [];
  for (const row of (results[1].data ?? []) as unknown as { change_pct: number | null; property: RawStripProperty | RawStripProperty[] | null }[]) {
    const prop = one(row.property);
    if (!prop || seen.has(prop.id)) continue;
    seen.add(prop.id);
    drops.push(toStrip(prop, Number(row.change_pct)));
    if (drops.length >= 5) break;
  }
  return { recent, drops };
});

/* ------------------------------ Liste/akış bölümleri ------------------------- */

export const loadActivityFeed = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  const results = await Promise.all([
    // Telefon: hızlı ara/WhatsApp aksiyonu için
    supabase.from("customers").select("id, full_name, phone, created_at").is("deleted_at", null)
      .gte("created_at", ctx.last24hIso).order("created_at", { ascending: false }).limit(5),
    supabase.from("calls").select("id, phone, direction, started_at").gte("started_at", ctx.last24hIso)
      .order("started_at", { ascending: false }).limit(5),
    supabase.from("appointments").select("id, appointment_type, scheduled_at, status")
      .gte("created_at", ctx.last24hIso).order("created_at", { ascending: false }).limit(5),
    supabase.from("properties").select("id, property_code, title, created_at").is("deleted_at", null)
      .gte("created_at", ctx.last24hIso).order("created_at", { ascending: false }).limit(5),
  ]);
  assertQueryBatchSucceeded(results, ["recent-customers", "recent-calls", "recent-appointments", "recent-properties"], "Ana panel");
  return {
    customers: results[0].data ?? [],
    calls: results[1].data ?? [],
    appointments: results[2].data ?? [],
    properties: results[3].data ?? [],
  };
});

/** Ofis adı (TV modu) + örnek veri durumu (onboarding CTA/şeridi). */
export const loadTenantRow = cache(async (ctx: HomeCtx) => {
  if (!ctx.tenantId) return null as { name: string; sample_seeded_at: string | null } | null;
  const supabase = await createClient();
  const result = await supabase.from("tenants").select("name, sample_seeded_at").eq("id", ctx.tenantId).maybeSingle();
  assertQueryBatchSucceeded([result], ["tenant"], "Ana panel");
  return result.data;
});

/** Boş ofis ayrımı: müşteri ve portföy sayısı (iki hafif sayım). Hata varsa null — sahte "boş" üretilmez. */
export const loadEmptyProbe = cache(async (ctx: HomeCtx) => {
  if (!ctx.tenantId) return null as { customers: number; properties: number } | null;
  const home = await homeScopeFor(ctx);
  if (home) return home.probe;
  const supabase = await createClient();
  const results = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
  ]);
  if (results.some((r) => r.error)) return null;
  return { customers: results[0].count ?? 0, properties: results[1].count ?? 0 };
});

/** Kurulum şeridi verisi (/app/baslangic ile AYNI kaynak: lib/onboarding-state). Hata varsa null — şerit gizlenir. */
export const loadOnboardingState = cache(async (ctx: HomeCtx) => {
  if (!ctx.tenantId) return null;
  const snap = await loadOnboardingSnapshot(ctx.tenantId);
  return snap?.state ?? null;
});

/* ------------------------- Yönetim: bugün karar bekleyenler ------------------------- */

const PASSIVE_DAYS = 30;
const DEALS_LIMIT = 1000;

/**
 * Yönetim rolleri için "Bugün karar bekleyenler". Hepsi gerçek sayım; sorgu hatası ya da
 * yetki yoksa ilgili alan `null` (gösterilmez — sahte sıfır yok).
 * - approvals: bana yönelik bekleyen onay talepleri (kendi talebim hariç; nav rozetiyle aynı kural)
 * - lostThisMonth: bu ay kapanan ilanlarda tahmini kaçan komisyon (yalnız `earnings_all` ile)
 * - overdueRent: gecikmiş kira tahsilatı sayısı (kiralama modülünü görebilene)
 * - passiveAdvisors: son 30 günde anlaşma hareketi olmayan aktif danışman (yalnız anlaşma satırları
 *   kırpılmadıysa hesaplanır; 30 günden yeni kaydolanlar sayılmaz)
 */
export const loadDecisions = cache(async (ctx: HomeCtx) => {
  // Anlık görüntü: sayaçlar RLS'in verdiği satırlardan SQL'de sayılır (anlaşma 1000 tavanı yok); gösterim kapıları
  // (komisyon/kazanç/kiralama yetkisi) burada, eski yolla aynı.
  const snapMetrics = (await snapshotFor(ctx)).metrics;
  if (snapMetrics) {
    const d = snapMetrics.decisions;
    return {
      approvals: ctx.canSeeCommissions ? d.approvalsPending : null,
      lostThisMonth: ctx.seeAllEarnings ? d.lostThisMonth : null,
      overdueRent: ctx.canSeeRentals ? d.overdueRent : null,
      passiveAdvisors: d.passiveAdvisors as number | null,
      passiveDays: d.passiveDays,
    };
  }
  const supabase = await createClient();
  let approvalsQ = supabase
    .from("approval_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "bekliyor")
    .neq("requested_by", ctx.userId);
  if (ctx.tenantId) approvalsQ = approvalsQ.eq("tenant_id", ctx.tenantId);
  const [approvals, advisors, deals, closures, rentals] = await Promise.all([
    ctx.canSeeCommissions ? approvalsQ : Promise.resolve(null),
    supabase.from("profiles").select("id, created_at").eq("is_active", true).in("role", ["advisor", "team_lead"]).limit(200),
    loadDeals(ctx),
    ctx.seeAllEarnings ? loadClosures(ctx) : Promise.resolve(null),
    ctx.canSeeRentals ? loadRentalsAndProjects(ctx) : Promise.resolve(null),
  ]);
  const cutoff = daysAgoIso(PASSIVE_DAYS);
  let passiveAdvisors: number | null = null;
  if (!advisors.error && deals.length < DEALS_LIMIT) {
    const active = new Set(deals.filter((d) => (d.updated_at ?? "") >= cutoff).map((d) => d.assigned_to));
    passiveAdvisors = (advisors.data ?? []).filter((a) => (a.created_at as string) < cutoff && !active.has(a.id as string)).length;
  }
  const lost = closures ? closures.thisMonth.reduce((t, r) => t + Number(r.estimated_lost_commission || 0), 0) : null;
  return {
    approvals: approvals && !approvals.error ? (approvals.count ?? 0) : null,
    lostThisMonth: lost,
    overdueRent: rentals ? rentals.rentCharges.filter((c) => c.status === "overdue").length : null,
    passiveAdvisors,
    passiveDays: PASSIVE_DAYS,
  };
});

/* ------------------------- İlk ekran ısıtma + ağır blokları geciktirme ------------------------- */

const firstScreenDone = new WeakMap<HomeCtx, Promise<void>>();

/**
 * İLK EKRAN (hero, dikkat/brifing, KPI şeridi, sıradaki eylem, bugün ara) yükleyicilerini TEK anda, bloklar çizilmeye
 * başlamadan ve boş-ofis kapısı beklenmeden başlatır. Yükleyiciler `cache()`'lidir: blok aynı `ctx` ile çağırdığında
 * yoldaki sözü alır — bağımlı tur zinciri (kapı → blok → alt sorgu) yatay turlara iner. İstek içi önbellek; süreçler arası
 * YOK. Hata blokların kendi sınırında görünür (burada yutulur). Aynı `ctx` için bir kez çalışır.
 */
export function warmHomeFirstScreen(ctx: HomeCtx, layout: { variant: string; metrics: readonly string[] }): void {
  if (firstScreenDone.has(ctx) || ctx.tvMode || !ctx.tenantId) return;
  const jobs: Promise<unknown>[] = [];
  const run = (p: Promise<unknown>) => void jobs.push(p.catch(() => undefined));
  run(loadEmptyProbe(ctx));
  run(loadAttention(ctx));
  const { variant } = layout;
  if (variant === "management" || variant === "advisor" || variant === "team_lead") run(loadInsightBundle(ctx));
  if (variant === "advisor" || variant === "team_lead") {
    run(loadTodayAppointments(ctx));
    run(loadHotLeads(ctx));
    run(loadLiveListings(ctx));
    run(loadExpiringAuthority(ctx));
    run(loadOnboardingState(ctx));
  }
  if (variant === "call_center") run(loadHotLeads(ctx));
  for (const key of layout.metrics) {
    switch (key) {
      case "ciro":
      case "komisyon-bu-ay":
      case "bekleyen-komisyon":
      case "tahsil-edilen":
        if (ctx.canSeeCommissions) run(loadCommissionSummary(ctx));
        break;
      case "aktif-anlasma":
        run(loadDeals(ctx));
        break;
      case "yeni-talep":
      case "yeni-musteri":
        run(loadPeriodStats(ctx));
        break;
      case "arama":
        run(loadKpiCounts(ctx));
        break;
      case "gorev":
        run(loadTaskSummary(ctx));
        break;
      case "geciken-kira":
        if (ctx.canSeeRentals) run(loadRentalsAndProjects(ctx));
        break;
    }
  }
  firstScreenDone.set(ctx, Promise.all(jobs).then(() => undefined));
}

/**
 * Ağır ve ilk ekranda gerekmeyen bloklar (ekip performansı, huni, ilan sağlığı, canlı akış, kaynak dağılımı, portföy şeridi...)
 * sorgularını ilk ekran yükleyicileri bitince başlatır: aynı anda onlarca istek, ilk ekranın bağlantı/yürütme payını yemesin.
 * Isıtma yapılmadıysa (TV, başka sayfa) beklemez.
 */
export function afterFirstScreen(ctx: HomeCtx): Promise<void> {
  return firstScreenDone.get(ctx) ?? Promise.resolve();
}

/* ------------------------- Dikkat gerektirenler (tek yükleyici) ------------------------- */

/** Yükleyicinin tavanı (`loadExpiringAuthority` limit 12): tavana ulaşan sayı kesin değildir (İlan sağlığı bloğu kullanır). */
export const EXPIRING_CAP = 12;

/**
 * Riskli anlaşma = eşik (Ofis Tanımları `office.alert.deal_stale_days`, varsayılan 14) gündür hareketsiz AÇIK anlaşma.
 * /app/anlasmalar?bayat=1 süzgeciyle AYNI koşul (head count, kırpılmaz). Hata → null (sahte sıfır yok).
 */
export const loadStaleDeals = cache(async (ctx: HomeCtx) => {
  const home = await homeScopeFor(ctx);
  if (home && home.staleDeals.days > 0) return { count: home.staleDeals.count as number | null, days: home.staleDeals.days };
  const days = ctx.tenantId ? await getSetting<number>("office.alert.deal_stale_days", { tenantId: ctx.tenantId }) : DEFAULT_STALE_DAYS;
  const supabase = await createClient();
  let q = ctx.sample
    .apply(supabase.from("deals").select("id", { count: "exact", head: true }))
    .not("stage", "in", "(won,lost)")
    .lt("updated_at", daysAgoIso(days));
  if (ctx.scopeMine) q = q.eq("assigned_to", ctx.userId);
  const res = await q;
  return { count: res.error ? null : (res.count ?? 0), days };
});

/**
 * "Dikkat gerektirenler" kalemleri — hero cümlesi ve Dikkat listesi AYNI kaynaktan (istek içi tek hesap).
 * Kapsam `ctx.scopeMine` ile tüm kalemlerde aynı (ben/ofis). Teyitsiz ilan yalnız yönetimde (portal teyidi yönetimin işi).
 */
export const loadAttention = cache(async (ctx: HomeCtx): Promise<HomeAttentionItem[]> => {
  const salesRole = ctx.role !== "accounting" && ctx.role !== "call_center";
  const [tasks, decisions, stale, commission] = await Promise.all([
    loadTaskSummary(ctx).catch(() => null),
    ctx.isManagement ? loadDecisions(ctx).catch(() => null) : Promise.resolve(null),
    salesRole ? loadStaleDeals(ctx).catch(() => null) : Promise.resolve(null),
    ctx.canSeeCommissions && ctx.role !== "accounting" ? loadCommissionSummary(ctx).catch(() => null) : Promise.resolve(null),
  ]);
  return buildAttentionItems({
    overdueTasks: tasks?.overdue ?? null,
    approvals: decisions?.approvals ?? null,
    overdueRent: decisions?.overdueRent ?? null,
    staleDeals: stale?.count ?? null,
    staleDays: stale?.days ?? DEFAULT_STALE_DAYS,
    pendingCommission: commission?.pending ?? null,
    pendingCommissionText: moneyTry(commission?.pending ?? 0),
    passiveAdvisors: decisions?.passiveAdvisors ?? null,
    passiveDays: decisions?.passiveDays ?? PASSIVE_DAYS,
    mine: ctx.scopeMine,
    userId: ctx.userId,
  });
});
