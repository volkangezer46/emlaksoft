"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type ShareResult = { error?: string; ok?: boolean; url?: string };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function createPropertyShareLink(formData: FormData): Promise<ShareResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const propertyId = String(formData.get("property_id") ?? "").trim();
  if (!propertyId) return { error: "Portföy zorunlu." };

  const token = randomBytes(12).toString("hex");
  const supabase = await createClient();
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
