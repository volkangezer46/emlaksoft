"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { afterSafe } from "@/lib/after-safe";
import { actionErrorMessage } from "@/lib/action-errors";
import { isMissingRelationError } from "@/lib/customer-contacts";
import { isRelationKind, RELATION_LABELS } from "@/lib/customer-relations";

export type CustomerRelationResult = { ok?: boolean; error?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING = "İlişkili kişiler için veritabanı güncellemesi henüz uygulanmamış.";

/**
 * İki müşteri arasında ilişki kurar (CRM-G8): "<ilişkili kişi>, bu müşterinin <ilişki>sidir". `customers:edit` kapısı;
 * iki kayıt da bu ofiste ve oturuma görünür olmalı (RLS). Aynı çift için tek satır: ters yönden ikinci kayıt reddedilir.
 */
export async function addCustomerRelation(_prev: CustomerRelationResult, formData: FormData): Promise<CustomerRelationResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const relatedId = String(formData.get("related_customer_id") ?? "").trim();
  const relation = String(formData.get("relation") ?? "").trim();
  const note = String(formData.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  if (!UUID_RE.test(customerId)) return { error: "Müşteri bulunamadı." };
  if (!UUID_RE.test(relatedId)) return { error: "İlişkili kişiyi seçin." };
  if (customerId === relatedId) return { error: "Müşteri kendisiyle ilişkilendirilemez." };
  if (!isRelationKind(relation)) return { error: "İlişki türünü seçin." };

  const supabase = await createClient();
  const { data: people } = await supabase
    .from("customers")
    .select("id, full_name")
    .in("id", [customerId, relatedId])
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null);
  if ((people ?? []).length !== 2) return { error: "Kayıtlardan biri bulunamadı ya da görüntüleme yetkiniz yok." };

  const { data, error } = await supabase
    .from("customer_relations")
    .insert({ tenant_id: gate.tenantId, customer_id: customerId, related_customer_id: relatedId, relation, note, created_by: gate.userId })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingRelationError(error)) return { error: PENDING };
    if (error?.code === "23505") return { error: "Bu iki kişi arasında zaten bir ilişki kayıtlı." };
    console.error("addCustomerRelation", { code: error?.code });
    return { error: actionErrorMessage(error, "İlişki kaydedilemedi.") };
  }
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.relation_add",
    entityType: "customer",
    entityId: customerId,
    newValue: { related_customer_id: relatedId, relation: RELATION_LABELS[relation] },
  }));
  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath(`/app/musteriler/${relatedId}`);
  return { ok: true, id: data.id };
}

/** İlişkiyi kaldırır (iki kart da güncellenir). Müşteri kayıtları silinmez. */
export async function removeCustomerRelation(relationId: string): Promise<CustomerRelationResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(relationId ?? ""))) return { error: "Kayıt bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_relations")
    .delete()
    .eq("id", relationId)
    .eq("tenant_id", gate.tenantId)
    .select("customer_id, related_customer_id")
    .maybeSingle();
  if (error) return { error: isMissingRelationError(error) ? PENDING : actionErrorMessage(error, "Kaldırılamadı.") };
  if (!data) return { error: "Kayıt bulunamadı." };
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.relation_remove",
    entityType: "customer",
    entityId: data.customer_id as string,
    oldValue: { related_customer_id: data.related_customer_id },
  }));
  revalidatePath(`/app/musteriler/${data.customer_id}`);
  revalidatePath(`/app/musteriler/${data.related_customer_id}`);
  return { ok: true };
}
