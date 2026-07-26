"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { estimateMultiSourceValue } from "@/lib/valuation";
import { comparablesSourceEntry, listComparableDetails } from "@/lib/comparables";

export type ValuationResult = { error?: string; ok?: boolean; id?: string };
export type ValuationShareResult = { error?: string; ok?: boolean; url?: string };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Değerleme raporu için public paylaşım linki üretir (/degerleme-raporu/[token]).
 *
 * İdempotent: token bir kez üretilir, tekrar basılınca AYNI link döner —
 * müşteriye gönderilmiş eski linki sessizce öldürmemek için. RLS'e dokunulmaz;
 * public sayfa token'ı service role ile çözer (paylas/[token] deseni).
 */
export async function generateValuationShareLink(id: string): Promise<ValuationShareResult> {
  const gate = await requirePermission("valuation", "view");
  if (!gate.ok) return { error: gate.error };
  const valuationId = String(id ?? "").trim();
  if (!valuationId) return { error: "Değerleme zorunlu." };

  const supabase = await createClient();
  const { data: valuation } = await supabase
    .from("valuations")
    .select("id, share_token")
    .eq("id", valuationId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!valuation) return { error: "Değerleme bulunamadı." };

  let token = (valuation.share_token as string | null) ?? null;
  if (!token) {
    token = randomUUID();
    const { error } = await supabase
      .from("valuations")
      .update({ share_token: token, shared_at: new Date().toISOString() })
      .eq("id", valuationId)
      .eq("tenant_id", gate.tenantId);
    if (error) {
      console.error("generateValuationShareLink", error);
      return { error: "Paylaşım linki oluşturulamadı." };
    }
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "valuation.share",
      entityType: "valuation",
      entityId: valuationId,
      newValue: { token },
    });
    revalidatePath(`/app/degerleme/${valuationId}`);
  }

  return { ok: true, url: `${appUrl()}/degerleme-raporu/${token}` };
}

export async function createValuation(formData: FormData): Promise<ValuationResult> {
  const gate = await requirePermission("valuation", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(formData.get("property_id") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  const listPriceRaw = String(formData.get("list_price") ?? "").replace(/[^\d.,]/g, "");
  const listPrice = listPriceRaw ? Number(listPriceRaw.replace(/\./g, "").replace(",", ".")) : null;
  const sqmRaw = String(formData.get("sqm") ?? "").trim();
  const sqm = sqmRaw ? Number(sqmRaw.replace(",", ".")) : null;
  // Onceden ilce SERBEST METIN ("Ilce ipucu") olarak aliniyordu; bu yuzden
  // `geo_districts` ile eslesemiyor ve emsal motoru yalnizca bir portfoy
  // secildiginde calisabiliyordu. Artik formdan gercek `district_id` geliyor.
  const formProvinceId = String(formData.get("province_id") ?? "").trim();
  const formDistrictId = String(formData.get("district_id") ?? "").trim();
  const formPropertyType = String(formData.get("property_type") ?? "").trim();
  const formTransactionType = String(formData.get("transaction_type") ?? "").trim();
  const ada = String(formData.get("ada") ?? "").trim();
  const parsel = String(formData.get("parsel") ?? "").trim();

  if (!title && !propertyId) return { error: "Başlık veya portföy zorunlu." };

  const supabase = await createClient();
  let resolvedTitle = title;
  let price = listPrice;
  let area = sqm;
  let provinceName: string | null = null;
  let districtHint: string | null = null;
  let adaVal = ada || null;
  let parselVal = parsel || null;

  // Emsal motoru icin gereken alanlar. Once formdaki secim, portfoy secildiyse
  // ondan gelen deger bosluklari tamamlar.
  let districtId: string | null = formDistrictId || null;
  let propertyType: string | null = formPropertyType || null;
  let transactionType: string | null = formTransactionType || null;

  // Form ilce/il secildiyse adlarini tek sorguda coz.
  if (formDistrictId) {
    const { data: d } = await supabase
      .from("geo_districts")
      .select("name, province:geo_provinces(name)")
      .eq("id", formDistrictId)
      .maybeSingle();
    if (d) {
      districtHint = d.name;
      const rel = d.province as { name?: string } | { name?: string }[] | null;
      provinceName = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null;
    }
  } else if (formProvinceId) {
    const { data: pr } = await supabase.from("geo_provinces").select("name").eq("id", formProvinceId).maybeSingle();
    provinceName = pr?.name ?? null;
  }

  if (propertyId) {
    const { data: p } = await supabase
      .from("properties")
      .select(
        "title, property_code, list_price, features, parcel_block, parcel_lot, district_id, property_type, transaction_type, province:geo_provinces(name)",
      )
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (p) {
      resolvedTitle = resolvedTitle || p.title || p.property_code;
      price = price ?? (p.list_price != null ? Number(p.list_price) : null);
      const feat = p.features as { sqm?: number } | null;
      area = area ?? (feat?.sqm != null ? Number(feat.sqm) : null);
      adaVal = adaVal ?? p.parcel_block ?? null;
      parselVal = parselVal ?? p.parcel_lot ?? null;
      // Formda secim yoksa portfoyden devral (?? ile: bos string degil, null kontrolu).
      districtId = districtId ?? p.district_id ?? null;
      propertyType = propertyType ?? p.property_type ?? null;
      transactionType = transactionType ?? p.transaction_type ?? null;
      const provinceRel = p.province as { name?: string } | { name?: string }[] | null;
      const pName = Array.isArray(provinceRel) ? provinceRel[0]?.name : provinceRel?.name;
      provinceName = provinceName ?? pName ?? null;
    }
  }

  const est = await estimateMultiSourceValue({
    listPrice: price,
    sqm: area,
    districtHint,
    provinceName,
    ada: adaVal,
    parsel: parselVal,
    // Yerli emsal motoru: kendi verimizden gerçek emsal analizi.
    // Portföy seçilmediyse ilçe/tip bilinmez ve motor sessizce devre dışı kalır.
    supabase,
    tenantId: gate.tenantId,
    districtId,
    propertyType,
    transactionType,
    excludePropertyId: propertyId,
  });

  // Emsal ANLIK GÖRÜNTÜSÜ: motorun kullandığı küme (aynı RPC zinciri) rapor
  // tablosu için kayda gömülür. Böylece rapor, aylar sonra açılsa bile
  // "o gün hangi emsaller vardı?" sorusuna kayıttan cevap verir; eski
  // kayıtlar için rapor sayfaları görüntüleme anında yeniden hesaplar.
  const compRows = await listComparableDetails(supabase, {
    tenantId: gate.tenantId,
    districtId,
    propertyType,
    transactionType,
    sqm: area,
    excludePropertyId: propertyId,
  });
  const sourcesToSave = compRows.length > 0 ? [...est.sources, comparablesSourceEntry(compRows)] : est.sources;

  const { data, error } = await supabase
    .from("valuations")
    .insert({
      tenant_id: gate.tenantId,
      property_id: propertyId,
      title: resolvedTitle || "Değerleme",
      estimated_low: est.low,
      estimated_mid: est.mid,
      estimated_high: est.high,
      confidence: est.confidence,
      sources: sourcesToSave,
      notes: est.notes,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createValuation", error);
    return { error: "Değerleme kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "valuation.create",
    entityType: "valuation",
    entityId: data.id,
    newValue: { mid: est.mid },
  });

  revalidatePath("/app/degerleme");
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: data.id };
}
