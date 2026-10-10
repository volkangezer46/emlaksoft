import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { estimateFromComparables } from "@/lib/comparables";
import { getEndeksForPlace } from "@/lib/integrations/emlakfiyati/client";
import { mapPropertyTypeToTip, isRentTransaction } from "@/lib/integrations/emlakfiyati/contract";
import { computeListingAnalysis, analysisInputKey, isAnalysisFresh, type AnalysisInput, type ListingAnalysisResult } from "@/lib/listing-analysis";
import { loadPhotoQuality } from "@/lib/photo-quality/load";
import { readVirtualTour } from "@/lib/virtual-tour";

/**
 * İLAN ANALİZİ — orkestrasyon. KONTÖRSÜZ (sahip kararı 2026-10-10: kontör yalnız değerleme için harcanır).
 *
 * Akış: portföy (RLS + tenant) → 24 saatlik önbellek (aynı girdi = aynı sonuç) → hesap (emsal yoksa DUR) → sonucu yaz.
 * Hesap saf (`src/lib/listing-analysis.ts`); burada yalnız veri toplanır. Yetki/hız sınırı çağıran action'dadır
 * (`actions/listing-analysis.ts`). Kişisel veri yazılmaz (malik/telefon yok). Tablo yoksa (şema) özellik kapalı kalır.
 */

export type ListingAnalysisStored = { result: ListingAnalysisResult; createdAt: string; unitsCharged: number };

export type ListingAnalysisOutcome =
  | ({ status: "ok"; cached: boolean; settlementPending: boolean } & ListingAnalysisStored)
  | { status: "no_comps"; message: string }
  | { status: "disabled"; message: string }
  | { status: "not_found" }
  | { status: "error"; message: string };

export const LISTING_ANALYSIS_NOT_ENABLED = "İlan analizi henüz etkinleştirilmedi.";
export const LISTING_ANALYSIS_NO_COMPS = "Yeterli emsal yok: bu ilan için güvenilir bir karşılaştırma kurulamadı.";
const RETRY_MESSAGE = "Analiz şu an kaydedilemedi. Lütfen tekrar deneyin.";

type Row = { id: string; result: unknown; units_charged: number; input_key: string; created_at: string };

function isResult(v: unknown): v is ListingAnalysisResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<ListingAnalysisResult>;
  return r.version === 1 && typeof r.listPrice === "number" && !!r.position && !!r.comps && Array.isArray(r.checklist);
}

/** Portföyün en son analizi (yaşına bakmaz; kart "dün yapıldı" diye gösterir). Tablo yok/okunamıyor → null. */
export async function readLatestListingAnalysis(supabase: SupabaseClient, tenantId: string, propertyId: string): Promise<(ListingAnalysisStored & { inputKey: string }) | null> {
  const { data, error } = await supabase
    .from("listing_analyses")
    .select("id, result, units_charged, input_key, created_at")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Row;
  if (!isResult(row.result)) return null;
  return { result: row.result, createdAt: row.created_at, unitsCharged: row.units_charged, inputKey: row.input_key };
}

type PropertyRow = {
  id: string;
  title: string | null;
  status: string;
  transaction_type: string | null;
  property_type: string | null;
  list_price: number | string | null;
  district_id: string | null;
  address_line: string | null;
  lat: number | null;
  lng: number | null;
  features: Record<string, unknown> | null;
  published_at: string | null;
  created_at: string;
  province: { name: string | null } | { name: string | null }[] | null;
  district: { name: string | null } | { name: string | null }[] | null;
};

function relName(v: PropertyRow["province"]): string | null {
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
}


