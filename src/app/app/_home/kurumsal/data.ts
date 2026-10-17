/**
 * KURUMSAL ANA EKRAN — veri yükleyicileri (sahip kararı 2026-10-16: referans pano düzeni, tek görünüm).
 *
 * Her blok kendi yükleyicisini kendi Suspense sınırında çağırır (React `cache()` aynı istekte tekilleştirir); sorgular
 * yalnız `head` sayımları ve dar kolonlu kısa listelerdir. Kapsam kuralı ana ekranla aynıdır: `ctx.scopeMine` (danışman
 * ya da "Benim işlerim") → `assigned_to = ben`. Örnek veri süzgeci `ctx.sample.apply`. Hata → o blok "veri alınamadı"
 * durumunu gösterir (sahte sıfır yok); saf hesaplar `./core.ts` içinde (vitest).
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DAY_MS, daysAgoIso, now, trParts, TR_OFFSET_MS } from "@/lib/clock";
import { propertyThumbUrl } from "@/lib/property-media-thumb";
import type { PresenceRow } from "@/lib/presence";
import { readPublicStatusFresh } from "@/lib/status-page/cache";
import { overallStatus, type OverallLevel } from "@/lib/status-page/model";
import { loadAttention, loadCommissionSummary, loadRentalsAndProjects, loadLiveListings, loadPendingApprovals, loadStaleDeals, loadTaskSummary, loadTodayAppointments, loadDemandCounts, type HomeCtx } from "../data";
import type { HomeAttentionItem } from "../home-metrics";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { appointmentHref, taskHref } from "@/lib/notification-text";
import { kindMeta } from "@/lib/approvals";
import { getRequestIdentity } from "@/lib/cache/request";
import { getCatalogForPlan } from "@/lib/billing/plan-definitions";
import { resolvePlanDef } from "@/lib/billing/plans";
import { LISTING_CONFIRM_STALE_DAYS, confirmationBaseMs, confirmationHealth, isConfirmationOverdue } from "@/lib/listing-confirmation";
import { getOfficeScoreCached } from "@/lib/office-score";
import { getOfficeSize } from "@/lib/ui-prefs-server";
import { weekBuckets } from "../helpers";
import { CLOSED_DEAL_STAGES, postgrestInList } from "@/lib/workflow-state";
import {
  SPARK_WEEKS,
  buildTeamToday,
  type TeamLog,
  type TeamProfile,
  type TeamTodayPerson,
  joinDetail,
  newlyOverdueListings,
  listingBadge,
  rentDueIso,
  type AttentionRecord,
  salesSeries,
  salesSummary,
  type ListingCard,
  type SalesFilter,
  type SalesRange,
  type SalesRow,
  type TaskCard,
} from "./core";

const trMidnightIso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - TR_OFFSET_MS).toISOString();

/* ------------------------------ KPI satırı ------------------------------ */

/** Sayaç göstergesi: bu ayın ilk N günü ↔ geçen ayın ilk N günü + son 12 haftanın haftalık kovaları (mini çubuklar). */
export type CountKpi = { thisMonth: number; prevMonth: number; weekly: number[] };

export type KpiData = {
  revenue: { thisMonth: number; prevMonth: number; monthly: number[] } | null;
  /** Açık (kazanılmamış/kaybedilmemiş) anlaşma sayısı + bu ay açılan anlaşmalar. */
  deals: (CountKpi & { open: number }) | null;
  /** Son 30 gün ↔ önceki 30 gün (talep listesinin `?eklenen=30` süzgeciyle aynı küme). */
  demands: CountKpi | null;
  customers: CountKpi | null;
  /** Gelen arama (direction = inbound). */
  calls: CountKpi | null;
};

/**
 * KPI satırı (v4 referans: Bu ay ciro · Aktif anlaşma · Yeni talep · Yeni müşteri · Gelen arama). Her kart yalnız modülü
 * görebilene sorulur; okunamayan kart çizilmez (sahte 0 yok). Sorgular `head` sayımları + son 84 günün yalnız tarih kolonu
 * (en çok 600 satır); kapsam `ctx.scopeMine` (danışman / "Benim işlerim").
 */
