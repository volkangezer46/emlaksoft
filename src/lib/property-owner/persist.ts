import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { phoneLookupVariants } from "@/lib/duplicate-match";
import { evaluateOwnerInfo, isMissingSchemaError, ownerInfoToNote, type OwnerInfoEvaluation, type OwnerInfoInput } from "./info";

export type SaveOwnerInfoResult = {
  customerId: string | null;
  /** property_owner_info satırı yazıldı mı (false: şema yok veya hata; özet müşteri notuna düştü). */
  stored: boolean;
  evaluation: OwnerInfoEvaluation;
  error?: string;
  /** Aynı telefonlu mevcut müşteriye bağlandı (yeni kayıt açılmadı): "mevcut müşteriye bağlandı: <ad>". */
  linkedExisting?: { id: string; name: string };
};

/** Aynı telefonla kayıtlı (silinmemiş) ilk müşteri; yoksa ya da hata olursa null (yeni kayıt açılır). */
async function findCustomerByPhone(db: SupabaseClient, tenantId: string, phoneStored: string): Promise<{ id: string; name: string } | null> {
  const variants = phoneLookupVariants(phoneStored);
  if (variants.length === 0) return null;
  const { data, error } = await db
    .from("customers")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .in("phone", variants)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error || !data?.[0]) return null;
  const row = data[0] as { id: string; full_name: string | null };
  return { id: String(row.id), name: row.full_name ?? "" };
}

/**
 * İlan sahibini müşteri kaydına bağlar ve ayrıntıları yazar (oturumlu istemci: RLS geçerli).
 *  - Mevcut müşteri seçildiyse aynen bağlanır. Seçilmediyse ve AYNI TELEFONLU müşteri varsa ona bağlanır (B092: ilan
 *    sahibi yolu ikinci müşteri açmaz; sonuç `linkedExisting`); yoksa ad girilmişse YENİ müşteri açılır (tür "Mülk sahibi").
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
  let linkedExisting: { id: string; name: string } | undefined;
  const evaluation = evaluateOwnerInfo({ ...info, ownerPhone: info.ownerPhone || input.phoneStored });

  if (!customerId && input.phoneStored) {
    const existing = await findCustomerByPhone(db, input.tenantId, input.phoneStored);
    if (existing) {
      customerId = existing.id;
      linkedExisting = existing;
    }
  }

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
  const linked = linkedExisting ? { linkedExisting } : {};
  const { error } = await db.from("property_owner_info").insert(row);
  if (!error) return { customerId, stored: true, evaluation, ...linked };

  if (!isMissingSchemaError(error)) {
    console.error("saveOwnerInfo row", { code: error.code });
    return { customerId, stored: false, evaluation, error: "İlan sahibi ayrıntıları kaydedilemedi.", ...linked };
  }
  // Şema yok: ayrıntılar yeni müşterinin notuna düşer (mevcut müşterinin notuna dokunulmaz).
  if (createdCustomer && customerId) {
    await db
      .from("customers")
      .update({ notes: ownerInfoToNote(info, evaluation, input.propertyCode) })
      .eq("id", customerId)
      .eq("tenant_id", input.tenantId);
  }
  return { customerId, stored: false, evaluation, ...linked };
}
