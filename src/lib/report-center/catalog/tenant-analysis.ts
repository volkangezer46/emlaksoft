/**
 * Ofis raporları — analiz sayfalarının (Aday hızı, Talep-arz, Bölge analizi) tablo çıktıları.
 * Hesap, sayfaların kullandığı tek kaynak kütüphanelerle yapılır (`response-time`, `talep-arz`, `region_stats` RPC);
 * rapor merkezi aynı sayıları dosyaya yazar.
 */
import { daysAgoIso, now } from "@/lib/clock";
import { DEFAULT_SLA_MIN, SLA_OPTIONS_MIN, summarizeByAdvisor, summarizeResponses } from "@/lib/response-time/core";
import { loadLeadResponses } from "@/lib/response-time/load";
import { getSetting } from "@/lib/settings/read";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { aggregateTalepArz, median, type TalepArzDemandRow, type TalepArzPropertyRow } from "@/lib/talep-arz";
import { compareTr } from "@/lib/tr-text";
import { fillNames } from "../query-helpers";
import type { Row } from "../types";
import { defineReport, tid } from "./define";

export const adayHizi = defineReport({
  id: "aday-hizi",
  title: "Yanıt hızı (ilk yanıt süresi)",
  description: "Yeni müşteri kaydından ilk temasa geçen süre: danışman bazında kayıt, yanıtlanan, bekleyen, ortalama / medyan süre ve hedef içi oran.",
  category: "ekip",
  scope: "tenant",
  module: "reports",
  keywords: ["lead", "yanıt süresi", "sla", "hız"],
  filters: [
    { kind: "select", key: "donem", label: "Kayıt dönemi", options: [{ value: "7", label: "Son 7 gün" }, { value: "30", label: "Son 30 gün" }, { value: "90", label: "Son 90 gün" }] },
    { kind: "select", key: "esik", label: "Hedef süre", options: SLA_OPTIONS_MIN.map((m) => ({ value: String(m), label: `${m} dakika` })) },
  ],
  columns: [
    { key: "danisman", label: "Danışman", type: "text", width: 26, get: (r) => r.name },
    { key: "kayit", label: "Yeni kayıt", type: "number", total: true, get: (r) => r.total },
    { key: "yanit", label: "Yanıtlanan", type: "number", total: true, get: (r) => r.responded },
    { key: "bekleyen", label: "Bekleyen", type: "number", total: true, get: (r) => r.waiting },
    { key: "ort", label: "Ortalama süre (dk)", type: "number", get: (r) => r.avgMin },
    { key: "medyan", label: "Medyan süre (dk)", type: "number", get: (r) => r.medianMin },
    { key: "hedef", label: "Hedef içi oran", type: "percent", decimals: 0, get: (r) => r.withinSlaPct },
    { key: "asan", label: "Eşiği aşan bekleyen", type: "number", total: true, get: (r) => r.overdueWaiting },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const days = [7, 30, 90].includes(Number(f.donem)) ? Number(f.donem) : 30;
      const officeSla = Number(await getSetting<string>("office.sla.lead_first_response_min", { tenantId: tid(ctx) })) || DEFAULT_SLA_MIN;
      const esik = (SLA_OPTIONS_MIN as readonly number[]).includes(Number(f.esik)) ? Number(f.esik) : officeSla;
      const nowMs = now();
      const res = await loadLeadResponses(ctx.supabase, {
        tenantId: tid(ctx),
        startIso: daysAgoIso(days),
        endIso: new Date(nowMs + 60_000).toISOString(),
        assignedToIn: ctx.officeWide ? null : [ctx.userId],
        slaMin: esik,
        nowMs,
      });
      if (res.failed) throw new Error("yanıt hızı okunamadı");
      const by = summarizeByAdvisor(res.rows);
      await fillNames(ctx, "profiles", "full_name", by.map((a) => a.advisorId));
      const overall = summarizeResponses(res.rows);
      return [
        { name: "Seçili kapsam (toplam)", ...overall },
        ...by.map((a) => ({ name: a.advisorId ? (ctx.names.get(a.advisorId) ?? "Danışman") : "Atanmamış", ...a.summary })),
      ];
    },
  },
});

