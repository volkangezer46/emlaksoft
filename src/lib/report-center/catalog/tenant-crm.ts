/**
 * Ofis raporları — müşteri, talep, portföy ve ilan (portal/kayıp-kaçak) alanı.
 * Sorgu kuralı: kiracı sınırı + aktör kapsamı (`applyActorScope`) her sorguda; veri RLS'li kullanıcı istemcisiyle okunur.
 */
import { defaultLabelMap, DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { applyCustomerFilters, normalizeCustomerFilters } from "@/lib/customer-list-filters";
import { LEAD_CHANNEL_LABELS, LEAD_CHANNEL_OPTIONS } from "@/lib/lead-channel";
import { formatPhoneDisplay } from "@/lib/phone";
import { propertyStatusLabel } from "@/lib/property-labels";
import { daysFromNowIso, trDayKey } from "@/lib/clock";
import { ANOMALY_TYPE_LABELS } from "@/components/listing-control/helpers";
import { DATE_RANGE_FIELDS } from "../filters";
import { loadDefLabels, memoLabels, STATUS, TRANSACTION_FALLBACK } from "../labels";
import { applyActorScope, applyTimestampRange, enrichProfiles, joinList, label, nameOf, one, searchOr } from "../query-helpers";
import type { Row } from "../types";
import { ADVISOR_FILTER, defineReport, opts, SEARCH_FILTER, tid } from "./define";

const CUSTOMER_TYPE_OPTIONS = DEFAULT_DEFINITIONS.customer_type.map((d) => ({ value: d.value, label: d.label }));
const SOURCE_OPTIONS = Object.entries(defaultLabelMap("customer_source")).map(([value, label]) => ({ value, label }));

/** Bütçe bantları — talepler sayfasıyla birebir (karar değeri coalesce(max,min), aralık (min,max]). */
const DEMAND_BANDS: Record<string, { min: number; max: number; label: string }> = {
  "2m": { min: 0, max: 2_000_000, label: "2 milyon TL'ye kadar" },
  "5m": { min: 2_000_000, max: 5_000_000, label: "2 – 5 milyon TL" },
  "10m": { min: 5_000_000, max: 10_000_000, label: "5 – 10 milyon TL" },
  "10m+": { min: 10_000_000, max: Infinity, label: "10 milyon TL üstü" },
};
function demandBudgetOrFilter(key: string): string {
  const band = DEMAND_BANDS[key]!;
  const lo = band.min === 0 ? "gte" : "gt";
  const hiMax = Number.isFinite(band.max) ? `,budget_max.lte.${band.max}` : "";
  const hiMin = Number.isFinite(band.max) ? `,budget_min.lte.${band.max}` : "";
  return `and(budget_max.${lo}.${band.min}${hiMax}),and(budget_max.is.null,budget_min.${lo}.${band.min}${hiMin})`;
}

export const musteriler = defineReport({
  id: "musteriler",
  title: "Müşteriler",
  description: "Müşteri listesi: iletişim, tür, kaynak, başvuru kanalı, etiketler ve sorumlu danışman.",
  category: "musteri",
  customFields: "customer",
  scope: "tenant",
  module: "customers",
  personalData: true,
  keywords: ["alıcı", "satıcı", "kiracı", "lead", "rehber"],
  filters: [
    SEARCH_FILTER("Arama", "Ad, telefon, e-posta"),
    { kind: "select", key: "type", label: "Müşteri türü", options: CUSTOMER_TYPE_OPTIONS },
    { kind: "select", key: "source", label: "Kaynak", options: SOURCE_OPTIONS },
    { kind: "select", key: "kanal", label: "Başvuru kanalı", options: LEAD_CHANNEL_OPTIONS.map((v) => ({ value: v, label: LEAD_CHANNEL_LABELS[v] ?? v })) },
    { kind: "text", key: "etiket", label: "Etiket" },
    { kind: "advisor", key: "assigned", label: "Danışman" },
    ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi"),
  ],
  columns: [
    { key: "ad", label: "Ad soyad", type: "text", width: 26, get: (r) => r.full_name },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => formatPhoneDisplay(r.phone) },
    { key: "eposta", label: "E-posta", type: "text", width: 28, get: (r) => r.email },
    { key: "tur", label: "Müşteri türü", type: "text", width: 18, get: (r) => joinList(r.customer_types) },
    { key: "kaynak", label: "Kaynak", type: "text", width: 16, get: (r, c) => label(memoLabels(c, "customer_source"), r.source) },
    { key: "kanal", label: "Başvuru kanalı", type: "text", width: 16, get: (r) => label(LEAD_CHANNEL_LABELS, r.lead_channel) },
    { key: "etiket", label: "Etiketler", type: "text", width: 22, get: (r) => joinList(r.tags) },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, r.assigned_to) },
    { key: "kayit", label: "Kayıt tarihi", type: "date", get: (r) => r.created_at },
    { key: "guncelleme", label: "Son güncelleme", type: "date", get: (r) => r.updated_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      const q = ctx.supabase
        .from("customers")
        .select("id, full_name, phone, email, customer_types, tags, source, lead_channel, assigned_to, created_at, updated_at", { count: "exact" })
        .eq("tenant_id", tid(ctx))
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true });
      const filtered = applyCustomerFilters(q, normalizeCustomerFilters(f));
      return applyActorScope(ctx, filtered, { sample: true, actorColumn: "assigned_to" });
    },
    enrich: async (rows, ctx) => {
      await loadDefLabels(ctx, "customer_source");
      await enrichProfiles((r) => [r.assigned_to])(rows, ctx);
    },
  },
});

