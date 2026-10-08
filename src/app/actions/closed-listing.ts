"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { isClosedListing, withClosedFlag } from "@/lib/closed-listing";

export type ClosedListingResult = { ok?: boolean; error?: string; closed?: boolean; livePortals?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Portföyü "kapalı (gizli) portföy" yapar / açar. Kapalı portföy vitrinde, müşteri portalında, site haritasında ve ilan
 * portallarında görünmez; yalnız ofis içinde ve (açıkça paylaşıldıysa) ofis ağı eşleşmesinde kullanılır.
 * Yetki: properties.edit. Diğer `features` anahtarları korunur. Kapatırken canlı portal ilanı varsa sayısı döner (UI uyarır;
 * portal ilanını kaldırmak ayrı, bilinçli bir işlemdir — burada otomatik kapatılmaz).
 */
export async function setClosedListing(propertyId: string, closed: boolean): Promise<ClosedListingResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(propertyId ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Portföy bulunamadı." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("properties")
    .select("features")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return { error: "Portföy bulunamadı." };

  const wasClosed = isClosedListing(existing.features);
  if (wasClosed === closed) return { ok: true, closed };

  const features = withClosedFlag((existing.features ?? {}) as Record<string, unknown>, closed);
  const { error } = await supabase.from("properties").update({ features }).eq("id", id).eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("setClosedListing", error.code);
    return { error: actionErrorMessage(error, "Kapalı portföy ayarı kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  let livePortals = 0;
  if (closed) {
    const { count } = await supabase
      .from("portal_listings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", gate.tenantId)
      .eq("property_id", id)
      .eq("status", "live");
    livePortals = count ?? 0;
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: closed ? "property.closed_listing_on" : "property.closed_listing_off",
    entityType: "property",
    entityId: id,
    newValue: { closed, live_portals: livePortals },
  });
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app/portfoyler");
  revalidatePath("/vitrin/[slug]", "page");
  revalidatePath("/vitrin/[slug]/[id]", "page");
  return { ok: true, closed, livePortals };
}
