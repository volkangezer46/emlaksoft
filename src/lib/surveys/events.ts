import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventKey } from "@/lib/surveys/logic";
import { queueSingleCandidate } from "@/lib/surveys/server";

/**
 * Yetki süresi uzatma anketi kancası.
 *
 * Yetki bitiş tarihinin geçmişi tutulmadığı için cron bu olayı göremez; tarih `updatePropertyAuthorization`
 * içinde ileri alınırken bu fonksiyon çağrılır. Tetikleyici kapalıysa, tablo yoksa ya da herhangi bir hata
 * olursa sessizce hiçbir şey yapmaz: yetki güncellemesi asla bu yüzden başarısız olmaz.
 * Aynı bitiş tarihi için ikinci görev üretilmez (olay anahtarında yeni tarih vardır).
 */
export async function queueAuthorityExtensionSurvey(
  supabase: SupabaseClient,
  tenantId: string,
  propertyId: string,
  oldEnd: string | null,
  newEnd: string | null,
): Promise<void> {
  try {
    if (!oldEnd || !newEnd || newEnd <= oldEnd) return;
    const { data: property } = await supabase
      .from("properties")
      .select("id, property_code, title, assigned_to, is_sample")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!property || property.is_sample) return;
    const { data: owner } = await supabase
      .from("owner_portal_tokens")
      .select("owner_name, owner_phone")
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const label = [property.property_code, property.title].filter(Boolean).join(" ") || "Portföy";
    await queueSingleCandidate(supabase, tenantId, {
      eventType: "authority_extended",
      audience: "owner",
      eventKey: eventKey("authority_extended", propertyId, "owner", newEnd),
      summary: `${label}: yetki süresi ${oldEnd} tarihinden ${newEnd} tarihine uzatıldı`,
      eventAt: new Date().toISOString(),
      propertyId,
      contactName: (owner?.owner_name as string | null) ?? null,
      contactPhone: (owner?.owner_phone as string | null) ?? null,
      agentId: (property.assigned_to as string | null) ?? null,
    });
  } catch (e) {
    console.error("queueAuthorityExtensionSurvey", e);
  }
}
