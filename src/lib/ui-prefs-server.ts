import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { MANAGEMENT_ROLES } from "@/lib/ui/scope";
import { isSmallOffice, resolveUiPrefs, uiPrefCookieName, type OfficeSize, type UiPrefs } from "@/lib/ui-prefs";

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

/**
 * Sunucu bileşenleri için etkin arayüz tercihi (layout'taki `SimpleModeProvider` ile AYNI tanım: `resolveUiPrefs`).
 * Kimlik yerel JWT'den okunur (istek-içi önbellekli); oturum yoksa varsayılan (sade).
 */
export const getUiPrefs = cache(async (): Promise<UiPrefs & { smallOffice: boolean }> => {
  const user = await getRequestUser();
  const impersonating = user?.app_metadata?.impersonating === true;
  const tenantId = typeof user?.app_metadata?.tenant_id === "string" ? user.app_metadata.tenant_id.trim() : "";
  const role = typeof user?.app_metadata?.role === "string" ? user.app_metadata.role.trim() : "";
  const management = !impersonating && MANAGEMENT_ROLES.includes(role);
  const name = uiPrefCookieName(tenantId, user?.id);
  const raw = name ? (await cookies()).get(name)?.value : undefined;
  const smallOffice = management && tenantId ? isSmallOffice(await getOfficeSize(tenantId)) : true;
  return { ...resolveUiPrefs(raw, { management, smallOffice }), smallOffice };
});
