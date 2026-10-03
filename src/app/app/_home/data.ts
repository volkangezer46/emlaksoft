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
import { computeLeadScore } from "@/lib/lead-score";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { TR_OFFSET_MS, daysAgoIso, now, trParts } from "@/lib/clock";
import type { Period } from "@/components/ui/premium";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import {
  commissionSummaryFromAggregate,
  type CommissionAggregate,
  type DealRow,
  type DemandCounts,
  type ListingRow,
} from "./helpers";

export type HomeCtx = {
  tenantId: string | null;
  tvMode: boolean;
  canSeeRentals: boolean;
  canSeeProjects: boolean;
  canSeeProperties: boolean;
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

// customer_lead_signals RPC satırı — bkz. /app/musteriler sayfasındaki aynı desen
export type LeadSignalRow = {
  customer_id: string;
  active_demands: number;
  comms: number;
  appts: number;
  calls: number;
  last_activity: string | null;
};

/* ------------------------------ Dönem (7/30/90) ----------------------------- */

const PERIOD_SERIES_LIMIT = 500;

/**
 * Seçili dönemde (son N gün) yeni müşteri ve yeni talep sayısı + bir önceki aynı
 * uzunlukta dönem (karşılaştırma). Sayılar `head count` (kırpılmaz). Seri için
 * yalnız cari dönemin tarih kolonu çekilir; satır sınırına çarparsa seri
 * `null` döner (kırpık seri çizilmez — uydurma yok).
 */
export const loadPeriodStats = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  const days = ctx.period;
  const curStart = daysAgoIso(days);
  const prevStart = daysAgoIso(days * 2);
  const customers = () => supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null);
  const demands = () => supabase.from("customer_demands").select("id", { count: "exact", head: true });
  const results = await Promise.all([
    customers().gte("created_at", curStart),
    customers().gte("created_at", prevStart).lt("created_at", curStart),
    demands().gte("created_at", curStart),
    demands().gte("created_at", prevStart).lt("created_at", curStart),
    supabase.from("customers").select("created_at").is("deleted_at", null)
      .gte("created_at", curStart).order("created_at", { ascending: false }).limit(PERIOD_SERIES_LIMIT),
    supabase.from("customer_demands").select("created_at")
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
  const supabase = await createClient();
  const results = await Promise.all([
    // Bugün vadesi gelen açık görevler (yalnız sayaç)
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "open").gte("due_at", ctx.dayStartIso).lt("due_at", ctx.dayEndIso),
    // Vadesi geçmiş (bugünden önce) açık görevler (yalnız sayaç)
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "open").lt("due_at", ctx.dayStartIso),
    // Bugünün gerçek görevleri (gecikmiş dahil) — hover'da tek tıkla tamamlanır
    supabase.from("tasks").select("id, title, due_at, priority")
      .eq("status", "open").lt("due_at", ctx.dayEndIso)
      .order("due_at", { ascending: true }).limit(5),
  ]);
  assertQueryBatchSucceeded(results, ["tasks-due-today", "tasks-overdue", "open-tasks"], "Ana panel");
  const [due, overdue, open] = results;
  return {
    dueToday: due.count ?? 0,
    overdue: overdue.count ?? 0,
    open: open.data ?? [],
  };
});

export const loadTodayAppointments = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  // count: brifingde gerçek toplam gerekir. Açık ilişki adı ipucu korunur.
  const result = await supabase
    .from("appointments")
    .select("id, appointment_type, scheduled_at, status, customer:customers!appointments_customer_id_fkey(full_name, phone)", { count: "exact" })
    .gte("scheduled_at", ctx.dayStartIso).lt("scheduled_at", ctx.dayEndIso)
    .order("scheduled_at", { ascending: true }).limit(5);
  assertQueryBatchSucceeded([result], ["today-appointments"], "Ana panel");
  return { rows: result.data ?? [], total: result.count ?? 0 };
});

export const loadHotLeadCount = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  const results = await Promise.all([
    supabase.from("customers").select("id, phone, email, source, blacklist, created_at")
      .is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    ctx.tenantId
      ? supabase.rpc("customer_lead_signals", { p_tenant_id: ctx.tenantId })
      : Promise.resolve({ data: [] as LeadSignalRow[] }),
  ]);
  assertQueryBatchSucceeded(results, ["briefing-customers", "lead-signals"], "Ana panel");
  const [{ data: customers }, { data: signals }] = results;
  const signalMap = new Map<string, LeadSignalRow>();
  for (const s of (signals ?? []) as LeadSignalRow[]) signalMap.set(s.customer_id, s);
  return (customers ?? []).filter((c) => {
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
});

/** Yetki belgesi 15 gün içinde dolacak portföyler.
 * NOT: `properties.authority_expires_at` kolonu veritabanında YOK (hiçbir migration eklemedi,
 * hiçbir form yazmıyor); sorgu 42703 verip ana paneli düşürüyordu. Yetki belgesi takibi
 * (yol haritası A2) kolonu eklediğinde bu sorgu geri bağlanacak; o zamana kadar boş döner. */
export const loadExpiringAuthority = cache(async () => ({
  data: [] as { id: string; property_code: string | null; title: string | null; authority_expires_at: string | null }[],
}));

