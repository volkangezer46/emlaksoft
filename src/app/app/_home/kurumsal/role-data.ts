/**
 * ROL BAZLI ANA EKRAN VERİSİ (sahip kararı 2026-10-17: "her rolün kendi KPI seti"). Hangi rolün hangi kartı göreceği SAF
 * `roleHomePlan` (core.ts) kararıdır; burası yalnız seçilen kartların değerini gerçek kaynaktan okur. Kural ana ekranla
 * aynı: kapsam `ctx.scopeMine`, örnek veri süzgeci `ctx.sample.apply`, RLS; okunamayan kart null (çizilmez, sahte 0 yok).
 * Sorgular `head` sayımları ve `limit 1` kayıtlardır; ortak sayılar mevcut istek-içi önbellekli yükleyicilerden gelir.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DAY_MS, daysAgoIso, formatTrTime, now, trDayKey, trParts, TR_OFFSET_MS } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { earningsPath, financeHref, financePath } from "@/lib/finance/routes";
import { currentMonthPeriod, loadAdvisorResponseTimes } from "@/lib/team/advisor-metrics";
import { appointmentHref } from "@/lib/notification-text";
import { CLOSED_DEAL_STAGES, postgrestInList } from "@/lib/workflow-state";
import {
  loadKpiCounts,
  loadMoneySummary,
  loadMyTarget,
  loadOverdueReceivables,
  loadRentalsAndProjects,
  loadTaskSummary,
  loadTodayAppointments,
  loadUnassignedListings,
  type HomeCtx,
} from "../data";
import { loadKpiData, loadOfficeStatus, loadWonDealsThisMonth } from "./data";
import { deltaOf, joinDetail, type AttentionRecord, type Delta, type RoleKpiKey } from "./core";

const n = (v: number) => v.toLocaleString("tr-TR");
const trMidnightIso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - TR_OFFSET_MS).toISOString();
type Counted = { count: number | null; error: unknown };
/** PostgREST kurucusu thenable'dır (`.catch` yok): her zaman `Promise.resolve` ile sarılır (builder-catch sözleşmesi). */
const head = (q: unknown): Promise<number | null> =>
  Promise.resolve(q as PromiseLike<Counted>)
    .then((r) => (r.error ? null : (r.count ?? 0)))
    .catch(() => null);

export type KpiTone = "gold" | "brand" | "violet" | "mint" | "rose" | "cyan" | "pink" | "orange" | "amber" | "slate" | "sky";

/** Bir KPI kartının görünümü (blocks.tsx `KpiCard`'a çevirir). Değer tam metindir (₺ tam TL; kısaltma yok). */
export type KpiCardSpec = {
  key: RoleKpiKey;
  title: string;
  value: string;
  href: string;
  tone: KpiTone;
  delta?: Delta;
  deltaContext?: string;
  caption?: string;
  spark?: { values: number[]; label: string };
  reportHref?: string;
};

/* ------------------------------ Takım kapsamı ------------------------------ */

export type TeamScope = { ids: string[]; personal: boolean; members: { id: string; name: string; avatarUrl: string | null; avatarPreset: string | null }[] };

/**
 * Takım liderinin takımı: kendi profilindeki `team_id` → aynı takımdaki aktif üyeler (liste kapsamıyla aynı tanım,
 * `@/lib/access-control/list-scope`). Takımı yoksa ya da kolon okunamazsa KENDİ kapsamı (fail-closed; kart başlığı
 * kişisel olur, "ekip" iddiası yok).
 */
export const loadTeamScope = cache(async (ctx: HomeCtx): Promise<TeamScope> => {
  const self: TeamScope = { ids: [ctx.userId], personal: true, members: [] };
  if (!ctx.tenantId) return self;
  const supabase = await createClient();
  const me = await supabase.from("profiles").select("team_id").eq("id", ctx.userId).maybeSingle();
  const teamId = (me.data as { team_id?: string | null } | null)?.team_id;
  if (me.error || !teamId) return self;
  const res = await supabase.from("profiles").select("id, full_name, avatar_url, avatar_preset").eq("tenant_id", ctx.tenantId).eq("team_id", teamId).eq("is_active", true).limit(100);
  if (res.error) return self;
  const members = ((res.data ?? []) as { id: string; full_name: string | null; avatar_url: string | null; avatar_preset: string | null }[]).map((p) => ({
    id: p.id,
    name: p.full_name?.trim() || "Adsız kullanıcı",
    avatarUrl: p.avatar_url,
    avatarPreset: p.avatar_preset,
  }));
  const ids = [...new Set([ctx.userId, ...members.map((m) => m.id)])];
  return { ids, personal: ids.length <= 1, members };
});

