import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_UI_PREFS, type OfficeSize, type UiPrefs } from "@/lib/ui-prefs";

/**
 * Ofis büyüklüğü (aktif kullanıcı + aktif şube; iki head-count, istek başına bir kez). Hata olursa null
 * (= küçük ofis sayılır, `isSmallOffice`). Yalnız yönetim rolleri için çağrılır.
 */
export const getOfficeSize = cache(async (tenantId: string): Promise<OfficeSize | null> => {
  try {
    const supabase = await createClient();
    const [seats, branches] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
      supabase.from("branches").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    ]);
    if (seats.error || seats.count == null) return null;
    return { seats: seats.count, branches: branches.error ? 0 : (branches.count ?? 0) };
  } catch {
    return null;
  }
});

/** Sunucu bileşenleri için arayüz tercihi: tek görünüm (sabit; çerez ve sorgu yok). */
export async function getUiPrefs(): Promise<UiPrefs> {
  return DEFAULT_UI_PREFS;
}