export const talepler = defineReport({
  id: "talepler",
  title: "Müşteri talepleri",
  description: "Alıcı/kiracı talepleri: bütçe, oda, aciliyet, durum ve sorumlu danışman.",
  category: "musteri",
  customFields: "demand",
  scope: "tenant",
  module: "demands",
  personalData: true,
  keywords: ["talep", "bütçe", "arayış"],
  filters: [
    { kind: "select", key: "status", label: "Durum", options: opts(STATUS.demand) },
    { kind: "select", key: "aciliyet", label: "Aciliyet", options: opts(STATUS.urgency) },
    { kind: "select", key: "butce", label: "Bütçe aralığı", options: Object.entries(DEMAND_BANDS).map(([value, b]) => ({ value, label: b.label })) },
    ADVISOR_FILTER,
    ...DATE_RANGE_FIELDS("Talep başlangıcı", "Talep bitişi"),
  ],
  columns: [
    { key: "musteri", label: "Müşteri", type: "text", width: 24, get: (r) => one(r.customer)?.full_name },
    { key: "islem", label: "İşlem", type: "text", width: 12, get: (r, c) => label({ ...TRANSACTION_FALLBACK, ...memoLabels(c, "transaction_type") }, r.transaction_type) },
    { key: "tip", label: "Portföy tipi", type: "text", width: 16, get: (r) => r.property_type },
    { key: "bmin", label: "Bütçe (en az)", type: "money", decimals: 0, get: (r) => r.budget_min },
    { key: "bmax", label: "Bütçe (en çok)", type: "money", decimals: 0, get: (r) => r.budget_max },
    { key: "oda", label: "Oda", type: "text", width: 10, get: (r) => r.rooms },
    { key: "m2", label: "En az m²", type: "number", get: (r) => r.min_sqm },
    { key: "il", label: "İl", type: "text", width: 14, get: (r) => one(r.province)?.name },
    { key: "ilce", label: "İlçe", type: "text", width: 14, get: (r) => one(r.district)?.name },
    { key: "aciliyet", label: "Aciliyet", type: "text", width: 12, get: (r) => label(STATUS.urgency, r.urgency) },
    { key: "durum", label: "Durum", type: "text", width: 12, get: (r) => label(STATUS.demand, r.status) },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, one(r.customer)?.assigned_to) },
    { key: "kayit", label: "Talep tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("customer_demands")
        .select(
          "id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, customer:customers!customer_demands_customer_id_fkey!inner(full_name, tenant_id, assigned_to), province:geo_provinces(name), district:geo_districts(name)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("customer.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "customer.assigned_to" });
      if (f.status) q = q.eq("status", f.status);
      if (f.aciliyet) q = q.eq("urgency", f.aciliyet);
      if (f.butce && DEMAND_BANDS[f.butce]) q = q.or(demandBudgetOrFilter(f.butce));
      if (f.advisor) q = q.eq("customer.assigned_to", f.advisor);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: async (rows, ctx) => {
      await loadDefLabels(ctx, "transaction_type");
      await enrichProfiles((r) => [one(r.customer as Row | null)?.assigned_to])(rows, ctx);
    },
  },
});

