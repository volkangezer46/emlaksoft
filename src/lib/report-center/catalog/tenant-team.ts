/**
 * Ofis raporları — ekip ve performans: danışman KPI, hedef gerçekleşme, lig, ekip, denetim, kampanya ve anket sonuçları.
 */
import { AUDIT_CHANGE_LABELS } from "@/lib/access-control/admin-rules";
import { applyAccessAuditFilters, normalizeAccessAuditFilters } from "@/lib/access-control/audit-filters";
import { applyAuditFilters, normalizeAuditFilters } from "@/lib/audit-filters";
import { actionLabel, riskOf } from "@/lib/audit-labels";
import { now, trDayKey } from "@/lib/clock";
import { formatPhoneDisplay } from "@/lib/phone";
import { currentMonthPeriod, loadAdvisorMetrics, loadTargetActualsLive } from "@/lib/team/advisor-metrics";
import { ROLE_LABELS } from "@/lib/role-labels";
import { DATE_RANGE_FIELDS } from "../filters";
import { STATUS } from "../labels";
import { applyActorScope, applyDateRange, applyTimestampRange, dayStartIso, enrichCustomers, enrichProfiles, label, nameOf, nextDayStartIso, one, chainEnrich } from "../query-helpers";
import type { Row } from "../types";
import { ADVISOR_FILTER, defineReport, opts, tid } from "./define";

export const danismanPerformansi = defineReport({
  id: "danisman-performansi",
  title: "Danışman performansı (KPI)",
  description: "Danışman başına müşteri, portföy, çağrı, randevu, teklif, anlaşma, dönüşüm, tahsil edilen pay ve hedef gerçekleşmesi.",
  category: "ekip",
  scope: "tenant",
  module: "reports",
  keywords: ["kpi", "performans", "karne", "dönüşüm"],
  filters: [...DATE_RANGE_FIELDS("Dönem başlangıcı (boşsa bu ay)", "Dönem bitişi (boşsa bugün)")],
  columns: [
    { key: "danisman", label: "Danışman", type: "text", width: 24, get: (r) => r.fullName },
    { key: "rol", label: "Rol", type: "text", width: 16, get: (r) => label(ROLE_LABELS, r.role) },
    { key: "musteri", label: "Müşteri (toplam)", type: "number", total: true, get: (r) => r.customerCount },
    { key: "yeni", label: "Yeni müşteri", type: "number", total: true, get: (r) => r.newCustomerCount },
    { key: "portfoy", label: "Yayındaki portföy", type: "number", total: true, get: (r) => r.activePropertyCount },
    { key: "cagri", label: "Çağrı", type: "number", total: true, get: (r) => r.callCount },
    { key: "randevu", label: "Randevu", type: "number", total: true, get: (r) => r.appointCount },
    { key: "teklif", label: "Teklif", type: "number", total: true, get: (r) => r.offerCount },
    { key: "anlasma", label: "Anlaşma (kabul edilen teklif)", type: "number", total: true, get: (r) => r.dealCount },
    { key: "donusum", label: "Dönüşüm (anlaşma / teklif)", type: "percent", get: (r) => r.conversionPct },
    { key: "gelir", label: "Tahsil edilen pay", type: "money", total: true, get: (r) => r.revenue },
    { key: "bekleyen", label: "Bekleyen pay", type: "money", total: true, get: (r) => r.pendingRevenue },
    { key: "hedefA", label: "Hedef anlaşma", type: "number", get: (r) => r.target?.deals },
    { key: "hedefG", label: "Hedef gelir", type: "money", get: (r) => r.target?.revenue },
    { key: "hedefP", label: "Hedef gerçekleşme", type: "percent", decimals: 0, get: (r) => r.targetPct },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const nowMs = now();
      const base = currentMonthPeriod(nowMs);
      const from = f.from ?? trDayKey(base.startIso);
      const to = f.to ?? trDayKey(nowMs);
      const period = f.from || f.to ? { startIso: dayStartIso(from), endIso: nextDayStartIso(to), startDateKey: `${from.slice(0, 7)}-01` } : base;
      const res = await loadAdvisorMetrics(ctx.supabase, { viewer: { userId: ctx.userId, role: ctx.role, perms: ctx.perms }, tenantId: tid(ctx), period, withTargets: true, nowMs });
      if (res.failed) throw new Error("danışman metrikleri okunamadı");
      return res.rows as unknown as Row[];
    },
  },
});