/** Takımın bugünkü randevusu ve geciken görevi (KPI + kahraman cümlesi aynı sayıyı kullanır; istek-içi tek tur). */
export const loadTeamDayCounts = cache(async (ctx: HomeCtx): Promise<{ appointments: number | null; overdue: number | null; personal: boolean }> => {
  const team = await loadTeamScope(ctx);
  const supabase = await createClient();
  const [appointments, overdue] = await Promise.all([
    head(ctx.sample.apply(supabase.from("appointments").select("id", { count: "exact", head: true })).gte("scheduled_at", ctx.dayStartIso).lt("scheduled_at", ctx.dayEndIso).in("assigned_to", team.ids)),
    head(ctx.sample.apply(supabase.from("tasks").select("id", { count: "exact", head: true })).eq("status", "open").lt("due_at", ctx.dayStartIso).in("assigned_to", team.ids)),
  ]);
  return { appointments, overdue, personal: team.personal };
});

/** Bugünkü cevapsız arama (calls.direction = missed; kapsamda `handled_by = ben`). */
export const loadMissedCallsToday = cache(async (ctx: HomeCtx): Promise<number | null> => {
  if (!(ctx.perms.calls ?? []).includes("view")) return null;
  const supabase = await createClient();
  let q = ctx.sample.apply(supabase.from("calls").select("id", { count: "exact", head: true })).eq("direction", "missed").gte("started_at", ctx.dayStartIso);
  if (ctx.scopeMine) q = q.eq("handled_by", ctx.userId);
  return head(q);
});

/* ------------------------------ KPI kartları ------------------------------ */

/** Ayın ilk N günü ↔ geçen ayın ilk N günü (KPI satırıyla aynı adil karşılaştırma). */
function monthWindows(nowMs: number) {
  const p = trParts(nowMs);
  const monthStart = trMidnightIso(p.year, p.month, 1);
  const prevStart = trMidnightIso(p.year, p.month - 1, 1);
  const prevSameDay = new Date(Math.min(Date.parse(monthStart), Date.parse(prevStart) + (nowMs - Date.parse(monthStart)))).toISOString();
  return { monthStart, prevStart, prevSameDay };
}

/**
 * Seçilen KPI anahtarlarının kartları (sıra korunur; okunamayan null). Kaynaklar:
 *  - ciro / kazancim / bu-ay-komisyon: `loadCommissionSummary` (KPI satırı; kazanç gizliliği kuralıyla)
 *  - aktif-anlasma(m) · yeni-talep · yeni-musteri · gelen-arama: `loadKpiData` (head sayımları + 12 haftalık kovalar)
 *  - hedefime-kalan: `loadMyTarget` (targets) − bu ayın komisyonu (yoksa kapanış hedefi − kazanılan anlaşma)
 *  - bugunku-randevu(m): `loadTodayAppointments` · geciken-gorev: `loadTaskSummary` · teyit-bekleyen: `loadOfficeStatus`
 *  - atanmamis-portfoy: `loadUnassignedListings` · musterilerim: customers head (assigned_to = ben)
 *  - ekip-*: takım üyelerinin (`loadTeamScope`) head sayımları
 *  - muhasebe: `loadMoneySummary` (finance_overview RPC; finans genel bakışla aynı)
 *  - çağrı: `loadKpiCounts` (bugün/dün gelen arama), calls direction=missed (bugün), `loadAdvisorResponseTimes`,
 *    customers/appointments `created_by = ben` (bugün)
 */
export async function loadRoleKpis(ctx: HomeCtx, keys: readonly RoleKpiKey[]): Promise<(KpiCardSpec | null)[]> {
  return Promise.all(keys.map((k) => buildKpi(ctx, k).catch(() => null)));
}