export const tavsiyeler = defineReport({
  id: "tavsiyeler",
  title: "Tavsiyeler (referanslar)",
  description: "Müşterilerin getirdiği tavsiyeler: kim tavsiye etti, durum, ilgilenen kişi ve notlar.",
  category: "musteri",
  scope: "tenant",
  module: "customers",
  personalData: true,
  keywords: ["referans", "tavsiye"],
  filters: [{ kind: "select", key: "status", label: "Durum", options: opts(STATUS.referral) }, ...DATE_RANGE_FIELDS()],
  columns: [
    { key: "ad", label: "Tavsiye edilen", type: "text", width: 24, get: (r) => r.referred_name },
    { key: "telefon", label: "Telefon", type: "text", width: 16, get: (r) => formatPhoneDisplay(r.referred_phone) },
    { key: "eden", label: "Tavsiye eden müşteri", type: "text", width: 24, get: (r) => one(r.referrer)?.full_name },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.referral, r.status) },
    { key: "ilgilenen", label: "İlgilenen", type: "text", width: 20, get: (r, c) => nameOf(c, r.handled_by) },
    { key: "not", label: "Not", type: "text", width: 30, get: (r) => r.referred_note },
    { key: "ofisnot", label: "Ofis notu", type: "text", width: 30, get: (r) => r.staff_note },
    { key: "tarih", label: "Tarih", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("referrals")
        .select(
          "referred_name, referred_phone, referred_note, staff_note, status, handled_by, created_at, referrer:customers!referrals_referrer_customer_id_fkey(full_name, tenant_id)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("referrer.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "handled_by" });
      if (f.status) q = q.eq("status", f.status);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.handled_by]),
  },
});

export const musteriKaynaklari = defineReport({
  id: "musteri-kaynaklari",
  title: "Müşteri kaynak dağılımı",
  description: "Müşterilerin hangi kaynak ve başvuru kanalından geldiğinin sayısı ve payı (pazarlama etkinliği).",
  category: "musteri",
  scope: "tenant",
  module: "customers",
  keywords: ["kanal", "pazarlama", "roi", "lead"],
  filters: [...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi"), ADVISOR_FILTER],
  columns: [
    { key: "kaynak", label: "Kaynak", type: "text", width: 24, get: (r) => r.source },
    { key: "kanal", label: "Başvuru kanalı", type: "text", width: 20, get: (r) => r.channel },
    { key: "adet", label: "Müşteri sayısı", type: "number", total: true, get: (r) => r.count },
    { key: "pay", label: "Pay", type: "percent", get: (r) => r.share },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const labels = await loadDefLabels(ctx, "customer_source");
      const counts = new Map<string, { source: string; channel: string; count: number }>();
      let from = 0;
      for (;;) {
        let q = ctx.supabase.from("customers").select("source, lead_channel").eq("tenant_id", tid(ctx)).is("deleted_at", null);
        q = applyActorScope(ctx, q, { sample: true, actorColumn: "assigned_to" });
        q = applyTimestampRange(q, "created_at", f);
        if (f.advisor) q = q.eq("assigned_to", f.advisor);
        const { data, error } = await q.order("id", { ascending: true }).range(from, from + 999);
        if (error) throw error;
        for (const r of (data ?? []) as Row[]) {
          const source = label(labels, r.source) || "Belirtilmemiş";
          const channel = label(LEAD_CHANNEL_LABELS, r.lead_channel) || "—";
          const key = `${source}|${channel}`;
          const cur = counts.get(key) ?? { source, channel, count: 0 };
          cur.count += 1;
          counts.set(key, cur);
        }
        if ((data ?? []).length < 1000 || from > 200_000) break;
        from += 1000;
      }
      const total = [...counts.values()].reduce((a, b) => a + b.count, 0);
      return [...counts.values()]
        .sort((a, b) => b.count - a.count)
        .map((c) => ({ ...c, share: total ? Math.round((c.count / total) * 1000) / 10 : 0 }));
    },
  },
});