export const hedefGerceklesme = defineReport({
  id: "hedef-gerceklesme",
  title: "Hedef gerçekleşme",
  description: "Aylık / üç aylık / yıllık hedefler ve canlı gerçekleşme (kabul edilen teklif ve tahsil edilen pay üzerinden).",
  category: "ekip",
  scope: "tenant",
  module: "targets",
  earnings: true,
  keywords: ["hedef", "ciro", "gerçekleşme"],
  filters: [{ kind: "select", key: "donem", label: "Dönem türü", options: opts(STATUS.targetPeriod) }, ...DATE_RANGE_FIELDS("Dönem başlangıcı (en erken)", "Dönem başlangıcı (en geç)")],
  columns: [
    { key: "sahip", label: "Hedef sahibi", type: "text", width: 24, get: (r, c) => (r.profile_id ? nameOf(c, r.profile_id) : "Ofis geneli") },
    { key: "donem", label: "Dönem türü", type: "text", width: 14, get: (r) => label(STATUS.targetPeriod, r.period) },
    { key: "bas", label: "Dönem başlangıcı", type: "date", get: (r) => r.period_start },
    { key: "hedefA", label: "Hedef anlaşma", type: "number", total: true, get: (r) => r.target_deals },
    { key: "gercekA", label: "Gerçekleşen anlaşma", type: "number", total: true, get: (r) => r.actual_deals },
    { key: "oranA", label: "Anlaşma gerçekleşme", type: "percent", decimals: 0, get: (r) => (Number(r.target_deals) > 0 ? (Number(r.actual_deals) / Number(r.target_deals)) * 100 : null) },
    { key: "hedefG", label: "Hedef gelir", type: "money", total: true, get: (r) => r.target_revenue },
    { key: "gercekG", label: "Gerçekleşen gelir", type: "money", total: true, get: (r) => (r.revenue_visible ? r.actual_revenue : null) },
    { key: "oranG", label: "Gelir gerçekleşme", type: "percent", decimals: 0, get: (r) => (r.revenue_visible && Number(r.target_revenue) > 0 ? (Number(r.actual_revenue) / Number(r.target_revenue)) * 100 : null) },
    { key: "hedefR", label: "Hedef randevu", type: "number", get: (r) => r.target_appointments },
    { key: "hedefP", label: "Hedef yeni portföy", type: "number", get: (r) => r.target_listings },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      let q = ctx.supabase
        .from("targets")
        .select("id, profile_id, period, period_start, target_deals, target_revenue, target_appointments, target_listings")
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "profile_id", earnings: false });
      if (f.donem) q = q.eq("period", f.donem);
      q = applyDateRange(q, "period_start", f);
      const { data, error } = await q.order("period_start", { ascending: false }).limit(1000);
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      const ids = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: people } = await ctx.supabase.from("profiles").select("id, full_name").eq("tenant_id", tid(ctx)).in("id", ids);
        for (const p of (people ?? []) as Row[]) names.set(p.id, p.full_name);
      }
      for (const [k, v] of names) ctx.names.set(k, v);
      const actuals = await loadTargetActualsLive(ctx.supabase, {
        viewer: { userId: ctx.userId, role: ctx.role, perms: ctx.perms },
        tenantId: tid(ctx),
        targets: rows.map((r) => ({ id: r.id, period: r.period, period_start: r.period_start, profile_id: r.profile_id })),
        names,
      });
      return rows.map((r) => {
        const a = actuals.get(r.id);
        return { ...r, actual_deals: a?.deals ?? 0, actual_revenue: a?.revenue ?? 0, revenue_visible: a?.revenueVisible ?? false };
      });
    },
  },
});