async function buildKpi(ctx: HomeCtx, key: RoleKpiKey): Promise<KpiCardSpec | null> {
  const nowMs = now();
  const mine = ctx.scopeMine;
  const today = trDayKey(nowMs);
  const weeks = "Son 12 hafta";
  switch (key) {
    case "ciro":
    case "kazancim":
    case "bu-ay-komisyon": {
      const k = await loadKpiData(ctx);
      if (!k.revenue) return null;
      const title = key === "kazancim" ? "Bu ay kazancım" : key === "bu-ay-komisyon" ? "Bu ay komisyon" : "Bu ay ciro";
      return {
        key,
        title,
        value: moneyTry(k.revenue.thisMonth),
        href: key === "kazancim" ? earningsPath() : financePath("komisyon"),
        tone: "gold",
        delta: deltaOf(k.revenue.thisMonth, k.revenue.prevMonth),
        spark: { values: k.revenue.monthly, label: "Son 6 ay aylık komisyon" },
        reportHref: financePath("raporlar"),
      };
    }
    case "aktif-anlasma":
    case "aktif-anlasmam": {
      const k = await loadKpiData(ctx);
      if (!k.deals) return null;
      return {
        key,
        title: key === "aktif-anlasmam" ? "Aktif anlaşmalarım" : "Aktif anlaşma",
        value: n(k.deals.open),
        href: mine ? `/app/anlasmalar?danisman=${ctx.userId}` : "/app/anlasmalar",
        tone: "brand",
        delta: deltaOf(k.deals.thisMonth, k.deals.prevMonth),
        caption: k.deals.thisMonth > 0 ? `Bu ay ${n(k.deals.thisMonth)} yeni` : undefined,
        spark: { values: k.deals.weekly, label: `${weeks} açılan anlaşma` },
        reportHref: "/app/raporlar/huni",
      };
    }
    case "yeni-talep": {
      const k = await loadKpiData(ctx);
      if (!k.demands) return null;
      return {
        key,
        title: "Yeni talep",
        value: n(k.demands.thisMonth),
        href: `/app/talepler?eklenen=30${mine ? `&danisman=${ctx.userId}` : ""}`,
        tone: "pink",
        delta: deltaOf(k.demands.thisMonth, k.demands.prevMonth),
        deltaContext: "önceki 30 güne göre",
        caption: "Son 30 gün",
        spark: { values: k.demands.weekly, label: `${weeks} yeni talep` },
        reportHref: "/app/raporlar/talep-arz",
      };
    }
    case "yeni-musteri": {
      const k = await loadKpiData(ctx);
      if (!k.customers) return null;
      return {
        key,
        title: "Yeni müşteri",
        value: n(k.customers.thisMonth),
        href: `/app/musteriler?from=${ctx.monthStartKey}&to=${today}${mine ? `&assigned=${ctx.userId}` : ""}`,
        tone: "mint",
        delta: deltaOf(k.customers.thisMonth, k.customers.prevMonth),
        spark: { values: k.customers.weekly, label: `${weeks} yeni müşteri` },
        reportHref: "/app/raporlar/huni",
      };
    }
    case "gelen-arama": {
      const k = await loadKpiData(ctx);
      if (!k.calls) return null;
      return {
        key,
        title: "Gelen arama",
        value: n(k.calls.thisMonth),
        href: `/app/gelen-kutusu?sekme=cagri&yon=inbound&from=${ctx.monthStartKey}&to=${today}`,
        tone: "sky",
        delta: deltaOf(k.calls.thisMonth, k.calls.prevMonth),
        spark: { values: k.calls.weekly, label: `${weeks} gelen arama` },
        reportHref: "/app/raporlar",
      };
    }
    case "hedefime-kalan": {
      const [target, k, won] = await Promise.all([loadMyTarget(ctx).catch(() => null), loadKpiData(ctx), loadWonDealsThisMonth(ctx, true).catch(() => null)]);
      const tRev = Number(target?.target_revenue ?? 0);
      const tDeals = Number(target?.target_deals ?? 0);
      if (tRev > 0 && k.revenue) {
        const left = Math.max(0, tRev - k.revenue.thisMonth);
        const pct = Math.round((k.revenue.thisMonth / tRev) * 100);
        return { key, title: "Hedefime kalan", value: moneyTry(left), href: "/app/hedefler", tone: "violet", caption: left === 0 ? "Hedef aşıldı" : `Hedefin %${n(pct)} kadarı tamam` };
      }
      if (tDeals > 0 && won != null) {
        const left = Math.max(0, tDeals - won);
        return { key, title: "Hedefime kalan", value: `${n(left)} kapanış`, href: "/app/hedefler", tone: "violet", caption: `${n(won)} / ${n(tDeals)} kapanış` };
      }
      return { key, title: "Hedefim", value: "—", href: "/app/hedefler", tone: "violet", caption: "Bu ay hedef belirlenmedi" };
    }
    case "bugunku-randevu":
    case "bugunku-randevum": {
      const { rows, total } = await loadTodayAppointments(ctx);
      const next = rows.find((a) => a.status !== "completed" && a.status !== "cancelled" && Date.parse(a.scheduled_at) >= nowMs);
      return {
        key,
        title: key === "bugunku-randevum" ? "Bugünkü randevum" : "Bugünkü randevu",
        value: n(total),
        href: "/app/randevular?gorunum=rota&gun=bugun",
        tone: "amber",
        caption: next ? `Sıradaki ${formatTrTime(next.scheduled_at)}` : total > 0 ? "Kalan randevu yok" : "Program boş",
      };
    }
    case "geciken-gorev": {
      const t = await loadTaskSummary(ctx);
      return {
        key,
        title: mine ? "Geciken görevim" : "Geciken görev",
        value: n(t.overdue),
        href: `/app/gorevler?filter=overdue${mine ? "&mine=1" : ""}`,
        tone: t.overdue > 0 ? "rose" : "mint",
        caption: `Bugün ${n(t.dueToday)} görev`,
      };
    }
    case "teyit-bekleyen": {
      const s = await loadOfficeStatus(ctx);
      if (s.liveListings == null) return null;
      return { key, title: "Teyit bekleyen ilan", value: n(s.overdueListings), href: "/app/ilan-kontrol", tone: "orange", caption: `${n(s.liveListings)} ilan yayında` };
    }
    case "atanmamis-portfoy": {
      const u = await loadUnassignedListings(ctx);
      if (!u || u.count == null) return null;
      return { key, title: "Atanmamış portföy", value: n(u.count), href: "/app/ilan-havuzu", tone: "cyan", caption: u.poolEnabled ? "Danışmana dağıtın" : "Dağıtım kapalı" };
    }
    case "musterilerim": {
      // F3: toplam ve "Bu ay N yeni" AYNI kapsamlı kümeden (loadKpiData → home_kpi_snapshot; danışmanda assigned_to = ben).
      // Eskiden toplam ayrı bir sorgudan, açıklama ise kapsamı farklı olabilen KPI kümesinden geliyordu (26 ↔ 33).
      const k = await loadKpiData(ctx);
      const c = k.customers;
      if (!c || c.total == null) return null;
      return {
        key,
        title: mine ? "Müşterilerim" : "Müşteriler",
        value: n(c.total),
        href: mine ? `/app/musteriler?assigned=${ctx.userId}` : "/app/musteriler",
        tone: "mint",
        caption: c.thisMonth > 0 ? `Bu ay ${n(c.thisMonth)} yeni` : undefined,
        spark: { values: c.weekly, label: `${weeks} yeni müşteri` },
      };
    }
    case "ekip-kapanis":
    case "ekip-anlasma":
    case "ekip-geciken-gorev":
    case "ekip-randevu":
    case "ekip-yeni-musteri":
      return buildTeamKpi(ctx, key, nowMs);
    case "kasa-banka":
    case "bu-ay-net":
    case "vadesi-gecen":
    case "bu-ay-gider":
    case "incelenecek": {
      const m = await loadMoneySummary(ctx);
      if (m.cash === null) return null;
      const month = { from: m.monthFrom, to: m.today };
      if (key === "kasa-banka") return { key, title: "Kasa ve banka", value: moneyTry(m.cash), href: financeHref("kasa-banka"), tone: "gold", caption: "Tüm hesapların toplamı" };
      if (key === "bu-ay-net") {
        const net = (m.monthIn ?? 0) - (m.monthOut ?? 0);
        return { key, title: "Bu ay net", value: `${net < 0 ? "−" : ""}${moneyTry(Math.abs(net))}`, href: financeHref("hareketler", month), tone: net >= 0 ? "brand" : "rose", caption: `Giriş ${moneyTry(m.monthIn ?? 0)}` };
      }
      if (key === "vadesi-gecen")
        return { key, title: "Vadesi geçen alacak", value: n(m.overdueCount ?? 0), href: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }), tone: (m.overdueCount ?? 0) > 0 ? "rose" : "mint", caption: (m.overdueCount ?? 0) > 0 ? "Açık kalem" : "Gecikme yok" };
      if (key === "bu-ay-gider") return { key, title: "Bu ay gider", value: moneyTry(m.monthOut ?? 0), href: financeHref("hareketler", { ...month, tur: "gider" }), tone: "orange", caption: "Gider ve ödemeler" };
      return { key, title: "İncelenecek kayıt", value: n(m.reviewCount ?? 0), href: financeHref("kasa-banka"), tone: "violet", caption: (m.reviewCount ?? 0) > 0 ? "Ekstre ve fiş" : "Hepsi işlendi" };
    }
    case "bugun-gelen-arama": {
      const k = await loadKpiCounts(ctx);
      return {
        key,
        title: "Bugün gelen arama",
        value: n(k.callsToday),
        href: `/app/gelen-kutusu?sekme=cagri&yon=inbound&from=${today}&to=${today}`,
        tone: "sky",
        delta: deltaOf(k.callsToday, k.callsYesterday),
        deltaContext: "düne göre",
        caption: `Dün ${n(k.callsYesterday)}`,
      };
    }
    case "cevapsiz-arama": {
      const c = await loadMissedCallsToday(ctx);
      if (c == null) return null;
      return { key, title: "Cevapsız arama", value: n(c), href: `/app/gelen-kutusu?sekme=cagri&yon=missed&from=${today}&to=${today}`, tone: c > 0 ? "rose" : "mint", caption: "Bugün" };
    }
    case "yanit-suresi": {
      const supabase = await createClient();
      const res = await loadAdvisorResponseTimes(supabase, { viewer: { userId: ctx.userId, role: ctx.role, perms: ctx.perms }, tenantId: ctx.tenantId, period: currentMonthPeriod(nowMs), nowMs });
      const m = res.failed ? undefined : res.byAdvisor.get(ctx.userId);
      if (!m || m.avgFirstResponseMin == null) return { key, title: "Ort. ilk yanıt", value: "—", href: "/app/gelen-kutusu", tone: "violet", caption: "Bu ay yanıt kaydı yok" };
      return { key, title: "Ort. ilk yanıt", value: `${n(Math.round(m.avgFirstResponseMin))} dk`, href: "/app/gelen-kutusu", tone: m.withinSlaPct != null && m.withinSlaPct < 70 ? "orange" : "violet", caption: `${n(m.respondedCount)} yanıt · bu ay` };
    }
    case "bugun-yeni-musteri": {
      const supabase = await createClient();
      const c = await head(ctx.sample.apply(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null)).eq("created_by", ctx.userId).gte("created_at", ctx.dayStartIso));
      if (c == null) return null;
      return { key, title: "Bugün açtığım müşteri", value: n(c), href: `/app/musteriler?from=${today}&to=${today}`, tone: "mint", caption: "Kaydı siz açtınız" };
    }
    case "bugun-randevu": {
      const supabase = await createClient();
      const c = await head(ctx.sample.apply(supabase.from("appointments").select("id", { count: "exact", head: true })).eq("created_by", ctx.userId).gte("created_at", ctx.dayStartIso));
      if (c == null) return null;
      return { key, title: "Randevuya dönüşen", value: n(c), href: "/app/randevular", tone: "amber", caption: "Bugün oluşturduğunuz" };
    }
  }
}

