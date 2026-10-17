import type { AppModule } from "@/lib/permissions";
import { financePath } from "@/lib/finance/routes";
import { nlTargetHref } from "@/lib/nl-search/href";
import { periodFor } from "./slots";
import type { ZekaPeriod, ZekaSlots } from "./types";

/**
 * Sayı/toplam soruları için METRİK KATALOĞU (SAF). Her metrik: gereken izin modülü, ofis geneli tutar gerekiyorsa
 * `earnings_all`, ofis geneli sıralama gerekiyorsa ofis kapsamı ve FİLTRELENMİŞ liste bağlantısı (sıfır çıkmaz metrik:
 * görünen her sayı o kümeyi veren listeye götürür). Sorgunun kendisi `ZekaDataPort` içindedir (RLS'li kullanıcı istemcisi).
 */

export const METRIC_IDS = [
  "properties",
  "customers",
  "demands_open",
  "tasks_overdue",
  "tasks_today",
  "tasks_open",
  "appointments",
  "deals_open",
  "deals_won",
  "sales_volume",
  "top_advisor",
  "rent_overdue",
  "rentals_active",
  "offers_open",
  "contracts_active",
  "commission_pending",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type MetricDef = {
  id: MetricId;
  label: string;
  module: AppModule;
  /** Ofis geneli TUTAR (ciro, komisyon toplamı): `earnings_all` gerekir. */
  needsEarnings?: boolean;
  /** Başkalarının performansı (sıralama) ya da kişiye süzülemeyen ofis geneli sayı: ofis geneli veri kapsamı gerekir. */
  needsOfficeWide?: boolean;
  /** Varsayılan dönem (yoksa dönemsiz). */
  defaultPeriod?: ZekaPeriod["key"];
  money?: boolean;
};

export const METRICS: Readonly<Record<MetricId, MetricDef>> = {
  properties: { id: "properties", label: "Portföy", module: "properties" },
  customers: { id: "customers", label: "Müşteri", module: "customers" },
  demands_open: { id: "demands_open", label: "Açık talep", module: "demands" },
  tasks_overdue: { id: "tasks_overdue", label: "Gecikmiş görev", module: "tasks" },
  tasks_today: { id: "tasks_today", label: "Bugünkü görev", module: "tasks" },
  tasks_open: { id: "tasks_open", label: "Açık görev", module: "tasks" },
  appointments: { id: "appointments", label: "Randevu", module: "appointments", defaultPeriod: "today" },
  deals_open: { id: "deals_open", label: "Süren anlaşma", module: "commissions" },
  deals_won: { id: "deals_won", label: "Kazanılan anlaşma", module: "commissions", defaultPeriod: "this_month" },
  sales_volume: { id: "sales_volume", label: "Satış tutarı", module: "commissions", needsEarnings: true, defaultPeriod: "this_month", money: true },
  top_advisor: { id: "top_advisor", label: "En çok satış yapan danışman", module: "commissions", needsOfficeWide: true, defaultPeriod: "this_month" },
  // Kira/sözleşme sayılarının kişi bazlı sahiplik süzgeci yok (liste sayfaları ofis geneli): kendi kapsamındaki role
  // ofis geneli sayı "kapsamınızdaki" diye verilmez → ofis kapsamı gerekir. Teklif sayısı oluşturan kişiye süzülür
  // (`port-supabase.ts`, teklif listesiyle aynı kural).
  rent_overdue: { id: "rent_overdue", label: "Gecikmiş kira", module: "rentals", needsOfficeWide: true },
  rentals_active: { id: "rentals_active", label: "Aktif kira", module: "rentals", needsOfficeWide: true },
  offers_open: { id: "offers_open", label: "Bekleyen teklif", module: "offers" },
  contracts_active: { id: "contracts_active", label: "Sözleşme", module: "contracts", needsOfficeWide: true },
  commission_pending: { id: "commission_pending", label: "Bekleyen komisyon", module: "commissions", needsEarnings: true, money: true },
};

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

/** Sorgu + yuvalardan metrik seçer; seçemezse null (çağıran "emin değilim" der). `folded`: katlanmış sorgu. */
export function pickMetric(folded: string, slots: ZekaSlots): MetricId | null {
  const e = slots.entity;
  const s = slots.status;
  const all = new Set(slots.entities);
  if (has(folded, "en cok satis", "en fazla satis", "en iyi danisman", "en cok satan", "en basarili", "en cok anlasma", "lider danisman", "birinci danisman")) return "top_advisor";
  if (all.has("team") && has(folded, "en cok", "en fazla", "en iyi")) return "top_advisor";
  if (has(folded, "ciro", "satis tutari", "toplam satis", "ne kadar satis", "satis hacmi")) return "sales_volume";
  switch (e) {
    case "property":
      return "properties";
    case "customer":
      return "customers";
    case "demand":
      return "demands_open";
    case "task":
      return s === "overdue" ? "tasks_overdue" : s === "today" || slots.period?.key === "today" ? "tasks_today" : "tasks_open";
    case "appointment":
      return "appointments";
    case "deal":
      return s === "open" ? "deals_open" : "deals_won";
    case "offer":
      return "offers_open";
    case "contract":
      return "contracts_active";
    case "rental":
      return s === "overdue" || has(folded, "gecik", "odenmey") ? "rent_overdue" : "rentals_active";
    case "commission":
      return "commission_pending";
    case "team":
      return null;
    default:
      if (Object.keys(slots.propertyParams).length > 0) return "properties";
      return null;
  }
}

/** Metriğin dönemi: yuvadaki dönem, yoksa metriğin varsayılanı. */
export function metricPeriod(id: MetricId, slots: ZekaSlots, nowMs: number): ZekaPeriod | null {
  const def = METRICS[id];
  if (slots.period) return slots.period;
  return def.defaultPeriod ? periodFor(def.defaultPeriod, nowMs) : null;
}

/** Metriğin filtrelenmiş liste bağlantısı (listelerin mevcut filtre sözleşmesi). */
export function metricHref(id: MetricId, slots: ZekaSlots, period: ZekaPeriod | null): string {
  switch (id) {
    case "properties":
      return nlTargetHref({ target: "portfoy", filters: slots.propertyParams, chips: [], excluded: [], unknown: [], notes: [], provinceId: slots.provinceId }).href;
    case "customers":
      return "/app/musteriler";
    case "demands_open":
      return "/app/talepler";
    case "tasks_overdue":
      return "/app/gorevler?filter=overdue";
    case "tasks_today":
      return "/app/gorevler?filter=today";
    case "tasks_open":
      return "/app/gorevler?filter=open";
    case "appointments":
      if (period && period.from === period.to) return `/app/randevular?gorunum=gun&tarih=${period.from}`;
      if (period && (period.key === "this_week" || period.key === "next_week" || period.key === "last_week")) return `/app/randevular?gorunum=hafta&tarih=${period.from}`;
      return "/app/randevular";
    case "deals_open":
      return "/app/anlasmalar?gorunum=liste&asama=acik";
    case "deals_won":
    case "sales_volume":
      return period ? `/app/anlasmalar?gorunum=liste&asama=won&from=${period.from}&to=${period.to}` : "/app/anlasmalar?gorunum=liste&asama=won";
    case "top_advisor":
      return "/app/lig";
    case "rent_overdue":
      return "/app/kiralama?durum=overdue";
    case "rentals_active":
      return "/app/kiralama";
    case "offers_open":
      return "/app/teklifler?durum=submitted";
    case "contracts_active":
      return "/app/sozlesmeler";
    case "commission_pending":
      return financePath("komisyon");
  }
}

export type MetricValue =
  | { kind: "count"; count: number }
  | { kind: "money"; amount: number; count: number }
  | { kind: "ranking"; rows: { name: string; count: number; amount: number | null }[] };

/** Tam TL, kısaltma yok: ₺12.500.000 (ofis asistanıyla aynı biçimleyici). */
export { money as formatTry } from "@/lib/ai/tenant-advisor-fallback";
