import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { evaluateOwnerInfo, isMissingSchemaError, ownerInfoToNote, type OwnerInfoEvaluation, type OwnerInfoInput } from "./info";

export type SaveOwnerInfoResult = {
  customerId: string | null;
  /** property_owner_info satırı yazıldı mı (false: şema yok veya hata; özet müşteri notuna düştü). */
  stored: boolean;
  evaluation: OwnerInfoEvaluation;
  error?: string;
};

/**
 * İlan sahibini müşteri kaydına bağlar ve ayrıntıları yazar (oturumlu istemci: RLS geçerli).
 *  - Mevcut müşteri seçildiyse aynen bağlanır; seçilmediyse ad girilmişse YENİ müşteri açılır (tür "Mülk sahibi").
 *  - Telefon `phoneStored` (parsePhoneStrict çıktısı) olarak gelir; ham telefon DB'ye gitmez.
 *  - property_owner_info yoksa (migration uygulanmamış) özet yeni müşterinin notuna yazılır; ilan akışı bozulmaz.
 */
export async function saveOwnerInfo(
  db: SupabaseClient,
  input: {
    tenantId: string;
    userId: string;
    propertyId: string;
    propertyCode: string;
    info: OwnerInfoInput;
    phoneStored: string;
    emailNormalized: string;
    branchId: string | null;
  },
): Promise<SaveOwnerInfoResult> {
  const { info } = input;
  let customerId = info.ownerCustomerId || null;
  let createdCustomer = false;
  const evaluation = evaluateOwnerInfo({ ...info, ownerPhone: info.ownerPhone || input.phoneStored });

  if (!customerId && info.ownerName.trim()) {
    const { data, error } = await db
      .from("customers")
      .insert({
        tenant_id: input.tenantId,
        full_name: info.ownerName.trim(),
        phone: input.phoneStored || null,
        email: input.emailNormalized || null,
        customer_types: ["Mülk sahibi"],
        source: info.listingSource || null,
        branch_id: input.branchId,
        assigned_to: input.userId,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("saveOwnerInfo customer", { code: error?.code });
      return { customerId: null, stored: false, evaluation, error: "İlan sahibi müşteri kaydı açılamadı." };
    }
    customerId = String((data as { id: string }).id);
    createdCustomer = true;
  }

  const row = {
    tenant_id: input.tenantId,
    property_id: input.propertyId,
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
    consent_at: info.kvkkConsent ? new Date(now()).toISOString() : null,
    completeness: evaluation.score,
    is_complete: evaluation.complete,
    created_by: input.userId,
  };
  const { error } = await db.from("property_owner_info").insert(row);
  if (!error) return { customerId, stored: true, evaluation };

  if (!isMissingSchemaError(error)) {
    console.error("saveOwnerInfo row", { code: error.code });
    return { customerId, stored: false, evaluation, error: "İlan sahibi ayrıntıları kaydedilemedi." };
  }
  // Şema yok: ayrıntılar yeni müşterinin notuna düşer (mevcut müşterinin notuna dokunulmaz).
  if (createdCustomer && customerId) {
    await db
      .from("customers")
      .update({ notes: ownerInfoToNote(info, evaluation, input.propertyCode) })
      .eq("id", customerId)
      .eq("tenant_id", input.tenantId);
  }
  return { customerId, stored: false, evaluation };
}