async function buildTeamKpi(ctx: HomeCtx, key: RoleKpiKey, nowMs: number): Promise<KpiCardSpec | null> {
  const team = await loadTeamScope(ctx);
  const supabase = await createClient();
  const ids = team.ids;
  const p = team.personal;
  const w = monthWindows(nowMs);
  const today = trDayKey(nowMs);
  switch (key) {
    case "ekip-kapanis": {
      const won = () => ctx.sample.apply(supabase.from("deals").select("id", { count: "exact", head: true })).eq("stage", "won").in("assigned_to", ids);
      const [cur, prev] = await Promise.all([head(won().gte("updated_at", w.monthStart)), head(won().gte("updated_at", w.prevStart).lt("updated_at", w.prevSameDay))]);
      if (cur == null) return null;
      return { key, title: p ? "Bu ay kapanışım" : "Ekip kapanışı", value: n(cur), href: "/app/anlasmalar?asama=won", tone: "gold", delta: prev == null ? undefined : deltaOf(cur, prev), caption: "Bu ay kazanılan" };
    }
    case "ekip-anlasma": {
      const c = await head(ctx.sample.apply(supabase.from("deals").select("id", { count: "exact", head: true })).not("stage", "in", postgrestInList(CLOSED_DEAL_STAGES)).in("assigned_to", ids));
      if (c == null) return null;
      return { key, title: p ? "Aktif anlaşmalarım" : "Ekip aktif anlaşma", value: n(c), href: "/app/anlasmalar", tone: "brand", caption: p ? undefined : `${n(ids.length)} kişilik ekip` };
    }
    case "ekip-geciken-gorev": {
      const c = (await loadTeamDayCounts(ctx)).overdue;
      if (c == null) return null;
      return { key, title: p ? "Geciken görevim" : "Ekip geciken görev", value: n(c), href: "/app/gorevler?filter=overdue", tone: c > 0 ? "rose" : "mint", caption: c > 0 ? "Vadesi geçmiş" : "Gecikme yok" };
    }
    case "ekip-randevu": {
      const c = (await loadTeamDayCounts(ctx)).appointments;
      if (c == null) return null;
      return { key, title: p ? "Bugünkü randevum" : "Ekip bugün randevu", value: n(c), href: "/app/randevular?gorunum=rota&gun=bugun", tone: "amber" };
    }
    case "ekip-yeni-musteri": {
      const cust = () => ctx.sample.apply(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null)).in("assigned_to", ids);
      const [cur, prev] = await Promise.all([head(cust().gte("created_at", w.monthStart)), head(cust().gte("created_at", w.prevStart).lt("created_at", w.prevSameDay))]);
      if (cur == null) return null;
      return { key, title: p ? "Yeni müşterim" : "Ekip yeni müşteri", value: n(cur), href: `/app/musteriler?from=${ctx.monthStartKey}&to=${today}`, tone: "mint", delta: prev == null ? undefined : deltaOf(cur, prev), caption: "Bu ay" };
    }
    default:
      return null;
  }
}

