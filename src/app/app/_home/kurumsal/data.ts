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
import { DAY_MS, daysAgoIso, now, trDayKey, trParts, TR_OFFSET_MS } from "@/lib/clock";
import { propertyThumbUrl } from "@/lib/property-media-thumb";
import { loadCommissionSummary, loadLiveListings, loadTaskSummary, loadTodayAppointments, loadDemandCounts, type HomeCtx } from "../data";
import { getRequestIdentity } from "@/lib/cache/request";
import { getCatalogForPlan } from "@/lib/billing/plan-definitions";
import { resolvePlanDef } from "@/lib/billing/plans";
import { confirmationHealth } from "@/lib/listing-confirmation";
import { getOfficeSize } from "@/lib/ui-prefs-server";
import { weekBuckets } from "../helpers";
import { CLOSED_DEAL_STAGES, postgrestInList } from "@/lib/workflow-state";
import {
  SPARK_WEEKS,
  activityStatus,
  listingBadge,
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
  healthPct: number | null;
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
  const [listings, appts, demands, size, tasks, seatLimit] = await Promise.all([
    (ctx.perms.portals ?? []).includes("view") ? loadLiveListings(ctx).catch(() => null) : Promise.resolve(null),
    (ctx.perms.appointments ?? []).includes("view") ? loadTodayAppointments(ctx).catch(() => null) : Promise.resolve(null),
    (ctx.perms.customers ?? []).includes("view") ? loadDemandCounts(ctx).catch(() => null) : Promise.resolve(null),
    ctx.isManagement && ctx.tenantId ? getOfficeSize(ctx.tenantId) : Promise.resolve(null),
    (ctx.perms.tasks ?? []).includes("view") ? loadTaskSummary(ctx).catch(() => null) : Promise.resolve(null),
    ctx.isManagement ? loadSeatLimit(ctx).catch(() => null) : Promise.resolve(null),
  ]);
  // Teyit sağlığı tek tanım (`@/lib/listing-confirmation`): damgasız ilan yayın anından yaşlanır; ilan yoksa sağlık yok.
  const health = listings ? confirmationHealth(listings, now()) : null;
  return {
    liveListings: health ? health.total : null,
    overdueListings: health?.overdue ?? 0,
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

export type TeamTodayPerson = { id: string; name: string; avatarUrl: string | null; avatarPreset: string | null; status: string; at: string; href: string };

/**
 * Bugün sistemde iş yapan ekip üyeleri (yönetim): bugünkü denetim kayıtlarından (audit_logs, kiracı RLS'i) kişi başına SON
 * kayıt → kısa faaliyet adı (`activityStatus`). "Çevrimiçi" iddiası yok: yalnız bugün kayıt bırakanlar sayılır. Avatar
 * ofis kontrolünde o kişinin bugünkü akışını açar. Okunamazsa null (kart boş durumda kalır, sahte kişi yok).
 */
export const loadTeamToday = cache(async (ctx: HomeCtx): Promise<{ people: TeamTodayPerson[]; total: number } | null> => {
  if (!ctx.isManagement || !ctx.tenantId) return null;
  const supabase = await createClient();
  const logs = await supabase
    .from("audit_logs")
    .select("actor_id, action, entity_type, created_at")
    .eq("tenant_id", ctx.tenantId)
    .not("actor_id", "is", null)
    .gte("created_at", ctx.dayStartIso)
    .order("created_at", { ascending: false })
    .limit(400);
  if (logs.error) return null;
  const latest = new Map<string, { action: string | null; entity_type: string | null; created_at: string }>();
  for (const r of (logs.data ?? []) as { actor_id: string; action: string | null; entity_type: string | null; created_at: string }[]) {
    if (!latest.has(r.actor_id)) latest.set(r.actor_id, r);
  }
  const ids = [...latest.keys()];
  if (ids.length === 0) return { people: [], total: 0 };
  const prof = await supabase.from("profiles").select("id, full_name, avatar_url, avatar_preset").in("id", ids.slice(0, 60));
  if (prof.error) return null;
  const byId = new Map(((prof.data ?? []) as { id: string; full_name: string | null; avatar_url: string | null; avatar_preset: string | null }[]).map((p) => [p.id, p]));
  const today = trDayKey(now());
  const people = ids.flatMap((id) => {
    const p = byId.get(id);
    const l = latest.get(id)!;
    // Ofis dışı (platform personeli vb.) kayıtlar: profili bu ofiste yoksa listelenmez.
    if (!p) return [];
    return [{
      id,
      name: p.full_name?.trim() || "Adsız kullanıcı",
      avatarUrl: p.avatar_url,
      avatarPreset: p.avatar_preset,
      status: activityStatus(l.action, l.entity_type),
      at: l.created_at,
      href: `/app/ofis-kontrol?aktor=${id}&from=${today}&to=${today}`,
    }];
  });
  return { people, total: people.length };
});