export const ligPuanlari = defineReport({
  id: "lig-puanlari",
  title: "Lig puanları (aylık mühürlü sıralama)",
  description: "Her ayın başında mühürlenen danışman puanları ve sıralaması.",
  category: "ekip",
  scope: "tenant",
  module: "reports",
  keywords: ["lig", "sıralama", "puan", "rozet"],
  filters: [{ kind: "text", key: "donem", label: "Dönem (YYYY-AA)", placeholder: "2026-09" }, ADVISOR_FILTER],
  columns: [
    { key: "donem", label: "Dönem", type: "text", width: 10, get: (r) => r.period },
    { key: "sira", label: "Sıra", type: "number", get: (r) => r.rank },
    { key: "danisman", label: "Danışman", type: "text", width: 24, get: (r, c) => nameOf(c, r.staff_id) },
    { key: "puan", label: "Puan", type: "number", total: true, get: (r) => r.score },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("agent_score_snapshots").select("id, staff_id, period, score, rank", { count: "exact" }).eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "staff_id" });
      if (f.donem && /^\d{4}-\d{2}$/.test(f.donem)) q = q.eq("period", f.donem);
      if (f.advisor) q = q.eq("staff_id", f.advisor);
      return q.order("period", { ascending: false }).order("rank", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.staff_id]),
  },
});

export const ekipKullanicilari = defineReport({
  id: "ekip-kullanicilari",
  title: "Ekip ve kullanıcılar",
  description: "Ofis kullanıcıları: rol, unvan, şube, takım, telefon ve aktiflik durumu.",
  category: "ekip",
  scope: "tenant",
  module: "team",
  officeWideOnly: true,
  personalData: true,
  keywords: ["personel", "kullanıcı", "çalışan", "şube", "takım"],
  filters: [
    { kind: "select", key: "rol", label: "Rol", options: opts(ROLE_LABELS) },
    { kind: "select", key: "durum", label: "Durum", options: [{ value: "aktif", label: "Aktif" }, { value: "pasif", label: "Pasif" }] },
  ],
  columns: [
    { key: "ad", label: "Ad soyad", type: "text", width: 26, get: (r) => r.full_name },
    { key: "unvan", label: "Unvan", type: "text", width: 20, get: (r) => r.title },
    { key: "rol", label: "Rol", type: "text", width: 16, get: (r) => label(ROLE_LABELS, r.role) },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => formatPhoneDisplay(r.phone) },
    { key: "sube", label: "Şube", type: "text", width: 18, get: (r, c) => (c.memo.get("branches") as Map<string, string> | undefined)?.get(r.branch_id) },
    { key: "takim", label: "Takım", type: "text", width: 18, get: (r, c) => (c.memo.get("teams") as Map<string, string> | undefined)?.get(r.team_id) },
    { key: "aktif", label: "Aktif", type: "bool", get: (r) => r.is_active },
    { key: "kayit", label: "Katılma tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("profiles").select("id, full_name, title, role, phone, branch_id, team_id, is_active, created_at", { count: "exact" }).eq("tenant_id", tid(ctx));
      if (f.rol) q = q.eq("role", f.rol);
      if (f.durum) q = q.eq("is_active", f.durum === "aktif");
      return q.order("full_name", { ascending: true }).order("id", { ascending: true });
    },
    enrich: async (_rows, ctx) => {
      if (ctx.memo.has("branches")) return;
      const [b, t] = await Promise.all([
        ctx.supabase.from("branches").select("id, name").eq("tenant_id", tid(ctx)),
        ctx.supabase.from("teams").select("id, name").eq("tenant_id", tid(ctx)),
      ]);
      ctx.memo.set("branches", new Map(((b.data ?? []) as Row[]).map((x) => [x.id, x.name])));
      ctx.memo.set("teams", new Map(((t.data ?? []) as Row[]).map((x) => [x.id, x.name])));
    },
  },
});

