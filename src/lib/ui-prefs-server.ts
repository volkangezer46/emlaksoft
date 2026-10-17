import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadShellBootstrap } from "@/lib/app-shell/bootstrap";
import { DEFAULT_UI_PREFS, type OfficeSize, type UiPrefs } from "@/lib/ui-prefs";

/**
 * Ofis büyüklüğü (aktif kullanıcı + aktif şube; istek başına bir kez). Hata olursa null (= küçük ofis sayılır,
 * `isSmallOffice`). Yalnız yönetim rolleri için çağrılır. PERF-1: önce istek-içi kabuk RPC'si (layout zaten çağırdı,
 * React `cache()`: ek tur yok) `usage.active_branches` taşıyorsa ondan; yoksa (migration yok / RPC null) iki head-count.
 */
export const getOfficeSize = cache(async (tenantId: string): Promise<OfficeSize | null> => {
  const boot = await loadShellBootstrap().catch(() => null);
  if (boot?.officeSize && boot.profile.tenantId === tenantId) return boot.officeSize;
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
