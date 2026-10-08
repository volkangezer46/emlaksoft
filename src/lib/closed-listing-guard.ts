import type { SupabaseClient } from "@supabase/supabase-js";
import { isClosedListing } from "@/lib/closed-listing";

export const CLOSED_PORTAL_MESSAGE = "Kapalı portföy ilan portallarında yayınlanamaz. Önce portföy sayfasından \"Kapalı portföy\" işaretini kaldırın.";

/**
 * Portal yayın kapısı: portföy kapalıysa engel mesajı, değilse null. Okuma hatasında null (diğer kapılar çalışır);
 * çağıran `tenant_id` süzgecini burada verir (başka ofisin portföyü okunmaz).
 */
export async function closedListingBlock(db: SupabaseClient, tenantId: string, propertyId: string): Promise<string | null> {
  const { data, error } = await db.from("properties").select("features").eq("id", propertyId).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  return isClosedListing((data as { features?: unknown }).features) ? CLOSED_PORTAL_MESSAGE : null;
}