const RISK_TR: Record<string, string> = { yuksek: "Yüksek", orta: "Orta", dusuk: "Düşük" };
const jsonCell = (v: unknown): string => (v == null ? "" : JSON.stringify(v).slice(0, 500));

export const aktiviteDenetim = defineReport({
  id: "aktivite-denetim",
  title: "Aktivite ve denetim kaydı",
  description: "Ofisteki işlem geçmişi: kim, ne zaman, hangi kaydı değiştirdi, risk düzeyi ve önceki / yeni değerler. Yetkisiz kullanıcı yalnız kendi işlemlerini görür.",
  category: "ofis",
  scope: "tenant",
  module: "settings",
  earnings: true,
  personalData: true,
  keywords: ["denetim", "log", "audit", "kvkk", "işlem geçmişi"],
  filters: [
    { kind: "select", key: "risk", label: "Risk", options: [{ value: "yuksek", label: "Yüksek" }, { value: "orta", label: "Orta" }] },
    { kind: "text", key: "ara", label: "Arama", placeholder: "İşlem veya kayıt türü" },
    { kind: "advisor", key: "advisor", label: "İşlemi yapan" },
    ...DATE_RANGE_FIELDS(),
  ],
  columns: [
    { key: "tarih", label: "Zaman", type: "datetime", get: (r) => r.created_at },
    { key: "yapan", label: "İşlemi yapan", type: "text", width: 22, get: (r, c) => nameOf(c, r.actor_id) },
    { key: "islem", label: "İşlem", type: "text", width: 30, get: (r) => actionLabel[r.action] ?? r.action },
    { key: "risk", label: "Risk", type: "text", width: 10, get: (r) => RISK_TR[riskOf(r.action)] },
    { key: "tur", label: "Kayıt türü", type: "text", width: 16, get: (r) => r.entity_type },
    { key: "kayit", label: "Kayıt kimliği", type: "text", width: 36, get: (r) => r.entity_id },
    { key: "eski", label: "Önceki değer", type: "text", width: 36, get: (r) => jsonCell(r.old_value) },
    { key: "yeni", label: "Yeni değer", type: "text", width: 36, get: (r) => jsonCell(r.new_value) },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      const filters = normalizeAuditFilters({ from: f.from, to: f.to, aktor: f.advisor, risk: f.risk, ara: f.ara });
      let q = applyAuditFilters(
        ctx.supabase.from("audit_logs").select("id, action, entity_type, entity_id, actor_id, old_value, new_value, created_at", { count: "exact" }).eq("tenant_id", tid(ctx)),
        filters,
      );
      q = applyActorScope(ctx, q, { actorColumn: "actor_id", earnings: true });
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.actor_id]),
  },
});

export const yetkiDenetimi = defineReport({
  id: "yetki-denetimi",
  title: "Yetkilendirme denetim günlüğü",
  description: "Kapsam, istisna ve izin değişiklikleri: kim, kimin yetkisini, neden ve nasıl değiştirdi.",
  category: "ofis",
  scope: "tenant",
  module: "settings",
  rolesOnly: ["owner", "gm"],
  keywords: ["yetki", "izin", "kapsam", "istisna"],
  filters: [
    { kind: "select", key: "tur", label: "Değişiklik türü", options: opts(AUDIT_CHANGE_LABELS) },
    { kind: "advisor", key: "kullanici", label: "Yetkisi değişen kullanıcı" },
    { kind: "advisor", key: "yapan", label: "Değişikliği yapan" },
    ...DATE_RANGE_FIELDS(),
  ],
  columns: [
    { key: "tarih", label: "Zaman", type: "datetime", get: (r) => r.created_at },
    { key: "islem", label: "İşlem", type: "text", width: 26, get: (r) => label(AUDIT_CHANGE_LABELS, r.change_type) },
    { key: "yapan", label: "Değişikliği yapan", type: "text", width: 22, get: (r, c) => nameOf(c, r.created_by) },
    { key: "kullanici", label: "Etkilenen kullanıcı", type: "text", width: 22, get: (r, c) => nameOf(c, r.user_id) },
    { key: "kaynak", label: "Kaynak / modül", type: "text", width: 24, get: (r) => (r.details?.resource_type ? `${r.details.resource_type} ${String(r.details.resource_id ?? "").slice(0, 8)}` : (r.details?.module ?? "")) },
    { key: "gerekce", label: "Gerekçe", type: "text", width: 30, get: (r) => r.reason },
    { key: "once", label: "Önce", type: "text", width: 30, get: (r) => jsonCell(r.details?.before) },
    { key: "sonra", label: "Sonra", type: "text", width: 30, get: (r) => jsonCell(r.details?.after) },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      const filters = normalizeAccessAuditFilters({ kullanici: f.kullanici, yapan: f.yapan, tur: f.tur, from: f.from, to: f.to });
      const q = applyAccessAuditFilters(
        ctx.supabase.from("access_audit_log").select("id, user_id, change_type, details, reason, created_by, created_at", { count: "exact" }).eq("tenant_id", tid(ctx)),
        filters,
      );
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.user_id, r.created_by]),
  },
});