/* ------------------------------- Ortak kümeler ------------------------------ */

export const loadLiveListings = cache(async () => {
  const supabase = await createClient();
  const result = await supabase
    .from("portal_listings")
    .select("id, portal_name, portal_listing_id, last_confirmed_at")
    .eq("status", "live")
    .limit(100);
  assertQueryBatchSucceeded([result], ["live-listings"], "Ana panel");
  return (result.data ?? []) as ListingRow[];
});

/**
 * Son 6 ay komisyon özeti — tam kapsamlı SQL aggregate (`tenant_commission_aggregates`).
 * Eskiden 500 satır çekilip JS'te toplanıyordu (500'ü aşan ofiste kırpılırdı).
 * Kapsam aynı: RLS ile RPC aynı tenant + commissions:view kapısını kullanır. Ana ekran
 * yalnız "dashboard" yetkisi istediği için commissions:view olmayan kullanıcıda RPC 42501
 * döner; RLS altında eski sorgu boş dönüyordu → aynı şekilde sıfır özet.
 */
export const loadCommissionSummary = cache(async (ctx: HomeCtx) => {
  void ctx; // cache anahtarı: aynı istek bağlamı
  const supabase = await createClient();
  const result = await supabase.rpc("tenant_commission_aggregates", { p_as_of: new Date(now()).toISOString() });
  if (result.error?.code === "42501") return commissionSummaryFromAggregate(null);
  assertQueryBatchSucceeded([result], ["commission-aggregates"], "Ana panel");
  return commissionSummaryFromAggregate(result.data as unknown as CommissionAggregate);
});

/** KPI sparkline: yalnız son 7 haftanın komisyon oluşturma tarihleri (tek kolon). */
export const loadCommissionWeekDates = cache(async () => {
  const supabase = await createClient();
  const result = await supabase
    .from("commissions")
    .select("created_at")
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
export const loadDemandCounts = cache(async (): Promise<DemandCounts> => {
  const supabase = await createClient();
  const count = (status: string) =>
    supabase.from("customer_demands").select("id", { count: "exact", head: true }).eq("status", status);
  const results = await Promise.all([count("new"), count("active"), count("matched")]);
  assertQueryBatchSucceeded(results, ["demands-new", "demands-active", "demands-matched"], "Ana panel");
  return { new: results[0].count ?? 0, active: results[1].count ?? 0, matched: results[2].count ?? 0 };
});

export const loadDeals = cache(async () => {
  const supabase = await createClient();
  // Son 3 ay
  const result = await supabase
    .from("deals")
    .select("stage, deal_value, assigned_to, updated_at")
    .gte("updated_at", daysAgoIso(90))
    .order("updated_at", { ascending: false }) // kırpma belirleyici: en yeni anlaşmalar
    .limit(1000);
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
  const supabase = await createClient();
  const liveCustomers = () => supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null);
  const results = await Promise.all([
    liveCustomers(),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("calls").select("id", { count: "exact", head: true }).gte("started_at", ctx.dayStartIso),
    liveCustomers().gte("created_at", ctx.monthStartIso),
    liveCustomers().gte("created_at", ctx.prevMonthStartIso).lt("created_at", ctx.monthStartIso),
    supabase.from("calls").select("id", { count: "exact", head: true })
      .gte("started_at", ctx.yesterdayStartIso).lt("started_at", ctx.dayStartIso),
    // Sparkline: yalnız 7 haftalık pencere, yalnız tarih kolonu
    supabase.from("calls").select("started_at").gte("started_at", daysAgoIso(49))
      .order("started_at", { ascending: false }).limit(100),
    supabase.from("customers").select("created_at").is("deleted_at", null)
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

export const loadRentalsAndProjects = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  // Modül yetkisi yoksa sorgu bile atılmaz.
  const results = await Promise.all([
    ctx.canSeeRentals
      ? supabase.from("rentals").select("id", { count: "exact", head: true }).eq("status", "active")
      : Promise.resolve({ count: 0 }),
    // Bu ayın tahakkukları + (hangi aya ait olursa olsun) gecikmişler — tek sorgu
    ctx.canSeeRentals
      ? supabase
          .from("rent_charges")
          .select("amount, status, period")
          .or(`period.eq.${ctx.monthStartKey},status.eq.overdue`)
          .limit(1000)
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
const SOURCE_ROW_LIMIT = 2000;
export const loadCustomerSources = cache(async () => {
  const supabase = await createClient();
  const result = await supabase.from("customers").select("source").is("deleted_at", null).limit(SOURCE_ROW_LIMIT);
  assertQueryBatchSucceeded([result], ["customer-sources"], "Ana panel");
  const rows = (result.data ?? []) as { source: string | null }[];
  if (rows.length >= SOURCE_ROW_LIMIT) return null;
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

export const loadLatestCustomers = cache(async () => {
  const supabase = await createClient();
  const result = await supabase
    .from("customers")
    .select("id, full_name, customer_types, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(4);
  assertQueryBatchSucceeded([result], ["latest-customers"], "Ana panel");
  return result.data ?? [];
});

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