/* ------------------------------ Paneller ------------------------------ */

export type PanelTileData = {
  key: string;
  label: string;
  value: string;
  unit?: string;
  chip?: { text: string; tone: "neutral" | "success" | "danger" | "warn"; dot?: boolean } | null;
  href: string;
  title?: string;
};

/** "Geri dönüş bekleyen": 24 saattir "yeni" durumda kalan talepler (son 90 gün; kapsam ana ekranla aynı). */
export const loadCallbackCount = cache(async (ctx: HomeCtx): Promise<number | null> => {
  if (!(ctx.perms.demands ?? []).includes("view")) return null;
  const supabase = await createClient();
  const q = ctx.scopeMine
    ? ctx.sample
        .apply(supabase.from("customer_demands").select("id, owner:customers!customer_demands_customer_id_fkey!inner(assigned_to)", { count: "exact", head: true }))
        .eq("owner.assigned_to", ctx.userId)
    : ctx.sample.apply(supabase.from("customer_demands").select("id", { count: "exact", head: true }));
  return head(q.eq("status", "new").lt("created_at", new Date(now() - DAY_MS).toISOString()).gte("created_at", daysAgoIso(90)));
});

/**
 * BENİM GÜNÜM (danışman / yönetimde "Benim işlerim"): sıradaki randevum (saat + müşteri) · bugünkü görevim (gecikmiş) ·
 * geri dönüş bekleyen müşterim · portföyüm (bana atanmış açık portföy). Ofis düzeyi sayı yok.
 */
