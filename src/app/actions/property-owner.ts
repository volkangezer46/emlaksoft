"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { revalidateTenantData } from "@/lib/revalidate";
import { now } from "@/lib/clock";
import { evaluateOwnerInfo, isMissingSchemaError, parseOwnerInfoForm } from "@/lib/property-owner/info";

export type OwnerInfoResult = { ok?: boolean; error?: string; score?: number; missing?: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * İlan sahibi bilgilerini günceller / tamamlar (bilgi tamamlama puanını yeniden hesaplar).
 * Kapsam: ofis yönetimi her ilanı, diğer danışmanlar yalnız kendi ilanını günceller (RLS + güncellenen satır sayısı kontrolü).
 * Müşteri bağı yalnız MEVCUT bir müşteriye kurulabilir veya değiştirilebilir (yeni müşteri açma ilan oluşturma formundadır).
 */
export async function updatePropertyOwnerInfo(propertyId: string, formData: FormData): Promise<OwnerInfoResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(propertyId)) return { error: "İlan bulunamadı." };

  const parsed = parseOwnerInfoForm((n) => {
    const v = formData.get(n);
    return typeof v === "string" ? v : null;
  });
  if (parsed.error) return { error: parsed.error };
  const info = parsed.value;

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id, list_price")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!property) return { error: "İlan bulunamadı." };
  const listPrice = Number((property as { list_price?: number | null }).list_price ?? 0);
  if (info.minPrice != null && listPrice > 0 && info.minPrice > listPrice) {
    return { error: "Minimum fiyat liste fiyatından yüksek olamaz." };
  }

  let customerPhone = false;
  if (info.ownerCustomerId) {
    if (!UUID_RE.test(info.ownerCustomerId)) return { error: "Geçersiz müşteri." };
    const { data: customer } = await supabase
      .from("customers")
      .select("id, phone")
      .eq("id", info.ownerCustomerId)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!customer) return { error: "Seçilen müşteri bulunamadı." };
    customerPhone = Boolean((customer as { phone?: string | null }).phone);
  }

  const { data: existing, error: readError } = await supabase
    .from("property_owner_info")
    .select("id, customer_id, kvkk_consent")
    .eq("tenant_id", gate.tenantId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (readError) {
    return {
      error: isMissingSchemaError(readError)
        ? "İlan sahibi ayrıntı kaydı henüz etkin değil (veritabanı güncellemesi bekleniyor)."
        : "İlan sahibi bilgisi okunamadı.",
    };
  }
  const prev = existing as { id: string; customer_id: string | null; kvkk_consent: boolean } | null;
  const customerId = info.ownerCustomerId || prev?.customer_id || null;
  if (customerId && !info.ownerCustomerId) {
    // Form müşteri göndermedi: mevcut bağlı müşterinin telefonu karşılar mı?
    const { data: linked } = await supabase.from("customers").select("phone").eq("id", customerId).eq("tenant_id", gate.tenantId).maybeSingle();
    customerPhone = Boolean((linked as { phone?: string | null } | null)?.phone);
  }
  const evalFinal = evaluateOwnerInfo({ ...info, ownerCustomerId: customerId ?? "", existingOwnerHasPhone: customerPhone });

  const row = {
    tenant_id: gate.tenantId,
    property_id: propertyId,
    customer_id: customerId,
    relation: info.relation || null,
    deed_status: info.deedStatus || null,
    deed_note: info.deedNote || null,
    commission_kind: info.commissionKind || null,
    negotiation_margin_pct: info.negotiationMarginPct,
    listing_source: info.listingSource || null,
    customer_notes: info.customerNotes || null,
    contact_history: info.contactHistory || null,
    kvkk_consent: info.kvkkConsent,
    contact_permission: info.contactPermission,
    // Onay ilk kez verildiyse zaman damgası yazılır; geri alınırsa temizlenir.
    ...(info.kvkkConsent && !prev?.kvkk_consent ? { consent_at: new Date(now()).toISOString() } : {}),
    ...(!info.kvkkConsent ? { consent_at: null } : {}),
    completeness: evalFinal.score,
    is_complete: evalFinal.complete,
  };

  const { data: written, error } = prev
    ? await supabase.from("property_owner_info").update(row).eq("id", prev.id).eq("tenant_id", gate.tenantId).select("id")
    : await supabase.from("property_owner_info").insert({ ...row, created_by: gate.userId }).select("id");
  if (error || !written?.length) {
    if (error) console.error("updatePropertyOwnerInfo", { code: error.code });
    return { error: "İlan sahibi bilgisi kaydedilemedi (bu ilan için yetkiniz olmayabilir)." };
  }

  // Yetki sözleşmesi ve minimum fiyat mevcut properties sütunlarındadır.
  const { error: propError } = await supabase
    .from("properties")
    .update({
      min_price: info.minPrice,
      authorization_type: info.authorizationType || null,
      authorization_start: info.authorizationStart || null,
      authorization_end: info.authorizationEnd || null,
    })
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId);
  if (propError) {
    console.error("updatePropertyOwnerInfo property", { code: propError.code });
    return { error: "Yetki bilgileri kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.owner_info.update",
    entityType: "property",
    entityId: propertyId,
    newValue: { completeness: evalFinal.score, complete: evalFinal.complete },
  });
  revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidatePath("/app/portfoyler");
  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  revalidateTenantData(gate.tenantId);
  return { ok: true, score: evalFinal.score, missing: evalFinal.missing.map((m) => m.label) };
}