const OPEN_DEMAND_STATUSES = ["new", "active", "matched"];
const LIVE_PROPERTY_STATUSES = ["live", "Yayında"];

export const talepArz = defineReport({
  id: "talep-arz",
  title: "Talep-arz dengesi (ilçe bazında)",
  description: "İlçe bazında dönem içinde açılan açık talepler ile yayındaki portföy arzı, talep / arz oranı, medyan bütçe ve medyan fiyat.",
  category: "portfoy",
  scope: "tenant",
  module: "reports",
  keywords: ["arz", "talep", "denge", "fırsat", "bölge"],
  filters: [
    { kind: "select", key: "islem", label: "İşlem", options: [{ value: "Satılık", label: "Satılık" }, { value: "Kiralık", label: "Kiralık" }] },
    { kind: "select", key: "donem", label: "Talep dönemi", options: [{ value: "30", label: "Son 30 gün" }, { value: "90", label: "Son 90 gün" }, { value: "365", label: "Son 365 gün" }] },
  ],
  columns: [
    { key: "il", label: "İl", type: "text", width: 16, get: (r) => r.provinceName },
    { key: "ilce", label: "İlçe", type: "text", width: 20, get: (r) => r.districtName },
    { key: "talep", label: "Açık talep", type: "number", total: true, get: (r) => r.demandCount },
    { key: "arz", label: "Yayındaki portföy", type: "number", total: true, get: (r) => r.supplyCount },
    { key: "oran", label: "Arz / talep oranı", type: "number", decimals: 1, get: (r) => r.ratio },
    { key: "butce", label: "Medyan bütçe", type: "money", decimals: 0, get: (r) => r.medianBudget },
    { key: "fiyat", label: "Medyan liste fiyatı", type: "money", decimals: 0, get: (r) => r.medianPrice },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const days = [30, 90, 365].includes(Number(f.donem)) ? Number(f.donem) : 90;
      const windowIso = daysAgoIso(days);
      // İl / ilçe referansı sunucu-yalnız okuyucudan (tembel yükleme: katalog sözleşme testlerinde yüklenmez).
      const { getDistrictNameMap, getProvinces } = await import("@/lib/geo/reader");
      const [dem, prop, provinces] = await Promise.all([
        fetchAllRows<Row>((from, to) => {
          let q = ctx.supabase.from("customer_demands").select("id, province_id, district_id, budget_min, budget_max").eq("tenant_id", tid(ctx)).in("status", OPEN_DEMAND_STATUSES).gte("created_at", windowIso);
          q = ctx.sample.apply(q);
          if (f.islem) q = q.eq("transaction_type", f.islem);
          return q.order("id", { ascending: true }).range(from, to);
        }),
        fetchAllRows<Row>((from, to) => {
          let q = ctx.supabase.from("properties").select("id, province_id, district_id, list_price").eq("tenant_id", tid(ctx)).is("deleted_at", null).in("status", LIVE_PROPERTY_STATUSES);
          q = ctx.sample.apply(q);
          if (f.islem) q = q.eq("transaction_type", f.islem);
          return q.order("id", { ascending: true }).range(from, to);
        }),
        getProvinces(),
      ]);
      if (dem.error || prop.error) throw new Error("talep-arz okunamadı");
      const agg = aggregateTalepArz(dem.data as TalepArzDemandRow[], prop.data as TalepArzPropertyRow[]);
      const provinceById = new Map(provinces.map((p) => [p.id, p.name]));
      const districtIds = [...new Set([...agg.values()].map((a) => a.districtId).filter((x): x is string => Boolean(x)))];
      const districts = districtIds.length ? await getDistrictNameMap(districtIds) : new Map<string, string>();
      return [...agg.values()]
        .map((a) => ({
          provinceName: provinceById.get(a.provinceId) ?? "Bilinmeyen il",
          districtName: a.districtId ? (districts.get(a.districtId) ?? "Bilinmeyen ilçe") : "(İlçe belirtilmedi)",
          demandCount: a.demandCount,
          supplyCount: a.supplyCount,
          ratio: a.demandCount > 0 ? a.supplyCount / a.demandCount : null,
          medianBudget: median(a.budgets),
          medianPrice: median(a.prices),
        }))
        .sort((a, b) => b.demandCount - a.demandCount || b.supplyCount - a.supplyCount || compareTr(a.districtName, b.districtName));
    },
  },
});