export async function loadMyDayTiles(ctx: HomeCtx): Promise<PanelTileData[]> {
  const can = (m: keyof HomeCtx["perms"]) => (ctx.perms[m] ?? []).includes("view");
  const supabase = await createClient();
  const nowMs = now();
  const [appts, tasks, callbacks, props] = await Promise.all([
    can("appointments") ? loadTodayAppointments(ctx).catch(() => null) : Promise.resolve(null),
    can("tasks") ? loadTaskSummary(ctx).catch(() => null) : Promise.resolve(null),
    loadCallbackCount(ctx).catch(() => null),
    ctx.canSeeProperties ? head(ctx.sample.apply(supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null)).eq("assigned_to", ctx.userId)) : Promise.resolve(null),
  ]);
  const tiles: PanelTileData[] = [];
  if (appts) {
    const next = appts.rows.find((a) => a.status !== "completed" && a.status !== "cancelled" && Date.parse(a.scheduled_at) >= nowMs);
    const cust = next ? (Array.isArray(next.customer) ? next.customer[0] : next.customer) : null;
    tiles.push({
      key: "siradaki",
      label: "Sıradaki randevum",
      value: next ? formatTrTime(next.scheduled_at) : "—",
      chip: next ? { text: cust?.full_name?.trim() || "Müşteri seçilmedi", tone: "neutral" } : { text: appts.total > 0 ? "Bugün kalan yok" : "Program boş", tone: "neutral" },
      href: next ? appointmentHref(next.id) : "/app/randevular?gorunum=rota&gun=bugun",
    });
  }
  if (tasks)
    tiles.push({
      key: "gorev",
      label: "Bugünkü görevim",
      value: n(tasks.dueToday),
      chip: tasks.overdue > 0 ? { text: `${n(tasks.overdue)} gecikmiş`, tone: "danger" } : { text: "Gecikme yok", tone: "success" },
      href: tasks.overdue > 0 ? "/app/gorevler?filter=overdue&mine=1" : "/app/gorevler?filter=today&mine=1",
    });
  if (callbacks != null)
    tiles.push({
      key: "geri-donus",
      label: "Geri dönüş bekleyen",
      value: n(callbacks),
      chip: callbacks > 0 ? { text: "24 saati geçti", tone: "warn" } : { text: "Hepsi işlendi", tone: "success" },
      href: "/app/talepler?status=new",
    });
  if (props != null) tiles.push({ key: "portfoy", label: "Portföyüm", value: n(props), chip: null, href: `/app/portfoyler?danisman=${ctx.userId}` });
  return tiles.slice(0, 4);
}

/**
 * EKİBİM BUGÜN (takım lideri): takım üyelerinin bugünkü durumu — kişi başına bugün bıraktığı kayıt sayısı (denetim
 * kaydı) ve son faaliyeti. Takım tanımlı değilse ya da denetim kaydı okunamazsa null (çağıran "Benim günüm"e düşer).
 */