export const kampanyalar = defineReport({
  id: "kampanyalar",
  title: "Kampanyalar (SMS / WhatsApp)",
  description: "Toplu mesaj kampanyaları: kanal, durum, zamanlama, alıcı / gönderilen / başarısız sayıları ve başarı oranı.",
  category: "pazarlama",
  scope: "tenant",
  module: "campaigns",
  keywords: ["sms", "whatsapp", "toplu mesaj"],
  filters: [
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.campaign) },
    { kind: "select", key: "kanal", label: "Kanal", options: opts(STATUS.channel) },
    ...DATE_RANGE_FIELDS("Oluşturma başlangıcı", "Oluşturma bitişi"),
  ],
  columns: [
    { key: "baslik", label: "Kampanya", type: "text", width: 30, get: (r) => r.title },
    { key: "kanal", label: "Kanal", type: "text", width: 12, get: (r) => label(STATUS.channel, r.channel) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.campaign, r.status) },
    { key: "zaman", label: "Zamanlanan", type: "datetime", get: (r) => r.scheduled_at },
    { key: "gonderim", label: "Gönderim", type: "datetime", get: (r) => r.sent_at },
    { key: "alici", label: "Alıcı", type: "number", total: true, get: (r) => r.total_count },
    { key: "gonderilen", label: "Gönderilen", type: "number", total: true, get: (r) => r.sent_count },
    { key: "basarisiz", label: "Başarısız", type: "number", total: true, get: (r) => r.failed_count },
    { key: "oran", label: "Başarı oranı", type: "percent", get: (r) => (Number(r.total_count) > 0 ? (Number(r.sent_count) / Number(r.total_count)) * 100 : null) },
    { key: "hazirlayan", label: "Hazırlayan", type: "text", width: 20, get: (r, c) => nameOf(c, r.created_by) },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("campaigns")
        .select("id, title, channel, status, scheduled_at, sent_at, total_count, sent_count, failed_count, created_by, created_at", { count: "exact" })
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
      if (f.durum) q = q.eq("status", f.durum);
      if (f.kanal) q = q.eq("channel", f.kanal);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.created_by]),
  },
});