export const loadKpiData = cache(async (ctx: HomeCtx): Promise<KpiData> => {
  const supabase = await createClient();
  const nowMs = now();
  const p = trParts(nowMs);
  const monthStart = trMidnightIso(p.year, p.month, 1);
  const prevMonthStart = trMidnightIso(p.year, p.month - 1, 1);
  // Adil karşılaştırma: bu ayın ilk N günü ↔ geçen ayın ilk N günü (satış performansıyla aynı kural, `salesWindow`).
  const prevMonthSameDay = new Date(Math.min(Date.parse(monthStart), Date.parse(prevMonthStart) + (nowMs - Date.parse(monthStart)))).toISOString();
  const since = new Date(nowMs - SPARK_WEEKS * 7 * DAY_MS).toISOString();
  // Kapsam süzgeci: tip derinliği için gevşek imza (PostgREST zinciri aynı kalır).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const by = <Q,>(q: Q, col: string): Q => (ctx.scopeMine ? (q as any).eq(col, ctx.userId) : q);
  const can = (m: keyof HomeCtx["perms"]) => (ctx.perms[m] ?? []).includes("view");

  type Counted = { count: number | null; error: unknown };
  type Dated = { data: unknown[] | null; error: unknown };
  /** Aynı kümenin üç sayımı + tarih listesi (tek kalıp: bu ay, geçen ayın eş dönemi, son 12 hafta). */
  const triple = (count: () => unknown, dated: () => unknown, col: string) =>
    Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (count() as any).gte(col, monthStart) as Promise<Counted>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (count() as any).gte(col, prevMonthStart).lt(col, prevMonthSameDay) as Promise<Counted>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dated() as any).gte(col, since).order(col, { ascending: false }).limit(600) as Promise<Dated>,
    ]);
  const head = { count: "exact" as const, head: true };

  const custCount = () => by(ctx.sample.apply(supabase.from("customers").select("id", head).is("deleted_at", null)), "assigned_to");
  const custDated = () => by(ctx.sample.apply(supabase.from("customers").select("created_at").is("deleted_at", null)), "assigned_to");
  const dealCount = () => by(ctx.sample.apply(supabase.from("deals").select("id", head)), "assigned_to");
  const dealDated = () => by(ctx.sample.apply(supabase.from("deals").select("created_at")), "assigned_to");
  // Talep kişiye müşterisinin danışmanı üzerinden bağlanır (talep satırında atama yok).
  const demandSel = (cols: string, opts?: typeof head) =>
    ctx.scopeMine
      ? ctx.sample.apply(supabase.from("customer_demands").select(`${cols}, owner:customers!customer_demands_customer_id_fkey!inner(assigned_to)`, opts)).eq("owner.assigned_to", ctx.userId)
      : ctx.sample.apply(supabase.from("customer_demands").select(cols, opts));
  const callCount = () => by(ctx.sample.apply(supabase.from("calls").select("id", head).eq("direction", "inbound")), "handled_by");
  const callDated = () => by(ctx.sample.apply(supabase.from("calls").select("started_at").eq("direction", "inbound")), "handled_by");

  const [revenue, custRes, dealRes, dealOpen, demandRes, callRes] = await Promise.all([
    ctx.canSeeCommissions
      ? loadCommissionSummary(ctx)
          .then((c) => ({ thisMonth: c.monthTotals.at(-1) ?? 0, prevMonth: c.monthTotals.at(-2) ?? 0, monthly: [...c.monthTotals] }))
          .catch(() => null)
      : Promise.resolve(null),
    can("customers") ? triple(custCount, custDated, "created_at").catch(() => null) : Promise.resolve(null),
    can("commissions") ? triple(dealCount, dealDated, "created_at").catch(() => null) : Promise.resolve(null),
    can("commissions") ? Promise.resolve(dealCount().not("stage", "in", postgrestInList(CLOSED_DEAL_STAGES)) as unknown as PromiseLike<Counted>).catch(() => null) : Promise.resolve(null),
    // Talep listesi tarih süzgeci son N gündür (`?eklenen=30`): gösterge aynı küme (son 30 gün ↔ önceki 30 gün).
    can("demands")
      ? Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (demandSel("id", head) as any).gte("created_at", daysAgoIso(30)) as Promise<Counted>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (demandSel("id", head) as any).gte("created_at", daysAgoIso(60)).lt("created_at", daysAgoIso(30)) as Promise<Counted>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (demandSel("created_at") as any).gte("created_at", since).order("created_at", { ascending: false }).limit(600) as Promise<Dated>,
        ]).catch(() => null)
      : Promise.resolve(null),
    can("calls") ? triple(callCount, callDated, "started_at").catch(() => null) : Promise.resolve(null),
  ]);
  const weekly = (rows: unknown[] | null, col: string) =>
    weekBuckets(
      ((rows ?? []) as Record<string, string | null>[]).flatMap((r) => (r[col] ? [r[col]!] : [])),
      nowMs,
      SPARK_WEEKS,
    );
  const kpi = (rs: [Counted, Counted, Dated] | null, col: string): CountKpi | null =>
    rs && rs.every((r) => !r.error) ? { thisMonth: rs[0].count ?? 0, prevMonth: rs[1].count ?? 0, weekly: weekly(rs[2].data, col) } : null;
  const deals = kpi(dealRes, "created_at");
  return {
    revenue,
    deals: deals && dealOpen && !dealOpen.error ? { ...deals, open: dealOpen.count ?? 0 } : null,
    demands: kpi(demandRes, "created_at"),
    customers: kpi(custRes, "created_at"),
    calls: kpi(callRes, "started_at"),
  };
});

/* --------------------------- Satış performansı --------------------------- */

export type SalesData = { summary: ReturnType<typeof salesSummary>; series: ReturnType<typeof salesSeries>; advisors: { id: string; name: string }[] } | null;