export async function loadTeamPanelTiles(ctx: HomeCtx, activity: (action: string | null, entity: string | null) => string): Promise<PanelTileData[] | null> {
  const team = await loadTeamScope(ctx);
  if (team.personal || !ctx.tenantId) return null;
  const supabase = await createClient();
  const logs = await supabase
    .from("audit_logs")
    .select("actor_id, action, entity_type, created_at")
    .eq("tenant_id", ctx.tenantId)
    .in("actor_id", team.ids)
    .gte("created_at", ctx.dayStartIso)
    .order("created_at", { ascending: false })
    .limit(400);
  if (logs.error) return null;
  const per = new Map<string, { count: number; last: { action: string | null; entity_type: string | null } }>();
  for (const r of (logs.data ?? []) as { actor_id: string; action: string | null; entity_type: string | null }[]) {
    const cur = per.get(r.actor_id);
    if (cur) cur.count += 1;
    else per.set(r.actor_id, { count: 1, last: r });
  }
  const today = trDayKey(now());
  const others = team.members.filter((m) => m.id !== ctx.userId);
  return [...others]
    .sort((a, b) => (per.get(b.id)?.count ?? 0) - (per.get(a.id)?.count ?? 0))
    .slice(0, 4)
    .map((m) => {
      const s = per.get(m.id);
      return {
        key: m.id,
        label: m.name,
        value: n(s?.count ?? 0),
        unit: " kayıt",
        chip: s ? { text: activity(s.last.action, s.last.entity_type), tone: "success" as const, dot: true } : { text: "Bugün kayıt yok", tone: "neutral" as const },
        href: `/app/ofis-kontrol?aktor=${m.id}&from=${today}&to=${today}`,
      };
    });
}

/** FİNANS DURUMU (muhasebe): KPI'da olmayan finans sinyalleri — açık alacak · bu ay giriş · bu ay komisyon · geciken kira. */
export async function loadFinancePanelTiles(ctx: HomeCtx): Promise<PanelTileData[] | null> {
  const [m, rentals] = await Promise.all([loadMoneySummary(ctx).catch(() => null), ctx.canSeeRentals ? loadRentalsAndProjects(ctx).catch(() => null) : Promise.resolve(null)]);
  if (!m || m.cash === null) return null;
  const month = { from: m.monthFrom, to: m.today };
  const tiles: PanelTileData[] = [];
  if (m.receivable != null) tiles.push({ key: "alacak", label: "Açık alacak", value: moneyTry(m.receivable), href: financeHref("cari", { gorunum: "acik" }) });
  if (m.monthIn != null) tiles.push({ key: "giris", label: "Bu ay giriş", value: moneyTry(m.monthIn), href: financeHref("hareketler", { ...month, tur: "gelir" }) });
  if (m.commissionMonth != null) tiles.push({ key: "komisyon", label: "Bu ay komisyon", value: moneyTry(m.commissionMonth), href: financePath("komisyon") });
  if (rentals) {
    const late = rentals.rentCharges.filter((c) => c.status === "overdue");
    tiles.push({
      key: "kira",
      label: "Geciken kira",
      value: n(late.length),
      chip: late.length > 0 ? { text: moneyTry(late.reduce((t, c) => t + Number(c.amount ?? 0), 0)), tone: "danger" } : { text: "Gecikme yok", tone: "success" },
      href: "/app/kiralama?durum=overdue",
    });
  }
  return tiles.slice(0, 4);
}

/** ARAMA DURUMU (çağrı merkezi): bu ay gelen arama · geri dönüş bekleyen talep · bugünkü görevim · bugünkü randevu. */
export async function loadCallPanelTiles(ctx: HomeCtx): Promise<PanelTileData[]> {
  const can = (m: keyof HomeCtx["perms"]) => (ctx.perms[m] ?? []).includes("view");
  const [k, callbacks, tasks, appts] = await Promise.all([
    can("calls") ? loadKpiData(ctx).catch(() => null) : Promise.resolve(null),
    loadCallbackCount(ctx).catch(() => null),
    can("tasks") ? loadTaskSummary(ctx).catch(() => null) : Promise.resolve(null),
    can("appointments") ? loadTodayAppointments(ctx).catch(() => null) : Promise.resolve(null),
  ]);
  const tiles: PanelTileData[] = [];
  if (k?.calls) tiles.push({ key: "ay-arama", label: "Bu ay gelen arama", value: n(k.calls.thisMonth), href: "/app/gelen-kutusu?sekme=cagri&yon=inbound" });
  if (callbacks != null)
    tiles.push({ key: "geri-donus", label: "Geri dönüş bekleyen", value: n(callbacks), chip: callbacks > 0 ? { text: "24 saati geçti", tone: "warn" } : { text: "Hepsi işlendi", tone: "success" }, href: "/app/talepler?status=new" });
  if (tasks)
    tiles.push({
      key: "gorev",
      label: "Bugünkü görevim",
      value: n(tasks.dueToday),
      chip: tasks.overdue > 0 ? { text: `${n(tasks.overdue)} gecikmiş`, tone: "danger" } : { text: "Gecikme yok", tone: "success" },
      href: tasks.overdue > 0 ? "/app/gorevler?filter=overdue&mine=1" : "/app/gorevler?filter=today&mine=1",
    });
  if (appts) tiles.push({ key: "randevu", label: "Bugünkü randevu", value: n(appts.total), href: "/app/randevular?gorunum=rota&gun=bugun" });
  return tiles.slice(0, 4);
}

