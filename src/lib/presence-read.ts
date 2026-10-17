import "server-only";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { effectivePresence, type OwnPresence, type PresenceRow } from "@/lib/presence";

/**
 * Oturumdaki kullanıcının KENDİ durumu (RLS: aynı ofis okur; tek PK sorgusu). Tablo yoksa (migration bekliyor) ya da
 * okunamazsa `null` → menüde durum seçici gösterilmez. Satır yoksa / gün bitmişse `status: null` (seçilmemiş).
 */
export async function loadOwnPresence(userId: string): Promise<OwnPresence | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("user_presence").select("status, note, updated_at, is_sample").eq("user_id", userId).maybeSingle();
    if (error) return null;
    const eff = effectivePresence(data as PresenceRow | null, now());
    if (!eff || eff.expired) return { status: null, note: null };
    return { status: eff.status, note: eff.note };
  } catch {
    return null;
  }
}
