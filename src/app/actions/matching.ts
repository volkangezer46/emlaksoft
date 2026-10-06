"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";
import { insertPropertyShareLink } from "@/lib/share-links";
import { buildMatchShareMessage, toSmsHref } from "@/lib/match-share-message";
import { toWhatsAppLink } from "@/lib/phone";

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
        "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer_id, customer:customers!customer_demands_customer_id_fkey(full_name)",
      )
      .eq("id", demandId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    supabase
      .from("properties")
      .select(
        "id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, neighborhood_id, features, assigned_to",
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
    neighborhood_id: demand.neighborhood_id,
    criteria: demand.criteria,
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
    neighborhood_id: property.neighborhood_id,
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

export type SendMatchResult =
  | { error: string }
  | { ok: true; url: string; message: string; whatsappHref: string | null; smsHref: string | null; hasPhone: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eşleşmeyi müşteriye tek tıkla gönder: token'lı paylaşım bağlantısı (share_links, 30 gün; portföy detayıyla AYNI yardımcı)
 * + hazır WhatsApp/SMS metni. Gönderim danışmanın kendi telefonundan yapılır (wa.me / sms:); "önerildi" kaydı denetim
 * günlüğüne (`match.sent`, müşteri zaman çizelgesinde görünür). Örnek portföy/müşteri paylaşılamaz (public sayfa göstermez).
 */
export async function sendMatchToCustomer(formData: FormData): Promise<SendMatchResult> {
  const gate = await requirePermission("matching", "create");
  if (!gate.ok) return { error: gate.error };
  // share_links INSERT RLS'i properties:edit ister: uygulama kapısı aynı kuralı önce söyler (RLS yine son söz).
  const shareGate = await requirePermission("properties", "edit");
  if (!shareGate.ok) return { error: "Paylaşım bağlantısı için portföy düzenleme yetkisi gerekir." };
  const demandId = String(formData.get("demand_id") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!UUID.test(demandId) || !UUID.test(propertyId)) return { error: "Talep ve portföy zorunlu." };

  const supabase = await createClient();
  const [{ data: demand }, { data: property }, { data: me }, { data: tenant }] = await Promise.all([
    supabase
      .from("customer_demands")
      .select("id, customer_id, customer:customers!customer_demands_customer_id_fkey(id, full_name, phone, is_sample, blacklist)")
      .eq("id", demandId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, is_sample")
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", gate.userId).maybeSingle(),
    supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle(),
  ]);
  if (!demand || !property) return { error: "Kayıt bulunamadı." };
  type Cust = { id: string; full_name: string | null; phone: string | null; is_sample?: boolean | null; blacklist?: boolean | null };
  const custRel = demand.customer as Cust | Cust[] | null;
  const customer = Array.isArray(custRel) ? custRel[0] : custRel;
  if (property.is_sample) return { error: "Örnek portföy müşteriye gönderilemez." };
  if (customer?.blacklist) return { error: "Bu müşteri iletişim engelli listesinde." };

  const link = await insertPropertyShareLink(supabase, {
    tenantId: gate.tenantId,
    userId: gate.userId,
    propertyId,
    label: `Eşleşme · ${customer?.full_name ?? "müşteri"}`,
  });
  if (!link.ok) return { error: "Paylaşım bağlantısı oluşturulamadı." };

  const message = buildMatchShareMessage({
    customerName: customer?.full_name ?? null,
    propertyTitle: (property.title as string | null) ?? null,
    propertyCode: (property.property_code as string | null) ?? null,
    listPrice: property.list_price != null ? Number(property.list_price) : null,
    url: link.url,
    advisorName: (me?.full_name as string | null | undefined) ?? null,
    officeName: (tenant?.name as string | null | undefined) ?? null,
  });
  const phone = customer?.phone ?? null;

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "match.sent",
    entityType: "customer",
    entityId: customer?.id ?? demand.customer_id ?? demandId,
    newValue: { demand_id: demandId, property_id: propertyId, property_code: property.property_code, share_token: link.token },
  });
  if (customer?.id) revalidatePath(`/app/musteriler/${customer.id}`);
  return { ok: true, url: link.url, message, whatsappHref: toWhatsAppLink(phone, message), smsHref: toSmsHref(phone, message), hasPhone: Boolean(phone) };
}