/**
 * Kazanılan anlaşmalar (stage = won): seçili dönem + bir önceki eş dönem. Kapanış anı `closed_at` (yoksa `updated_at`;
 * kolon henüz yoksa 42703 → güncellenme anıyla aynı sorgu). Tür süzgeci (satılık/kiralık = deal_type sale/rent) ve
 * yönetimde danışman süzgeci URL'den gelir.
 */
export const loadSalesPerformance = cache(async (ctx: HomeCtx, range: SalesRange, filter: SalesFilter): Promise<SalesData> => {
  if (!ctx.canSeeCommissions) return null;
  const supabase = await createClient();
  const nowMs = now();
  const p = trParts(nowMs);
  const sinceIso = range === "ay" ? trMidnightIso(p.year, p.month - 1, 1) : range === "6ay" ? trMidnightIso(p.year, p.month - 11, 1) : trMidnightIso(p.year - 1, 0, 1);
  const build = (cols: string) => {
    let q = ctx.sample.apply(supabase.from("deals").select(cols)).eq("stage", "won").gte("updated_at", sinceIso);
    if (ctx.scopeMine) q = q.eq("assigned_to", ctx.userId);
    else if (filter.danisman) q = q.eq("assigned_to", filter.danisman);
    if (filter.tur === "satilik") q = q.eq("deal_type", "sale");
    if (filter.tur === "kiralik") q = q.eq("deal_type", "rent");
    return q.order("updated_at", { ascending: false }).limit(1000);
  };
  let res = await build("deal_value, created_at, closed_at, updated_at");
  if (res.error?.code === "42703") res = await build("deal_value, created_at, updated_at");
  if (res.error) return null;
  type RawDeal = { deal_value: number | string | null; created_at: string | null; closed_at?: string | null; updated_at: string | null };
  const rows: SalesRow[] = ((res.data ?? []) as unknown as RawDeal[]).map((r) => ({
    value: Number(r.deal_value ?? 0) || 0,
    createdAt: r.created_at ?? null,
    closedAt: r.closed_at ?? r.updated_at ?? null,
  }));
  let advisors: { id: string; name: string }[] = [];
  if (ctx.isManagement && !ctx.scopeMine) {
    const prof = await supabase.from("profiles").select("id, full_name, role, is_active").eq("is_active", true).order("full_name").limit(200);
    advisors = ((prof.data ?? []) as { id: string; full_name: string | null }[]).map((x) => ({ id: x.id, name: x.full_name?.trim() || "Adsız kullanıcı" }));
  }
  return { summary: salesSummary(rows, range, nowMs), series: salesSeries(rows, range, nowMs), advisors };
});

/* --------------------------- Son eklenen ilanlar --------------------------- */