export const kampanyaAlicilari = defineReport({
  id: "kampanya-alicilari",
  title: "Kampanya alıcıları",
  description: "Kampanya alıcı listesi: gönderim durumu, teslim, hata nedeni. Tek kampanya seçilebilir.",
  category: "pazarlama",
  scope: "tenant",
  module: "campaigns",
  personalData: true,
  keywords: ["alıcı", "teslim", "izin yok"],
  filters: [
    { kind: "campaign", key: "kampanya", label: "Kampanya" },
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.recipient) },
    ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi"),
  ],
  columns: [
    { key: "kampanya", label: "Kampanya", type: "text", width: 28, get: (r) => one(r.campaign)?.title },
    { key: "ad", label: "Ad soyad", type: "text", width: 24, get: (r) => r.full_name },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => formatPhoneDisplay(r.phone) },
    { key: "durum", label: "Durum", type: "text", width: 20, get: (r) => label(STATUS.recipient, r.status) },
    { key: "hata", label: "Hata", type: "text", width: 28, get: (r) => r.error_msg },
    { key: "gonderim", label: "Gönderim", type: "datetime", get: (r) => r.sent_at },
    { key: "teslim", label: "Teslim", type: "datetime", get: (r) => r.delivered_at },
    { key: "kayit", label: "Kayıt", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("campaign_recipients")
        .select("id, full_name, phone, status, error_msg, sent_at, delivered_at, created_at, campaign:campaigns!inner(title, tenant_id, created_by)", { count: "exact" })
        .eq("campaign.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "campaign.created_by" });
      if (f.kampanya) q = q.eq("campaign_id", f.kampanya);
      if (f.durum) q = q.eq("status", f.durum);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
  },
});

const SCORE_BANDS: Record<string, { min: number; max: number; label: string }> = {
  memnun: { min: 9, max: 10, label: "Memnun (9-10)" },
  notr: { min: 7, max: 8, label: "Nötr (7-8)" },
  dusuk: { min: 0, max: 6, label: "Memnun değil (0-6)" },
};

export const anketSonuclari = defineReport({
  id: "anket-sonuclari",
  title: "Müşteri memnuniyet anketi sonuçları",
  description: "Anlaşma sonrası memnuniyet anketleri: puan (0-10), memnuniyet grubu, yorum ve danışman.",
  category: "ekip",
  scope: "tenant",
  module: "surveys",
  personalData: true,
  keywords: ["nps", "memnuniyet", "puan", "yorum"],
  filters: [
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.survey) },
    { kind: "select", key: "grup", label: "Memnuniyet", options: Object.entries(SCORE_BANDS).map(([value, b]) => ({ value, label: b.label })) },
    { kind: "advisor", key: "advisor", label: "Danışman" },
    ...DATE_RANGE_FIELDS("Gönderim başlangıcı", "Gönderim bitişi"),
  ],
  columns: [
    { key: "gonderim", label: "Gönderim", type: "date", get: (r) => r.sent_at },
    { key: "yanit", label: "Yanıt tarihi", type: "date", get: (r) => r.answered_at },
    { key: "musteri", label: "Müşteri", type: "text", width: 24, get: (r, c) => nameOf(c, r.customer_id) },
    { key: "danisman", label: "Danışman", type: "text", width: 22, get: (r, c) => nameOf(c, r.agent_id) },
    { key: "puan", label: "Puan (0-10)", type: "number", get: (r) => r.score },
    { key: "grup", label: "Memnuniyet", type: "text", width: 20, get: (r) => (r.score == null ? "" : Object.values(SCORE_BANDS).find((b) => r.score >= b.min && r.score <= b.max)?.label) },
    { key: "yorum", label: "Yorum", type: "text", width: 40, get: (r) => r.comment },
    { key: "durum", label: "Durum", type: "text", width: 16, get: (r) => label(STATUS.survey, r.status) },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("surveys")
        .select("id, customer_id, agent_id, score, comment, status, sent_at, answered_at", { count: "exact" })
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "agent_id" });
      if (f.durum) q = q.eq("status", f.durum);
      const band = f.grup ? SCORE_BANDS[f.grup] : null;
      if (band) q = q.gte("score", band.min).lte("score", band.max);
      if (f.advisor) q = q.eq("agent_id", f.advisor);
      q = applyTimestampRange(q, "sent_at", f);
      return q.order("sent_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: chainEnrich(enrichProfiles((r) => [r.agent_id]), enrichCustomers((r) => [r.customer_id])),
  },
});

export const TEAM_REPORTS = [danismanPerformansi, hedefGerceklesme, ligPuanlari, anketSonuclari, ekipKullanicilari, aktiviteDenetim, yetkiDenetimi, kampanyalar, kampanyaAlicilari];
