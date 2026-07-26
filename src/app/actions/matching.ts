"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";

export type MatchActionResult = { error?: string; ok?: boolean; score?: number };

/** Eşleşmeyi kaydet: talebi matched yap + bildirim + audit */
export async function saveMatchAndNotify(formData: FormData): Promise<MatchActionResult> {
  const gate = await requirePermission("matching", "create");
  if (!gate.ok) return { error: gate.error };

  const demandId = String(formData.get("demand_id") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!demandId || !propertyId) return { error: "Talep ve portföy zorunlu." };

  const supabase = await createClient();
  // Ofise özel ağırlıklar — eşleştirme sayfasıyla aynı skor için tek ek sorgu.
  const [{ data: demand }, { data: property }, weights] = await Promise.all([
    supabase
      .from("customer_demands")
      .select(
        "id, transaction_type, property_type, province_id, district_id, budget_min, budget_max, rooms, min_sqm, urgency, status, customer_id, customer:customers(full_name)",
      )
      .eq("id", demandId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    supabase
      .from("properties")
      .select(
        "id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features, assigned_to",
      )
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    fetchTenantMatchingWeights(supabase, gate.tenantId),
  ]);

  if (!demand || !property) return { error: "Kayıt bulunamadı." };

  const matchDemand: MatchDemand = {
    id: demand.id,
    transaction_type: demand.transaction_type,
    property_type: demand.property_type,
    province_id: demand.province_id,
    district_id: demand.district_id,
    budget_min: demand.budget_min != null ? Number(demand.budget_min) : null,
    budget_max: demand.budget_max != null ? Number(demand.budget_max) : null,
    rooms: demand.rooms,
    min_sqm: demand.min_sqm != null ? Number(demand.min_sqm) : null,
    urgency: demand.urgency,
    status: demand.status,
  };
  const matchProperty: MatchProperty = {
    id: property.id,
    property_code: property.property_code,
    title: property.title,
    transaction_type: property.transaction_type,
    property_type: property.property_type,
    status: property.status,
    list_price: property.list_price != null ? Number(property.list_price) : null,
    province_id: property.province_id,
    district_id: property.district_id,
    features: (property.features ?? {}) as MatchProperty["features"],
  };

  const scored = scoreDemandProperty(matchDemand, matchProperty, weights);

  const { error: updateError } = await supabase
    .from("customer_demands")
    .update({ status: "matched" })
    .eq("id", demandId)
    .eq("tenant_id", gate.tenantId);
  if (updateError) {
    console.error("saveMatch update", updateError);
    return { error: "Eşleştirme kaydedilemedi. Lütfen tekrar deneyin." };
  }

  const cust = demand.customer as { full_name?: string } | { full_name?: string }[] | null;
  const custName = Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name;

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "match.save",
    entityType: "customer_demand",
    entityId: demandId,
    newValue: {
      property_id: propertyId,
      property_code: property.property_code,
      score: scored.score,
      tier: scored.tier,
    },
  });

  await notifyTenant({
    tenantId: gate.tenantId,
    title: "Eşleştirme kaydedildi",
    body: `${custName ?? "Müşteri"} × ${property.property_code} · skor ${scored.score}`,
    href: `/app/eslestirme?demand=${demandId}&property=${propertyId}`,
    kind: "success",
    userId: property.assigned_to ?? undefined,
  });

  revalidatePath("/app/eslestirme");
  revalidatePath("/app/talepler");
  if (demand.customer_id) revalidatePath(`/app/musteriler/${demand.customer_id}`);
  return { ok: true, score: scored.score };
}
