"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { estimateMultiSourceValue } from "@/lib/valuation";

export type ValuationResult = { error?: string; ok?: boolean; id?: string };

export async function createValuation(formData: FormData): Promise<ValuationResult> {
  const gate = await requirePermission("valuation", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(formData.get("property_id") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  const listPriceRaw = String(formData.get("list_price") ?? "").replace(/[^\d.,]/g, "");
  const listPrice = listPriceRaw ? Number(listPriceRaw.replace(/\./g, "").replace(",", ".")) : null;
  const sqmRaw = String(formData.get("sqm") ?? "").trim();
  const sqm = sqmRaw ? Number(sqmRaw.replace(",", ".")) : null;
  const districtHint = String(formData.get("district") ?? "").trim();
  const provinceHint = String(formData.get("province") ?? "").trim();
  const ada = String(formData.get("ada") ?? "").trim();
  const parsel = String(formData.get("parsel") ?? "").trim();

  if (!title && !propertyId) return { error: "Başlık veya portföy zorunlu." };

  const supabase = await createClient();
  let resolvedTitle = title;
  let price = listPrice;
  let area = sqm;
  let provinceName = provinceHint || null;
  let adaVal = ada || null;
  let parselVal = parsel || null;

  if (propertyId) {
    const { data: p } = await supabase
      .from("properties")
      .select("title, property_code, list_price, features, parcel_block, parcel_lot, province:geo_provinces(name)")
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
      const provinceRel = p.province as { name?: string } | { name?: string }[] | null;
      const pName = Array.isArray(provinceRel) ? provinceRel[0]?.name : provinceRel?.name;
      provinceName = provinceName ?? pName ?? null;
    }
  }

  const est = await estimateMultiSourceValue({
    listPrice: price,
    sqm: area,
    districtHint: districtHint || null,
    provinceName,
    ada: adaVal,
    parsel: parselVal,
  });

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
      sources: est.sources,
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
