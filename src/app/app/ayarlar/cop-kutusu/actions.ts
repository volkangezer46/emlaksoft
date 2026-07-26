"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

/**
 * Çöp kutusu geri alma işlemleri. Silme yetkisi olan geri de alabilir
 * (requirePermission delete). Kalıcı silme bilinçli olarak YOK — kayıtlar
 * deleted_at ile işaretli kalır.
 */
export async function restoreCustomer(formData: FormData): Promise<void> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("restoreCustomer", error);
    return;
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
}

export async function restoreProperty(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

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
    return;
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
}
