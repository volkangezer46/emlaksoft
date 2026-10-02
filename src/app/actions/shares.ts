"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { getBaseUrl } from "@/lib/base-url";

export type ShareResult = { error?: string; ok?: boolean; url?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function appUrl() {
  return getBaseUrl();
}

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

  const token = randomBytes(12).toString("hex");
  const { error } = await supabase.from("share_links").insert({
    tenant_id: gate.tenantId,
    token,
    entity_type: "property",
    entity_id: propertyId,
    label: "Portföy paylaşımı",
    created_by: gate.userId,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  if (error) {
    console.error("createPropertyShareLink", error);
    return { error: "Paylaşım linki oluşturulamadı." };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "share.create",
    entityType: "property",
    entityId: propertyId,
    newValue: { token },
  });
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, url: `${appUrl()}/paylas/${token}` };
}