export const portfoyler = defineReport({
  id: "portfoyler",
  title: "Portföyler",
  description: "Portföy listesi: kod, durum, fiyat, konum, yetki belgesi süresi ve sorumlu danışman.",
  category: "portfoy",
  customFields: "property",
  scope: "tenant",
  module: "properties",
  keywords: ["ilan", "gayrimenkul", "yetki", "satılık", "kiralık"],
  filters: [
    { kind: "select", key: "status", label: "Durum", options: opts(STATUS.propertyStatus) },
    { kind: "select", key: "islem", label: "İşlem", options: [{ value: "Satılık", label: "Satılık" }, { value: "Kiralık", label: "Kiralık" }] },
    { kind: "text", key: "tip", label: "Portföy tipi", placeholder: "Daire, Villa..." },
    { kind: "select", key: "yetki", label: "Yetki belgesi", options: [{ value: "bitmis", label: "Süresi dolmuş" }, { value: "30", label: "30 gün içinde bitiyor" }, { value: "60", label: "60 gün içinde bitiyor" }] },
    ADVISOR_FILTER,
    ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi"),
  ],
  columns: [
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => r.property_code },
    { key: "baslik", label: "Başlık", type: "text", width: 34, get: (r) => r.title },
    { key: "islem", label: "İşlem", type: "text", width: 11, get: (r, c) => label({ ...TRANSACTION_FALLBACK, ...memoLabels(c, "transaction_type") }, r.transaction_type) },
    { key: "tip", label: "Tip", type: "text", width: 14, get: (r) => r.property_type },
    { key: "durum", label: "Durum", type: "text", width: 12, get: (r) => propertyStatusLabel(r.status) },
    { key: "fiyat", label: "Liste fiyatı", type: "money", decimals: 0, get: (r) => r.list_price },
    { key: "komisyon", label: "Komisyon oranı", type: "percent", get: (r) => r.commission_rate },
    { key: "il", label: "İl", type: "text", width: 13, get: (r) => one(r.province)?.name },
    { key: "ilce", label: "İlçe", type: "text", width: 14, get: (r) => one(r.district)?.name },
    { key: "mahalle", label: "Mahalle", type: "text", width: 16, get: (r) => one(r.neighborhood)?.name },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, r.assigned_to) },
    { key: "yturu", label: "Yetki türü", type: "text", width: 14, get: (r) => r.authorization_type },
    { key: "ybas", label: "Yetki başlangıcı", type: "date", get: (r) => r.authorization_start },
    { key: "ybit", label: "Yetki bitişi", type: "date", get: (r) => r.authorization_end },
    { key: "yayin", label: "Yayın tarihi", type: "date", get: (r) => r.published_at },
    { key: "kayit", label: "Kayıt tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("properties")
        .select(
          "id, property_code, title, transaction_type, property_type, status, list_price, commission_rate, assigned_to, authorization_type, authorization_start, authorization_end, published_at, created_at, province:geo_provinces(name), district:geo_districts(name), neighborhood:geo_neighborhoods(name)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .is("deleted_at", null);
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "assigned_to" });
      if (f.status) q = q.eq("status", f.status);
      if (f.islem) q = q.in("transaction_type", f.islem === "Satılık" ? ["Satılık", "sale"] : ["Kiralık", "rent"]);
      if (f.tip) q = q.ilike("property_type", `%${f.tip.replace(/[%_,()]/g, " ").trim()}%`);
      if (f.advisor) q = q.eq("assigned_to", f.advisor);
      if (f.yetki) {
        const today = trDayKey();
        if (f.yetki === "bitmis") q = q.lt("authorization_end", today);
        else q = q.gte("authorization_end", today).lte("authorization_end", trDayKey(daysFromNowIso(Number(f.yetki))));
      }
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: async (rows, ctx) => {
      await loadDefLabels(ctx, "transaction_type");
      await enrichProfiles((r) => [r.assigned_to])(rows, ctx);
    },
  },
});

export const portalIlanlari = defineReport({
  id: "portal-ilanlari",
  title: "Portal ilanları",
  description: "Portallardaki ilanlar: portal, ilan no, durum, son teyit, yayın ve kaldırılma tarihleri.",
  category: "portfoy",
  scope: "tenant",
  module: "portals",
  keywords: ["sahibinden", "hepsiemlak", "teyit", "ilan"],
  filters: [
    { kind: "text", key: "portal", label: "Portal", placeholder: "sahibinden, hepsiemlak..." },
    { kind: "select", key: "status", label: "Durum", options: opts(STATUS.portalListing) },
    ADVISOR_FILTER,
    ...DATE_RANGE_FIELDS("Oluşturma başlangıcı", "Oluşturma bitişi"),
  ],
  columns: [
    { key: "portal", label: "Portal", type: "text", width: 16, get: (r) => r.portal_name },
    { key: "ilanno", label: "İlan no", type: "text", width: 16, get: (r) => r.portal_listing_id },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "baslik", label: "Portföy başlığı", type: "text", width: 32, get: (r) => one(r.property)?.title },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, one(r.property)?.assigned_to) },
    { key: "durum", label: "Durum", type: "text", width: 12, get: (r) => label(STATUS.portalListing, r.status) },
    { key: "teyit", label: "Son teyit", type: "datetime", get: (r) => r.last_confirmed_at },
    { key: "yayin", label: "Yayın tarihi", type: "date", get: (r) => r.published_at },
    { key: "kaldirma", label: "Kaldırılma tarihi", type: "date", get: (r) => r.removed_at },
    { key: "neden", label: "Kaldırma nedeni", type: "text", width: 24, get: (r) => r.removal_reason },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("portal_listings")
        .select(
          "portal_name, portal_listing_id, status, last_confirmed_at, published_at, removed_at, removal_reason, created_at, property:properties!portal_listings_property_id_fkey!inner(property_code, title, tenant_id, assigned_to)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("property.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "property.assigned_to" });
      if (f.portal) q = searchOr(q, ["portal_name"], f.portal);
      if (f.status) q = q.eq("status", f.status);
      if (f.advisor) q = q.eq("property.assigned_to", f.advisor);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [one(r.property as Row | null)?.assigned_to]),
  },
});

