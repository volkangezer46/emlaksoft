"use server";

import type { ActionOutcome } from "@/lib/action-outcome";
import { actionErrorMessage } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

/**
 * Çöp kutusu geri alma işlemleri. Silme yetkisi olan geri de alabilir
 * (requirePermission delete). Kalıcı silme bilinçli olarak YOK — kayıtlar
 * deleted_at ile işaretli kalır.
 */
export function restoreCustomer(formData: FormData): Promise<ActionOutcome>;
/** Form eylemi olarak da verilebilir: React `<form action>` tipi void bekler, form sonucu yok sayar (bkz. action-outcome). */
export function restoreCustomer(formData: FormData): Promise<void>;
export async function restoreCustomer(formData: FormData): Promise<ActionOutcome | void> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Kayıt bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("restoreCustomer", error);
    return { error: actionErrorMessage(error, "Müşteri geri alınamadı.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.restore",
    entityType: "customer",
    entityId: id,
  });
  revalidatePath("/app/ayarlar/cop-kutusu");
  revalidatePath("/app/musteriler");
  return { ok: true };
}

export function restoreProperty(formData: FormData): Promise<ActionOutcome>;
/** Form eylemi olarak da verilebilir: React `<form action>` tipi void bekler, form sonucu yok sayar (bkz. action-outcome). */
export function restoreProperty(formData: FormData): Promise<void>;
export async function restoreProperty(formData: FormData): Promise<ActionOutcome | void> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Kayıt bulunamadı." };

  const supabase = await createClient();
  // Silme sırasında status "archived" yapılmıştı; eski durum bilinmediğinden
  // arşivde bırakılır — portföy arşivden tekrar aktifleştirilebilir.
  const { error } = await supabase
    .from("properties")
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("restoreProperty", error);
    return { error: actionErrorMessage(error, "Portföy geri alınamadı.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.restore",
    entityType: "property",
    entityId: id,
  });
  revalidatePath("/app/ayarlar/cop-kutusu");
  revalidatePath("/app/portfoyler");
  return { ok: true };
}