export const bolgeAnalizi = defineReport({
  id: "bolge-analizi",
  title: "Bölge analizi (ilçe fiyat ve satış hızı)",
  description: "İlçe bazında medyan m² fiyatı, listede kalma süresi, kapanan işlem hacmi ve fiyat değişimi (kendi portföy verinizden).",
  category: "portfoy",
  scope: "tenant",
  module: "reports",
  keywords: ["m2 fiyatı", "ilçe", "piyasa", "bölge", "medyan"],
  filters: [
    { kind: "select", key: "tx", label: "İşlem", options: [{ value: "Satılık", label: "Satılık" }, { value: "Kiralık", label: "Kiralık" }] },
    { kind: "select", key: "months", label: "Dönem", options: [{ value: "3", label: "Son 3 ay" }, { value: "6", label: "Son 6 ay" }, { value: "12", label: "Son 12 ay" }, { value: "24", label: "Son 24 ay" }] },
  ],
  columns: [
    { key: "il", label: "İl", type: "text", width: 16, get: (r) => r.province_name },
    { key: "ilce", label: "İlçe", type: "text", width: 20, get: (r) => r.district_name },
    { key: "aktif", label: "Aktif portföy", type: "number", total: true, get: (r) => r.active_count },
    { key: "toplam", label: "Toplam portföy", type: "number", total: true, get: (r) => r.total_count },
    { key: "medyan", label: "Medyan m² fiyatı", type: "money", decimals: 0, get: (r) => r.median_sqm_price },
    { key: "min", label: "En düşük m² fiyatı", type: "money", decimals: 0, get: (r) => r.min_sqm_price },
    { key: "max", label: "En yüksek m² fiyatı", type: "money", decimals: 0, get: (r) => r.max_sqm_price },
    { key: "gun", label: "Ort. listede kalma (gün)", type: "number", get: (r) => (r.avg_days_listed == null ? null : Math.round(Number(r.avg_days_listed))) },
    { key: "kapanan", label: "Kapanan işlem", type: "number", total: true, get: (r) => r.closed_count },
    { key: "kapananTutar", label: "Kapanan tutar", type: "money", decimals: 0, total: true, get: (r) => r.closed_value },
    { key: "degisim", label: "Fiyat değişimi", type: "percent", get: (r) => r.price_change_pct },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const months = [3, 6, 12, 24].includes(Number(f.months)) ? Number(f.months) : 12;
      const { data, error } = await ctx.supabase.rpc("region_stats", { p_tenant_id: tid(ctx), p_transaction_type: f.tx ?? null, p_months_back: months });
      if (error) throw error;
      return ((data ?? []) as Row[]).map((r) => ({
        ...r,
        median_sqm_price: r.median_sqm_price != null ? Number(r.median_sqm_price) : null,
        min_sqm_price: r.min_sqm_price != null ? Number(r.min_sqm_price) : null,
        max_sqm_price: r.max_sqm_price != null ? Number(r.max_sqm_price) : null,
        closed_value: Number(r.closed_value ?? 0),
        price_change_pct: r.price_change_pct != null ? Number(r.price_change_pct) : null,
      }));
    },
  },
});

export const ANALYSIS_REPORTS = [adayHizi, talepArz, bolgeAnalizi];