type RawListing = {
  id: string;
  title: string | null;
  property_code: string | null;
  list_price: number | string | null;
  currency: string | null;
  transaction_type: string | null;
  property_type: string | null;
  features: { sqm?: number | string | null; rooms?: string | null } | null;
  created_at: string | null;
  published_at: string | null;
  district: { name: string | null } | { name: string | null }[] | null;
  cover: { id: string; storage_path: string | null; file_size: number | null; has_watermark: boolean | null }[] | null;
  portal_listings: { status: string | null }[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export const loadRecentListings = cache(async (ctx: HomeCtx, limit = 4): Promise<ListingCard[] | null> => {
  if (!ctx.canSeeProperties) return null;
  const supabase = await createClient();
  let q = ctx.sample
    .apply(
      supabase
        .from("properties")
        .select(
          "id, title, property_code, list_price, currency, transaction_type, property_type, features, created_at, published_at, district:geo_districts(name), cover:property_media!property_media_property_id_fkey(id, storage_path, file_size, has_watermark), portal_listings!portal_listings_property_id_fkey(status)",
        )
        .is("deleted_at", null),
    )
    .eq("cover.kind", "image")
    .eq("cover.is_cover", true)
    .limit(1, { referencedTable: "cover" });
  if (ctx.scopeMine) q = q.eq("assigned_to", ctx.userId);
  const [res, drops] = await Promise.all([
    q.order("created_at", { ascending: false }).limit(limit),
    supabase.from("property_price_history").select("property_id, change_pct").eq("price_field", "list_price").lt("change_pct", 0).gte("created_at", daysAgoIso(30)).limit(200),
  ]);
  if (res.error) return null;
  const dropped = new Set(((drops.data ?? []) as { property_id: string }[]).map((d) => d.property_id));
  const nowMs = now();
  return ((res.data ?? []) as unknown as RawListing[]).map((r) => {
    const cover = one(r.cover);
    const sqmRaw = r.features?.sqm;
    const sqm = sqmRaw != null && Number(sqmRaw) > 0 ? Number(sqmRaw) : null;
    const live = (r.portal_listings ?? []).some((l) => l.status === "live");
    return {
      id: r.id,
      title: r.title?.trim() || r.property_code || "Portföy",
      district: one(r.district)?.name ?? null,
      sqm,
      rooms: r.features?.rooms ?? null,
      price: r.list_price == null ? null : Number(r.list_price),
      currency: r.currency ?? "TRY",
      transaction: r.transaction_type,
      coverSrc: cover?.id ? propertyThumbUrl(cover.id, cover, "kart") : null,
      badge: listingBadge({ priceDropped: dropped.has(r.id), createdAt: r.created_at, published: Boolean(r.published_at), live }, nowMs),
    };
  });
});

/* --------------------------- Yapılacak görevler --------------------------- */

export const loadUpcomingTasks = cache(async (ctx: HomeCtx, limit = 6): Promise<TaskCard[] | null> => {
  if (!(ctx.perms.tasks ?? []).includes("view")) return null;
  const supabase = await createClient();
  const until = new Date(new Date(ctx.dayStartIso).getTime() + 8 * DAY_MS).toISOString();
  let q = ctx.sample
    .apply(supabase.from("tasks").select("id, title, due_at, priority, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name, avatar_url, avatar_preset)"))
    .eq("status", "open")
    .lt("due_at", until);
  if (ctx.scopeMine) q = q.eq("assigned_to", ctx.userId);
  const res = await q.order("due_at", { ascending: true }).limit(limit);
  if (res.error) return null;
  type Raw = { id: string; title: string | null; due_at: string | null; priority: string | null; assignee: { full_name: string | null; avatar_url: string | null; avatar_preset: string | null } | { full_name: string | null; avatar_url: string | null; avatar_preset: string | null }[] | null };
  return ((res.data ?? []) as unknown as Raw[]).map((t) => {
    const a = one(t.assignee);
    return {
      id: t.id,
      title: t.title?.trim() || "Görev",
      dueAt: t.due_at,
      high: t.priority === "high",
      assignee: a ? { name: a.full_name?.trim() || "Kullanıcı", avatarUrl: a.avatar_url, avatarPreset: a.avatar_preset } : null,
    };
  });
});

/* --------------------------- Kahraman: fotoğraf + durum --------------------------- */

/**
 * Kahraman fotoğrafı: ofisin YAYINDAKİ (vitrinde ya da portalda canlı) kapak fotoğraflı portföylerinden biri, güne göre
 * döner (her gün aynı ofiste aynı fotoğraf; ertesi gün sıradaki). Yayında olmayan portföy fotoğrafı kullanılmaz.
 */
export const loadHeroPhoto = cache(async (ctx: HomeCtx): Promise<{ src: string; cardSrc: string; title: string; href: string } | null> => {
  if (!ctx.canSeeProperties) return null;
  const supabase = await createClient();
  const res = await ctx.sample
    .apply(
      supabase
        .from("properties")
        .select("id, title, property_code, published_at, cover:property_media!property_media_property_id_fkey!inner(id, storage_path, file_size, has_watermark)")
        .is("deleted_at", null)
        .not("published_at", "is", null),
    )
    .eq("cover.kind", "image")
    .eq("cover.is_cover", true)
    .order("published_at", { ascending: false })
    .limit(12);
  if (res.error) return null;
  type Raw = { id: string; title: string | null; property_code: string | null; cover: { id: string; storage_path: string | null; file_size: number | null; has_watermark: boolean | null }[] | null };
  const rows = ((res.data ?? []) as unknown as Raw[]).filter((r) => one(r.cover)?.id);
  if (rows.length === 0) return null;
  const dayIndex = Math.floor((now() + TR_OFFSET_MS) / DAY_MS);
  const pick = rows[dayIndex % rows.length]!;
  const cover = one(pick.cover)!;
  return { src: propertyThumbUrl(cover.id, cover, "genis"), cardSrc: propertyThumbUrl(cover.id, cover, "kart"), title: pick.title?.trim() || pick.property_code || "Portföy", href: `/app/portfoyler/${pick.id}` };
});

export type OfficeStatus = {
  liveListings: number | null;
  overdueListings: number;
  /** Son 24 saatte teyit süresi dolan ilan ("+N"). */
  newOverdueListings: number;
  healthPct: number | null;
  /** Ofis sağlık skoru (0–100, kabuktaki "Skor 78" ile aynı kaynak; yalnız yönetim). */
  score: { score: number; label: string } | null;
  activeUsers: number | null;
  /** Paketin kullanıcı sınırı (limitsiz pakette null). */
  seatLimit: number | null;
  todayAppointments: number | null;
  newDemands: number | null;
  /** Bugün vadesi gelen ve vadesi geçmiş açık görev (kapsama göre); görev yetkisi yoksa null. */
  tasksToday: { dueToday: number; overdue: number } | null;
};

/** "Ofis durumu" paneli + kahraman özet cümlesi: mevcut paylaşılan yükleyicilerden (ek tur yok, istek-içi önbellek). */
export const loadOfficeStatus = cache(async (ctx: HomeCtx): Promise<OfficeStatus> => {
  const [listings, appts, demands, size, tasks, seatLimit, score] = await Promise.all([
    (ctx.perms.portals ?? []).includes("view") ? loadLiveListings(ctx).catch(() => null) : Promise.resolve(null),
    (ctx.perms.appointments ?? []).includes("view") ? loadTodayAppointments(ctx).catch(() => null) : Promise.resolve(null),
    (ctx.perms.customers ?? []).includes("view") ? loadDemandCounts(ctx).catch(() => null) : Promise.resolve(null),
    ctx.isManagement && ctx.tenantId ? getOfficeSize(ctx.tenantId) : Promise.resolve(null),
    (ctx.perms.tasks ?? []).includes("view") ? loadTaskSummary(ctx).catch(() => null) : Promise.resolve(null),
    ctx.isManagement ? loadSeatLimit(ctx).catch(() => null) : Promise.resolve(null),
    ctx.isManagement && ctx.tenantId ? getOfficeScoreCached(ctx.tenantId).catch(() => null) : Promise.resolve(null),
  ]);
  // Teyit sağlığı tek tanım (`@/lib/listing-confirmation`): damgasız ilan yayın anından yaşlanır; ilan yoksa sağlık yok.
  const health = listings ? confirmationHealth(listings, now()) : null;
  return {
    liveListings: health ? health.total : null,
    overdueListings: health?.overdue ?? 0,
    newOverdueListings: listings ? newlyOverdueListings(listings, now()) : 0,
    score,
    healthPct: health?.pct ?? null,
    activeUsers: size?.seats ?? null,
    seatLimit,
    todayAppointments: appts ? appts.total : null,
    newDemands: demands ? demands.new : null,
    tasksToday: tasks ? { dueToday: tasks.dueToday, overdue: tasks.overdue } : null,
  };
});

/** Paketin kullanıcı sınırı (kabuktaki Paketim kartıyla aynı tanım: `resolvePlanDef(plan).limits.seats`). */
const loadSeatLimit = cache(async (ctx: HomeCtx): Promise<number | null> => {
  const plan = (await getRequestIdentity(ctx.userId)).data?.tenant?.plan ?? undefined;
  const catalog = await getCatalogForPlan(plan);
  return resolvePlanDef(plan, catalog).limits.seats ?? null;
});

/* --------------------------- Bugün ofiste olanlar --------------------------- */

export type { TeamTodayPerson } from "./core";

/** Bugün kimse kayıt bırakmadıysa (ör. sabah erken) kart son 7 günün en son faaliyetleriyle dolar (zamanı yazılı). */
const TEAM_LOOKBACK_DAYS = 7;

/**
 * Bugün ofiste olanlar (yönetim): ekip DURUMU (`user_presence`: Ofiste/Mola/Uzakta/Sahada/Görüşmede, gün sonunda biter)
 * + denetim kayıtlarından (audit_logs, kiracı RLS'i) kişi başı SON kayıt → son görülme ve kısa faaliyet adı. Birleştirme
 * saf `buildTeamToday`'de. Durum tablosu yoksa (migration bekliyor) yalnız denetim kayıtlarıyla çalışır. Bugün kimse yoksa
 * son 7 günde kayıt bırakanlar zamanıyla listelenir. Okunamazsa null (sahte kişi yok).
 */
export const loadTeamToday = cache(async (ctx: HomeCtx): Promise<{ people: TeamTodayPerson[]; total: number } | null> => {
  if (!ctx.isManagement || !ctx.tenantId) return null;
  const supabase = await createClient();
  const nowMs = now();
  const since = new Date(Math.min(Date.parse(ctx.dayStartIso), nowMs - TEAM_LOOKBACK_DAYS * DAY_MS)).toISOString();
  const [logs, pres] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("actor_id, action, entity_type, created_at")
      .eq("tenant_id", ctx.tenantId)
      .not("actor_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(400),
    supabase.from("user_presence").select("user_id, status, note, updated_at, is_sample").eq("tenant_id", ctx.tenantId).order("updated_at", { ascending: false }).limit(200),
  ]);
  if (logs.error) return null;
  const latest = new Map<string, TeamLog>();
  for (const r of (logs.data ?? []) as ({ actor_id: string } & TeamLog)[]) {
    if (!latest.has(r.actor_id)) latest.set(r.actor_id, r);
  }
  // Durum tablosu yoksa / okunamazsa boş: kart denetim kayıtlarıyla çalışır.
  const presence = new Map<string, PresenceRow>();
  for (const r of (pres.error ? [] : (pres.data ?? [])) as ({ user_id: string } & PresenceRow)[]) presence.set(r.user_id, r);
  const ids = [...new Set([...presence.keys(), ...latest.keys()])];
  if (ids.length === 0) return { people: [], total: 0 };
  const prof = await supabase.from("profiles").select("id, full_name, avatar_url, avatar_preset, role, title, is_active").eq("tenant_id", ctx.tenantId).in("id", ids.slice(0, 80));
  if (prof.error) return null;
  // Ofis dışı (platform personeli vb.) kayıtlar: profili bu ofiste yoksa listelenmez (buildTeamToday yalnız profilleri gezer).
  return buildTeamToday({ profiles: (prof.data ?? []) as TeamProfile[], logs: latest, presence, nowMs, dayStartIso: ctx.dayStartIso });
});

/* --------------------------- Ofis durumu: alt satır (sistem + son yedek) --------------------------- */

export type ServiceStatus = {
  /** Kamuya açık durum sayfasının (/durum) genel düzeyi; okunamazsa "unknown". */
  level: OverallLevel;
  /** En son yedeklemenin YALNIZ zamanı ve durumu (`office_last_backup`, DEFINER); RPC/tablo yoksa null. */
  backup: { atMs: number; status: string } | null;
};

/**
 * Ofis durumu panelinin alt satırı. Sistem: /durum'un kaynağı (`readPublicStatusFresh`, 30 sn paylaşılan önbellek; kiracı
 * verisi değil, herkese açık). Yedek: `office_last_backup()` (oturumlu ofis kullanıcısı; dosya/boyut/ayrıntı dönmez).
 * İkisi paralel; biri düşerse diğeri çizilir.
 */
export const loadServiceStatus = cache(async (): Promise<ServiceStatus> => {
  const supabase = await createClient();
  const [sys, bk] = await Promise.all([
    readPublicStatusFresh()
      .then(({ at, status }) => overallStatus({ incidents: status.incidents, outageOpen: status.outageOpen, nowMs: at, readable: status.readable }))
      .catch((): OverallLevel => "unknown"),
    supabase.rpc("office_last_backup"),
  ]);
  const row = !bk.error && Array.isArray(bk.data) ? (bk.data[0] as { finished_at?: string | null; status?: string | null } | undefined) : undefined;
  const atMs = row?.finished_at ? Date.parse(row.finished_at) : NaN;
  return { level: sys, backup: Number.isFinite(atMs) ? { atMs, status: String(row?.status ?? "") } : null };
});

/* --------------------------- Kurulum sonrası: hedef kartı --------------------------- */

/**
 * Bu ay EN ÇOK KATKI veren danışman (ofis geneli hedef kartı): bu ay oluşan komisyonların anlaşma sorumlusuna göre toplamı.
 * Yalnız ofis kazancını görebilen (`seeAllEarnings`) ve ofis geneli görünümde; aksi halde null (kişisel kazanç gizliliği).
 */
export const loadTopContributor = cache(async (ctx: HomeCtx): Promise<{ id: string; name: string; amount: number } | null> => {
  if (!ctx.seeAllEarnings || ctx.scopeMine || !ctx.canSeeCommissions) return null;
  const supabase = await createClient();
  const res = await ctx.sample
    .apply(supabase.from("commissions").select("gross_amount, deal:deals!commissions_deal_id_fkey!inner(assigned_to)"))
    .gte("created_at", ctx.monthStartIso)
    .limit(1000);
  if (res.error) return null;
  type Raw = { gross_amount: number | string | null; deal: { assigned_to: string | null } | { assigned_to: string | null }[] | null };
  const sums = new Map<string, number>();
  for (const r of (res.data ?? []) as unknown as Raw[]) {
    const who = one(r.deal)?.assigned_to;
    if (!who) continue;
    sums.set(who, (sums.get(who) ?? 0) + (Number(r.gross_amount ?? 0) || 0));
  }
  let best: [string, number] | null = null;
  for (const e of sums) if (e[1] > 0 && (!best || e[1] > best[1])) best = e;
  if (!best) return null;
  const prof = await supabase.from("profiles").select("full_name").eq("id", best[0]).maybeSingle();
  const name = (prof.data?.full_name as string | null | undefined)?.trim() || "Adsız kullanıcı";
  return { id: best[0], name, amount: best[1] };
});

/** Bu ay kazanılan anlaşma sayısı (kapanış hedefi; komisyon görmeyen kullanıcıda da çalışır). Kapsam: kişisel/ofis. */
export const loadWonDealsThisMonth = cache(async (ctx: HomeCtx, personal: boolean): Promise<number | null> => {
  const supabase = await createClient();
  let q = ctx.sample.apply(supabase.from("deals").select("id", { count: "exact", head: true })).eq("stage", "won").gte("updated_at", ctx.monthStartIso);
  if (personal) q = q.eq("assigned_to", ctx.userId);
  const res = await q;
  return res.error ? null : (res.count ?? 0);
});

/* --------------------------- Dikkat gerektirenler: tek kayıt satırları --------------------------- */

type Rel<T> = T | T[] | null | undefined;
const first = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));
/** Kayıt sorgusu düşerse kategori satırı açıklamasıyla kalır (sayfa düşmez; async fonksiyon gerçek Promise döndürür). */
const safe = <T,>(f: () => Promise<T>): Promise<T | null> => f().catch(() => null);
const propName = (p: { title?: string | null; property_code?: string | null } | null) => p?.title?.trim() || p?.property_code?.trim() || null;
const DEMAND_KIND: Record<string, string> = { sale: "Satın alma talebi", rent: "Kiralama talebi" };
const DONE_APPT = new Set(["completed", "cancelled"]);

