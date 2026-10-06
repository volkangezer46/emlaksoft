"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { insertPropertyShareLink } from "@/lib/share-links";

export type ShareResult = { error?: string; ok?: boolean; url?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPropertyShareLink(formData: FormData): Promise<ShareResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!UUID_RE.test(propertyId)) return { error: "Geçerli bir portföy seçin." };

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) return { error: "Portföy bulunamadı." };

  const link = await insertPropertyShareLink(supabase, { tenantId: gate.tenantId, userId: gate.userId, propertyId, label: "Portföy paylaşımı" });
  if (!link.ok) return { error: "Paylaşım linki oluşturulamadı." };
  const token = link.token;
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "share.create",
    entityType: "property",
    entityId: propertyId,
    newValue: { token },
  });
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, url: link.url };
}