export const ilanAnomalileri = defineReport({
  id: "ilan-anomalileri",
  title: "İlan kontrol uyarıları",
  description: "İlan kontrolünün bulduğu sorunlar: portalda bulunamayan, mükerrer, yetkisi biten, olası kaçan satışlar.",
  category: "portfoy",
  scope: "tenant",
  module: "portals",
  keywords: ["anomali", "teyit", "kontrol", "risk"],
  filters: [
    { kind: "select", key: "type", label: "Uyarı türü", options: opts(ANOMALY_TYPE_LABELS) },
    { kind: "select", key: "status", label: "Durum", options: opts(STATUS.anomalyStatus) },
    { kind: "select", key: "severity", label: "Önem", options: opts(STATUS.severity) },
    ADVISOR_FILTER,
    ...DATE_RANGE_FIELDS("İlk görülme başlangıcı", "İlk görülme bitişi"),
  ],
  columns: [
    { key: "tur", label: "Uyarı türü", type: "text", width: 24, get: (r) => label(ANOMALY_TYPE_LABELS, r.type) },
    { key: "onem", label: "Önem", type: "text", width: 10, get: (r) => label(STATUS.severity, r.severity) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.anomalyStatus, r.status) },
    { key: "risk", label: "Risk puanı", type: "number", get: (r) => r.risk_score },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "baslik", label: "Portföy", type: "text", width: 30, get: (r) => one(r.property)?.title },
    { key: "danisman", label: "Danışman", type: "text", width: 20, get: (r, c) => nameOf(c, r.advisor_id) },
    { key: "ilk", label: "İlk görülme", type: "datetime", get: (r) => r.first_seen_at },
    { key: "son", label: "Son görülme", type: "datetime", get: (r) => r.last_seen_at },
    { key: "sla", label: "SLA bitişi", type: "datetime", get: (r) => r.sla_due_at },
    { key: "cozum", label: "Çözüm tarihi", type: "datetime", get: (r) => r.resolved_at },
    { key: "aciklama", label: "Açıklama", type: "text", width: 30, get: (r) => r.explained_note },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("listing_anomalies")
        .select(
          "id, type, severity, status, risk_score, advisor_id, first_seen_at, last_seen_at, sla_due_at, resolved_at, explained_note, property:properties!listing_anomalies_property_tenant_fkey(property_code, title, tenant_id)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "advisor_id" });
      if (f.type) q = q.eq("type", f.type);
      if (f.status) q = q.eq("status", f.status);
      if (f.severity) q = q.eq("severity", f.severity);
      if (f.advisor) q = q.eq("advisor_id", f.advisor);
      q = applyTimestampRange(q, "first_seen_at", f);
      return q.order("first_seen_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.advisor_id]),
  },
});