export async function runListingAnalysis(p: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  propertyId: string;
}): Promise<ListingAnalysisOutcome> {
  const { supabase, tenantId, userId, propertyId } = p;
  const { data: propData, error: propErr } = await supabase
    .from("properties")
    .select(
      "id, title, status, transaction_type, property_type, list_price, district_id, address_line, lat, lng, features, published_at, created_at, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (propErr || !propData) return { status: "not_found" };
  const prop = propData as unknown as PropertyRow;

  const listPrice = num(prop.list_price);
  const features = (prop.features ?? {}) as Record<string, unknown>;
  const sqm = num(features.sqm);
  const inputKey = analysisInputKey({ listPrice, sqm, districtId: prop.district_id, propertyType: prop.property_type, transactionType: prop.transaction_type });

  // 24 saat önbellek: tablo okunamıyorsa (şema yok) özellik kapalı.
  const probe = await supabase.from("listing_analyses").select("id", { head: true, count: "exact" }).eq("tenant_id", tenantId).eq("property_id", propertyId);
  if (probe.error) return { status: "disabled", message: LISTING_ANALYSIS_NOT_ENABLED };
  const cached = await readLatestListingAnalysis(supabase, tenantId, propertyId);
  if (cached && cached.inputKey === inputKey && isAnalysisFresh(Date.parse(cached.createdAt), now())) {
    return { status: "ok", cached: true, settlementPending: false, result: cached.result, createdAt: cached.createdAt, unitsCharged: 0 };
  }

  const computed = await buildAnalysis(supabase, tenantId, prop, { listPrice, sqm, features });
  if (!computed) return { status: "no_comps", message: LISTING_ANALYSIS_NO_COMPS };

  const { data: ins, error: insErr } = await supabase
    .from("listing_analyses")
    .insert({ tenant_id: tenantId, property_id: propertyId, user_id: userId, input_key: inputKey, result: computed, units_charged: 0, reservation_id: null })
    .select("created_at")
    .single();
  if (insErr || !ins) return { status: "error", message: RETRY_MESSAGE };

  await logActivity({
    tenantId,
    actorId: userId,
    action: "ef.listing_analysis",
    entityType: "property",
    entityId: propertyId,
    newValue: { item: "listing_analysis", verdict: computed.position.verdict, confidence: computed.comps.confidence },
  });
  return { status: "ok", cached: false, settlementPending: false, result: computed, createdAt: (ins as { created_at: string }).created_at, unitsCharged: 0 };
}

/** Veri toplama + saf hesap. Emsal yoksa null (ücretlendirme yapılmaz). */
async function buildAnalysis(
  supabase: SupabaseClient,
  tenantId: string,
  prop: PropertyRow,
  base: { listPrice: number | null; sqm: number | null; features: Record<string, unknown> },
): Promise<ListingAnalysisResult | null> {
  const estimate = await estimateFromComparables(supabase, {
    tenantId,
    districtId: prop.district_id,
    propertyType: prop.property_type,
    transactionType: prop.transaction_type,
    sqm: base.sqm,
    excludePropertyId: prop.id,
    targetFloor: num(base.features.floor),
    targetBuildingAge: num(base.features.building_age),
    targetHeating: typeof base.features.heating === "string" ? base.features.heating : null,
    targetFacade: typeof base.features.facade === "string" ? base.features.facade : null,
  });
  // Emsal yoksa boşuna ek sorgu yapma.
  if (estimate.confidence === "yetersiz" || !estimate.estimatedValue || !base.listPrice) return null;

  const province = relName(prop.province);
  const district = relName(prop.district);
  const tip = mapPropertyTypeToTip(prop.property_type, prop.transaction_type);
  const txStat = /kira/i.test(prop.transaction_type ?? "") ? "Kiralık" : /sat/i.test(prop.transaction_type ?? "") ? "Satılık" : "Tümü";

  const [endeks, regionStat, photo] = await Promise.all([
    tip ? getEndeksForPlace({ province, district, tip }) : Promise.resolve(null),
    prop.district_id
      ? supabase.from("region_stats_history").select("avg_days_listed").eq("district_id", prop.district_id).eq("tx_type", txStat).order("period", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    loadPhotoQuality(supabase, prop.id),
  ]);

  const efSummary = endeks && endeks.status === "ok" && !endeks.summary.insufficient ? endeks.summary : null;
  const avg = (regionStat.data as { avg_days_listed?: number | null } | null)?.avg_days_listed;
  const published = Date.parse(prop.published_at ?? prop.created_at);
  const daysOnMarket = Number.isFinite(published) && prop.status === "live" ? Math.max(0, Math.floor((now() - published) / 86_400_000)) : null;

  const input: AnalysisInput = {
    listPrice: base.listPrice,
    sqm: base.sqm,
    estimate,
    efIndex: efSummary ? { ad: efSummary.ad, donem: efSummary.donem, n: efSummary.n, medianM2: efSummary.medianM2, guven: efSummary.guven } : null,
    regionAvgDaysListed: avg != null && Number(avg) > 0 ? Number(avg) : null,
    daysOnMarket,
    isRent: isRentTransaction(prop.transaction_type),
    quality: {
      title: prop.title,
      description: typeof base.features.description === "string" ? base.features.description : null,
      features: base.features,
      hasLocation: Boolean(prop.address_line) || (prop.lat != null && prop.lng != null),
      hasVirtualTour: readVirtualTour(base.features) !== null,
      photo: photo.enabled
        ? {
            photoCount: photo.report.photoCount,
            warned: photo.report.warned,
            passed: photo.report.passed,
            warnings: photo.report.checks.filter((c) => c.status === "warn").map((c) => c.title),
          }
        : null,
    },
  };
  return computeListingAnalysis(input);
}