/**
 * "Dikkat gerektirenler" (v5): her kategoride EN ÖNCELİKLİ TEK GERÇEK KAYIT + kategori toplamı. Kategoriler ve sayılar
 * `loadAttention` ile AYNI (kahraman hapları, yan menü acil sayacı); yanına yönetimde portal teyidi bekleyen ilan, geri
 * dönüş bekleyen (24 saattir işlenmemiş yeni) talep ve bugünün sıradaki randevusu eklenir. Her kayıt sorgusu `limit 1`
 * (sayımlar mevcut yükleyicilerden; ek sayım yalnız talepte, `head` değil `count` ile aynı tur). Kapsam ana ekranla aynı
 * (`ctx.scopeMine`, örnek veri süzgeci, RLS). Kayıt okunamazsa kategori satırı açıklamasıyla kalır.
 */
export const loadAttentionRecords = cache(async (ctx: HomeCtx): Promise<AttentionRecord[]> => {
  const items = [...(await loadAttention(ctx).catch(() => [] as HomeAttentionItem[]))];
  // Muhasebe: geciken kira tahsilatı (yönetim kararlarında değil, kiralama tahakkukundan; Mülk yönetimi görebilene).
  if (ctx.role === "accounting" && ctx.canSeeRentals && !items.some((i) => i.id === "tahsilat")) {
    const r = await loadRentalsAndProjects(ctx).catch(() => null);
    const late = r ? r.rentCharges.filter((c) => c.status === "overdue").length : 0;
    if (late > 0) items.push({ id: "tahsilat", label: "Geciken kira tahsilatı", hint: "Vadesi geçmiş kira tahakkuku", href: "/app/kiralama?durum=overdue", level: "acil", count: late, brief: `${late} geciken kira tahsilatı` });
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const supabase = await createClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const can = (m: keyof HomeCtx["perms"]) => (ctx.perms[m] ?? []).includes("view");
  const base = (i: HomeAttentionItem): AttentionRecord => ({ key: i.id, level: i.level, title: i.label, detail: i.hint, at: null, ageKind: "none", href: i.href, total: i.count ?? null });

  const rent = byId.has("tahsilat")
    ? safe(async () => {
        const res = await supabase
          .from("rent_charges")
          .select("id, period, rental:rentals!rent_charges_rental_id_fkey(id, due_day, property:properties!rentals_property_id_fkey(title, property_code), renter:customers!rentals_renter_customer_id_fkey(full_name))")
          .eq("status", "overdue")
          .order("period", { ascending: true })
          .limit(1);
        type Raw = { period: string; rental: Rel<{ id: string; due_day: number | null; property: Rel<{ title: string | null; property_code: string | null }>; renter: Rel<{ full_name: string | null }> }> };
        const r = first((res.data ?? []) as unknown as Raw[]);
        const rental = first(r?.rental);
        if (res.error || !r || !rental) return null;
        return { detail: joinDetail(propName(first(rental.property)), first(rental.renter)?.full_name), at: rentDueIso(r.period, rental.due_day), href: `/app/kiralama/${rental.id}` };
      })
    : null;

  const task = byId.has("gorev")
    ? safe(async () => {
        let q = ctx.sample
          .apply(supabase.from("tasks").select("id, title, due_at, assignee:profiles!tasks_assigned_to_fkey(full_name)"))
          .eq("status", "open")
          // Sayımla AYNI eşik: "Benim işlerim" şu an (rozet tanımı), ofis geneli bugünün başı (`loadTaskSummary`).
          .lt("due_at", ctx.scopeMine ? nowIso : ctx.dayStartIso);
        if (ctx.scopeMine) q = q.eq("assigned_to", ctx.userId);
        const res = await q.order("due_at", { ascending: true }).limit(1);
        type Raw = { id: string; title: string | null; due_at: string | null; assignee: Rel<{ full_name: string | null }> };
        const t = first((res.data ?? []) as unknown as Raw[]);
        if (res.error || !t) return null;
        return { detail: joinDetail(t.title || "Görev", ctx.scopeMine ? null : first(t.assignee)?.full_name), at: t.due_at, href: taskHref(t.id) };
      })
    : null;

  const approval = byId.has("onay")
    ? safe(async () => {
        const a = await loadPendingApprovals(ctx);
        const r = a?.rows[0];
        if (!r) return null;
        return { detail: joinDetail(r.title, kindMeta(r.kind).label), at: r.createdAt, href: "/app/onaylar?kim=bana" };
      })
    : null;

  const deal = byId.has("riskli-anlasma")
    ? safe(async () => {
        const { clause } = await loadStaleDeals(ctx);
        if (!clause) return null;
        let q = ctx.sample
          .apply(supabase.from("deals").select("id, stage_changed_at, customer:customers!deals_customer_id_fkey(full_name), property:properties!deals_property_id_fkey(title, property_code)"))
          .or(clause);
        if (ctx.scopeMine) q = q.eq("assigned_to", ctx.userId);
        const res = await q.order("stage_changed_at", { ascending: true }).limit(1);
        type Raw = { id: string; stage_changed_at: string | null; customer: Rel<{ full_name: string | null }>; property: Rel<{ title: string | null; property_code: string | null }> };
        const d = first((res.data ?? []) as unknown as Raw[]);
        if (res.error || !d) return null;
        return { detail: joinDetail(propName(first(d.property)), first(d.customer)?.full_name), at: d.stage_changed_at, href: `/app/anlasmalar/${d.id}` };
      })
    : null;

  // Portal teyidi (yönetim): canlı ilanlardan (istek-içi önbellek, Ofis durumu ile aynı küme) en eski teyitli olan.
  const listing =
    ctx.isManagement && can("portals")
      ? safe(async (): Promise<AttentionRecord | null> => {
          const rows = await loadLiveListings(ctx);
          const overdue = rows.filter((r) => isConfirmationOverdue(r, nowMs));
          if (overdue.length === 0) return null;
          const pick = overdue.reduce((a, b) => ((confirmationBaseMs(a) ?? Infinity) <= (confirmationBaseMs(b) ?? Infinity) ? a : b));
          const baseMs = confirmationBaseMs(pick);
          const res = await supabase
            .from("portal_listings")
            .select("id, property:properties!portal_listings_property_id_fkey(id, title, property_code, district:geo_districts(name))")
            .eq("id", (pick as { id: string }).id)
            .limit(1);
          type Raw = { property: Rel<{ id: string; title: string | null; property_code: string | null; district: Rel<{ name: string | null }> }> };
          const p = first(first((res.data ?? []) as unknown as Raw[])?.property);
          const where = [first(p?.district)?.name, p?.title?.trim()].filter(Boolean).join(", ");
          return {
            key: "teyit",
            level: "yuksek",
            title: "Portal teyit bekleyen ilan",
            detail: p ? joinDetail(p.property_code ? `#${p.property_code}` : null, where) : "Yayındaki ilanın portal teyidi gecikti",
            // Yaş teyit süresinin dolduğu andan sayılır ("2 gün geçti" = süre 2 gün önce doldu).
            at: baseMs != null ? new Date(baseMs + LISTING_CONFIRM_STALE_DAYS * DAY_MS).toISOString() : null,
            ageKind: "elapsed",
            href: p && !res.error ? `/app/portfoyler/${p.id}` : "/app/ilan-kontrol",
            total: overdue.length,
          };
        })
      : null;

  // Geri dönüş bekleyen müşteri: 24 saattir "yeni" durumda kalan (henüz işlenmemiş) talep; en eskisi.
  const callback = can("demands")
    ? safe(async (): Promise<AttentionRecord | null> => {
        const cols = "id, created_at, transaction_type, customer:customers!customer_demands_customer_id_fkey(full_name)";
        let q = ctx.scopeMine
          ? ctx.sample
              .apply(supabase.from("customer_demands").select(`${cols}, owner:customers!customer_demands_customer_id_fkey!inner(assigned_to)`, { count: "exact" }))
              .eq("owner.assigned_to", ctx.userId)
          : ctx.sample.apply(supabase.from("customer_demands").select(cols, { count: "exact" }));
        q = q.eq("status", "new").lt("created_at", new Date(nowMs - DAY_MS).toISOString()).gte("created_at", daysAgoIso(90));
        const res = await q.order("created_at", { ascending: true }).limit(1);
        type Raw = { id: string; created_at: string; transaction_type: string | null; customer: Rel<{ full_name: string | null }> };
        const d = first((res.data ?? []) as unknown as Raw[]);
        if (res.error || !d) return null;
        return {
          key: "geri-donus",
          level: "yuksek",
          title: "Geri dönüş bekleyen müşteri",
          detail: joinDetail(first(d.customer)?.full_name, DEMAND_KIND[d.transaction_type ?? ""] ?? "Talep"),
          at: d.created_at,
          ageKind: "elapsed",
          href: `/app/talepler/${d.id}`,
          total: res.count ?? null,
        };
      })
    : null;

  // Bugünün sıradaki randevusu (istek-içi önbellek; program kartıyla aynı küme).
  const appt = can("appointments")
    ? safe(async (): Promise<AttentionRecord | null> => {
        const { rows } = await loadTodayAppointments(ctx);
        const upcoming = rows.filter((a) => !DONE_APPT.has(a.status ?? "") && Date.parse(a.scheduled_at) >= nowMs);
        const a = upcoming[0];
        if (!a) return null;
        return {
          key: "randevu",
          level: "orta",
          title: "Bugünkü randevu hatırlatması",
          detail: joinDetail(first(a.customer)?.full_name || "Müşteri seçilmedi", appointmentTypeLabel(a.appointment_type) || "Randevu"),
          at: a.scheduled_at,
          ageKind: "slot",
          href: appointmentHref(a.id),
          total: upcoming.length,
        };
      })
    : null;

  const [rentR, taskR, apprR, dealR, listingR, callbackR, apptR] = await Promise.all([rent, task, approval, deal, listing, callback, appt]);
  const found: Record<string, { detail: string | null; at: string | null; href: string } | null> = { tahsilat: rentR, gorev: taskR, onay: apprR, "riskli-anlasma": dealR };
  const out: AttentionRecord[] = items.map((i) => {
    const f = found[i.id];
    return f ? { ...base(i), detail: f.detail ?? i.hint, at: f.at, ageKind: f.at ? "elapsed" : "none", href: f.href } : base(i);
  });
  for (const extra of [listingR, callbackR, apptR]) if (extra) out.push(extra);
  return out;
});
