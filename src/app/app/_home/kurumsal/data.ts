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
import { OPEN_LISTING_STATUSES } from "@/lib/office-center/store";
import { loadCommissionSummary, loadLiveListings, loadTodayAppointments, loadDemandCounts, type HomeCtx } from "../data";
import { confirmationHealth } from "@/lib/listing-confirmation";
import { getOfficeSize } from "@/lib/ui-prefs-server";
import {
  dailyBuckets,
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

export type KpiData = {
  revenue: { thisMonth: number; prevMonth: number; monthly: number[] } | null;
  properties: { active: number; newThisMonth: number; newPrevMonth: number; weekly: number[] } | null;
  customers: { active: number; thisMonth: number; prevMonth: number; weekly: number[] } | null;
  appointments: { today: number; done: number; daily: number[] } | null;
};

export const loadKpiData = cache(async (ctx: HomeCtx): Promise<KpiData> => {
  const supabase = await createClient();
  const p = trParts(now());
  const monthStart = trMidnightIso(p.year, p.month, 1);
  const prevMonthStart = trMidnightIso(p.year, p.month - 1, 1);
  // Adil karşılaştırma: bu ayın ilk N günü ↔ geçen ayın ilk N günü (satış performansıyla aynı kural, `salesWindow`).
  // Eskiden ay ortasında "bu ay (yarım)" ile "geçen ay (tam)" kıyaslanıyordu.
  const prevMonthSameDay = new Date(Math.min(Date.parse(monthStart), Date.parse(prevMonthStart) + (now() - Date.parse(monthStart)))).toISOString();
  // Kapsam süzgeci (danışman / "Benim işlerim"): tip derinliği için gevşek imza (PostgREST zinciri aynı kalır).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mine = <Q,>(q: Q): Q => (ctx.scopeMine ? (q as any).eq("assigned_to", ctx.userId) : q);
  const can = (m: keyof HomeCtx["perms"]) => (ctx.perms[m] ?? []).includes("view");

  // "Aktif portföy" ve "bu ay yeni" AYNI küme (açık ilan durumları): eskiden yeni sayımı satılmış/kapanmış kayıtları da
  // içerdiği için "Aktif portföy 50 · Bu ay 64 yeni" gibi çelişki çıkıyordu.
  const props = () => mine(ctx.sample.apply(supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null))).in("status", [...OPEN_LISTING_STATUSES]);
  // "Aktif müşteri": silinmemiş ve kara listede olmayan müşteri; "bu ay yeni" aynı kümede oluşturma anına göre.
  const custs = () => mine(ctx.sample.apply(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null))).eq("blacklist", false);
  const appts = () => mine(ctx.sample.apply(supabase.from("appointments").select("id", { count: "exact", head: true }).neq("status", "cancelled")));
  const since49 = daysAgoIso(49);
  const since7 = trMidnightIso(p.year, p.month, p.day - 6);

  const [revenue, propRes, custRes, apptRes] = await Promise.all([
    ctx.canSeeCommissions
      ? loadCommissionSummary(ctx)
          .then((c) => ({ thisMonth: c.monthTotals.at(-1) ?? 0, prevMonth: c.monthTotals.at(-2) ?? 0, monthly: [...c.monthTotals] }))
          .catch(() => null)
      : Promise.resolve(null),
    can("properties")
      ? Promise.all([
          props(),
          props().gte("created_at", monthStart),
          props().gte("created_at", prevMonthStart).lt("created_at", prevMonthSameDay),
          mine(ctx.sample.apply(supabase.from("properties").select("created_at").is("deleted_at", null))).gte("created_at", since49).order("created_at", { ascending: false }).limit(400),
        ])
      : Promise.resolve(null),
    can("customers")
      ? Promise.all([
          custs(),
          custs().gte("created_at", monthStart),
          custs().gte("created_at", prevMonthStart).lt("created_at", prevMonthSameDay),
          mine(ctx.sample.apply(supabase.from("customers").select("created_at").is("deleted_at", null))).gte("created_at", since49).order("created_at", { ascending: false }).limit(400),
        ])
      : Promise.resolve(null),
    can("appointments")
      ? Promise.all([
          appts().gte("scheduled_at", ctx.dayStartIso).lt("scheduled_at", ctx.dayEndIso),
          appts().gte("scheduled_at", ctx.dayStartIso).lt("scheduled_at", ctx.dayEndIso).eq("status", "completed"),
          mine(ctx.sample.apply(supabase.from("appointments").select("scheduled_at").neq("status", "cancelled"))).gte("scheduled_at", since7).lt("scheduled_at", ctx.dayEndIso).limit(500),
        ])
      : Promise.resolve(null),
  ]);
  const nowMs = now();
  const weekly = (dates: (string | null)[]) => {
    const buckets = Array.from({ length: 7 }, () => 0);
    for (const iso of dates) {
      if (!iso) continue;
      const idx = 6 - Math.floor((nowMs - Date.parse(iso)) / (7 * DAY_MS));
      if (idx >= 0 && idx < 7) buckets[idx]! += 1;
    }
    return buckets;
  };
  const ok = (rs: readonly { error: unknown }[] | null) => Boolean(rs && rs.every((r) => !r.error));
  return {
    revenue,
    properties: ok(propRes)
      ? {
          active: propRes![0].count ?? 0,
          newThisMonth: propRes![1].count ?? 0,
          newPrevMonth: propRes![2].count ?? 0,
          weekly: weekly(((propRes![3].data ?? []) as { created_at: string | null }[]).map((r) => r.created_at)),
        }
      : null,
    customers: ok(custRes)
      ? {
          active: custRes![0].count ?? 0,
          thisMonth: custRes![1].count ?? 0,
          prevMonth: custRes![2].count ?? 0,
          weekly: weekly(((custRes![3].data ?? []) as { created_at: string | null }[]).map((r) => r.created_at)),
        }
      : null,
    appointments: ok(apptRes)
      ? {
          today: apptRes![0].count ?? 0,
          done: apptRes![1].count ?? 0,
          daily: dailyBuckets(((apptRes![2].data ?? []) as { scheduled_at: string | null }[]).map((r) => r.scheduled_at), new Date(since7).getTime(), 7),
        }
      : null,
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
export const loadHeroPhoto = cache(async (ctx: HomeCtx): Promise<{ src: string; title: string; href: string } | null> => {
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
  return { src: propertyThumbUrl(cover.id, cover, "genis"), title: pick.title?.trim() || pick.property_code || "Portföy", href: `/app/portfoyler/${pick.id}` };
});

export type OfficeStatus = {
  liveListings: number | null;
  overdueListings: number;
  healthPct: number | null;
  activeUsers: number | null;
  todayAppointments: number | null;
  newDemands: number | null;
};

/** "Ofis durumu" paneli + kahraman özet cümlesi: mevcut paylaşılan yükleyicilerden (ek tur yok, istek-içi önbellek). */
export const loadOfficeStatus = cache(async (ctx: HomeCtx): Promise<OfficeStatus> => {
  const [listings, appts, demands, size] = await Promise.all([
    (ctx.perms.portals ?? []).includes("view") ? loadLiveListings(ctx).catch(() => null) : Promise.resolve(null),
    (ctx.perms.appointments ?? []).includes("view") ? loadTodayAppointments(ctx).catch(() => null) : Promise.resolve(null),
    (ctx.perms.customers ?? []).includes("view") ? loadDemandCounts(ctx).catch(() => null) : Promise.resolve(null),
    ctx.isManagement && ctx.tenantId ? getOfficeSize(ctx.tenantId) : Promise.resolve(null),
  ]);
  // Teyit sağlığı tek tanım (`@/lib/listing-confirmation`): damgasız ilan yayın anından yaşlanır; ilan yoksa sağlık yok.
  const health = listings ? confirmationHealth(listings, now()) : null;
  return {
    liveListings: health ? health.total : null,
    overdueListings: health?.overdue ?? 0,
    healthPct: health?.pct ?? null,
    activeUsers: size?.seats ?? null,
    todayAppointments: appts ? appts.total : null,
    newDemands: demands ? demands.new : null,
  };
});