/* ------------------------------ Rol bazlı Dikkat kayıtları ------------------------------ */

/**
 * Muhasebe ve çağrı merkezi Dikkat kategorileri (yönetim/danışman kategorileri `loadAttentionRecords`'tadır):
 *  - vadesi-gecen-alacak: `finance_open_items_v` alacak, açık tutar > 0, vade < bugün; en eski kalem (taraf · başlık · tutar)
 *  - banka-eslesmemis: incelenecek ekstre/fiş sayısı (`loadMoneySummary.reviewCount`)
 *  - cevapsiz-arama: bugünkü cevapsız aramalar; en eskisi (müşteri / telefon)
 */
export async function loadRoleAttentionExtras(ctx: HomeCtx, categories: readonly string[]): Promise<AttentionRecord[]> {
  const supabase = await createClient();
  const want = new Set(categories);
  const out: AttentionRecord[] = [];
  const jobs: Promise<void>[] = [];
  if (want.has("vadesi-gecen-alacak") && ctx.canSeeExpenses && ctx.tenantId) {
    jobs.push(
      (async () => {
        const [count, res] = await Promise.all([
          loadOverdueReceivables(ctx).catch(() => null),
          supabase
            .from("finance_open_items_v")
            .select("key, party_label, title, amount_open, due_date")
            .eq("tenant_id", ctx.tenantId!)
            .eq("direction", "receivable")
            .gt("amount_open", 0)
            .lt("due_date", trDayKey(now()))
            .order("due_date", { ascending: true })
            .limit(1),
        ]);
        if (!count) return;
        const r = ((res.data ?? []) as { party_label: string | null; title: string | null; amount_open: number | string | null; due_date: string | null }[])[0];
        out.push({
          key: "vadesi-gecen-alacak",
          level: "acil",
          title: "Vadesi geçen alacak",
          detail: r && !res.error ? joinDetail(r.party_label, r.title, r.amount_open != null ? moneyTry(Number(r.amount_open)) : null) : "Tahsil edilmemiş açık kalem",
          at: r?.due_date ? `${r.due_date}T00:00:00+03:00` : null,
          ageKind: r?.due_date ? "elapsed" : "none",
          href: financeHref("cari", { gorunum: "acik", kova: "gecikmis" }),
          total: count,
        });
      })().catch(() => undefined),
    );
  }
  if (want.has("banka-eslesmemis") && ctx.canSeeExpenses) {
    jobs.push(
      (async () => {
        const m = await loadMoneySummary(ctx);
        const c = m.reviewCount ?? 0;
        if (c <= 0) return;
        out.push({ key: "banka-eslesmemis", level: "yuksek", title: "Eşleşmemiş banka hareketi", detail: "Ekstre ve fiş incelemesi bekliyor", at: null, ageKind: "none", href: financeHref("kasa-banka"), total: c });
      })().catch(() => undefined),
    );
  }
  if (want.has("cevapsiz-arama") && (ctx.perms.calls ?? []).includes("view")) {
    jobs.push(
      (async () => {
        let q = ctx.sample
          .apply(supabase.from("calls").select("id, phone, started_at, customer:customers!calls_customer_id_fkey(full_name)", { count: "exact" }))
          .eq("direction", "missed")
          .gte("started_at", daysAgoIso(2));
        if (ctx.scopeMine) q = q.eq("handled_by", ctx.userId);
        const res = await q.order("started_at", { ascending: true }).limit(1);
        type Raw = { id: string; phone: string | null; started_at: string; customer: { full_name: string | null } | { full_name: string | null }[] | null };
        const r = ((res.data ?? []) as unknown as Raw[])[0];
        if (res.error || !r) return;
        const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
        out.push({
          key: "cevapsiz-arama",
          level: "acil",
          title: "Geri dönülmemiş arama",
          detail: joinDetail(cust?.full_name, cust?.full_name ? null : "Kayıtsız numara"),
          at: r.started_at,
          ageKind: "elapsed",
          href: "/app/gelen-kutusu?sekme=cagri&yon=missed",
          total: res.count ?? null,
        });
      })().catch(() => undefined),
    );
  }
  await Promise.all(jobs);
  return out;
}
