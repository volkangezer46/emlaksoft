import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trDayKey, trParts } from "@/lib/clock";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { DUTY_FIRST_KEY } from "@/lib/settings/registry/tenant";
import { onDutyIds, type DutyShift } from "./logic";

/**
 * Talep dağıtımı için o anki nöbetçiler (OA7). İstemciyi ÇAĞIRAN verir (dağıtım motoru: intake/cron istemcisi); bu
 * dosya yeni service_role istemcisi oluşturmaz, her sorgu `tenant_id` süzgeçlidir. Ofis "önce nöbetçiye" ayarını
 * açmadıysa, tablo yoksa ya da hata olursa `[]` (dağıtım bugünkü gibi sürer).
 */
export async function loadOnDutyForRouting(db: SupabaseClient, tenantId: string, nowMs: number): Promise<string[]> {
  try {
    const settings = await readTenantSettings(db, tenantId, [DUTY_FIRST_KEY]);
    if (settings[DUTY_FIRST_KEY] !== true) return [];
    const day = trDayKey(nowMs);
    const { data, error } = await db
      .from("duty_shifts")
      .select("profile_id, duty_date, slot")
      .eq("tenant_id", tenantId)
      .eq("duty_date", day)
      .limit(50);
    if (error || !data) return [];
    return onDutyIds(data as DutyShift[], day, trParts(nowMs).hour);
  } catch {
    return [];
  }
}