export const ilanKapanislari = defineReport({
  id: "kayip-kacak",
  title: "Kayıp-kaçak (ilan kapanışları)",
  description: "Portaldan kapanan ilanlar: kapanış nedeni, işlem gerçekleşti mi, rakip kapattı mı, tahmini kaçan komisyon.",
  category: "portfoy",
  scope: "tenant",
  module: "leak",
  keywords: ["kaçak", "kayıp", "kapanış", "komisyon"],
  filters: [
    { kind: "select", key: "deal", label: "İşlem gerçekleşti mi", options: [{ value: "evet", label: "Evet" }, { value: "hayir", label: "Hayır" }] },
    { kind: "select", key: "rakip", label: "Rakip kapattı mı", options: [{ value: "evet", label: "Evet" }, { value: "hayir", label: "Hayır" }] },
    { kind: "select", key: "severity", label: "Önem", options: opts(STATUS.severity) },
    ...DATE_RANGE_FIELDS("Kapanış başlangıcı", "Kapanış bitişi"),
  ],
  columns: [
    { key: "tarih", label: "Kapanış tarihi", type: "date", get: (r) => r.created_at },
    { key: "portal", label: "Portal", type: "text", width: 16, get: (r) => one(r.portal_listing)?.portal_name },
    { key: "ilanno", label: "İlan no", type: "text", width: 16, get: (r) => one(r.portal_listing)?.portal_listing_id },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(one(r.portal_listing)?.property)?.property_code },
    { key: "baslik", label: "Portföy", type: "text", width: 30, get: (r) => one(one(r.portal_listing)?.property)?.title },
    { key: "neden", label: "Kapanış nedeni", type: "text", width: 26, get: (r) => r.reason },
    { key: "islem", label: "İşlem gerçekleşti", type: "bool", get: (r) => r.deal_happened },
    { key: "tutar", label: "İşlem tutarı", type: "money", decimals: 0, get: (r) => r.deal_amount },
    { key: "bizim", label: "Biz kapattık", type: "bool", get: (r) => r.closed_by_us },
    { key: "rakip", label: "Rakip kapattı", type: "bool", get: (r) => r.competitor_closed },
    { key: "kayip", label: "Tahmini kaçan komisyon", type: "money", decimals: 0, total: true, get: (r) => r.estimated_lost_commission },
    { key: "onem", label: "Önem", type: "text", width: 10, get: (r) => label(STATUS.severity, r.leak_severity) },
    { key: "kapatan", label: "Kaydeden", type: "text", width: 20, get: (r, c) => nameOf(c, r.created_by) },
    { key: "not", label: "Not", type: "text", width: 30, get: (r) => r.notes },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("listing_closures")
        .select(
          "id, reason, deal_happened, deal_amount, closed_by_us, competitor_closed, estimated_lost_commission, leak_severity, notes, created_by, created_at, portal_listing:portal_listings!listing_closures_portal_listing_id_fkey(portal_name, portal_listing_id, property:properties!portal_listings_property_id_fkey(property_code, title))",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
      if (f.deal) q = q.eq("deal_happened", f.deal === "evet");
      if (f.rakip) q = q.eq("competitor_closed", f.rakip === "evet");
      if (f.severity) q = q.eq("leak_severity", f.severity);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.created_by]),
  },
});

export const projeler = defineReport({
  id: "projeler",
  title: "Projeler ve daire stoku",
  description: "Projeler: müteahhit, konum, teslim tarihi, toplam / satılan / rezerve daire sayısı.",
  category: "portfoy",
  scope: "tenant",
  module: "projects",
  keywords: ["proje", "daire", "stok", "müteahhit"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.project) }, ...DATE_RANGE_FIELDS("Kayıt başlangıcı", "Kayıt bitişi")],
  columns: [
    { key: "ad", label: "Proje", type: "text", width: 28, get: (r) => r.name },
    { key: "muteahhit", label: "Müteahhit", type: "text", width: 22, get: (r) => r.developer_name },
    { key: "konum", label: "Konum", type: "text", width: 24, get: (r) => r.location },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.project, r.status) },
    { key: "teslim", label: "Teslim tarihi", type: "date", get: (r) => r.delivery_date },
    { key: "toplam", label: "Toplam daire", type: "number", total: true, get: (r) => ((r.units ?? []) as Row[]).length },
    { key: "satilan", label: "Satılan", type: "number", total: true, get: (r) => ((r.units ?? []) as Row[]).filter((u) => u.status === "sold").length },
    { key: "rezerve", label: "Rezerve / kaparolu", type: "number", total: true, get: (r) => ((r.units ?? []) as Row[]).filter((u) => u.status === "reserved" || u.status === "deposit").length },
    { key: "kayit", label: "Kayıt tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("projects")
        .select("id, name, developer_name, location, status, delivery_date, created_at, units:project_units!project_units_project_id_fkey(status)", { count: "exact" })
        .eq("tenant_id", tid(ctx))
        .eq("units.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
      if (f.durum) q = q.eq("status", f.durum);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
  },
});

export const CRM_REPORTS = [musteriler, talepler, tavsiyeler, musteriKaynaklari, portfoyler, portalIlanlari, ilanAnomalileri, ilanKapanislari, projeler];
