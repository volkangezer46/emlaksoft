"use server";

import { revalidatePath } from "next/cache";
import { now } from "@/lib/clock";
import { isMissingTableError } from "@/lib/modules/logic";
import { getModuleDef, isFeatureKey } from "@/lib/modules/registry";
import { getTenantModuleState } from "@/lib/modules/state";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";

export type ModulePrefResult = { ok?: boolean; error?: string; message?: string };

const UNAVAILABLE = "Kişisel görünüm ayarı henüz etkin değil.";

/**
 * Kişisel görünüm: kullanıcı ofisin AÇIK tuttuğu bir modülü kendi menü/ana ekran/palet görünümünden gizler.
 * Yetkiyi değiştirmez, ofis ayarına dokunmaz; yalnız kendi satırına yazılır (RLS). Her kullanıcının kendi tercihi
 * olduğu için ek rol kapısı yoktur; ana ekran görüntüleme izni yeterlidir.
 */
export async function setModuleHidden(moduleKey: string, hidden: boolean): Promise<ModulePrefResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda kişisel görünüm değiştirilemez." };
  if (!isFeatureKey(moduleKey)) return { error: "Çekirdek ve sistem alanları gizlenemez." };

  if (hidden) {
    const state = await getTenantModuleState(gate.tenantId);
    if (state.closed.includes(moduleKey)) return { error: `${getModuleDef(moduleKey).label} ofis tarafından zaten kapatılmış.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_module_prefs").upsert(
    {
      user_id: gate.userId,
      tenant_id: gate.tenantId,
      module_key: moduleKey,
      hidden,
      updated_at: new Date(now()).toISOString(),
    },
    { onConflict: "user_id,module_key" },
  );
  if (error) {
    if (isMissingTableError(error) || error.code === "42P01" || error.code === "PGRST205") return { error: UNAVAILABLE };
    console.error("user_module_prefs yazılamadı", error);
    return { error: "Tercih kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin." };
  }
  revalidatePath("/app", "layout");
  const label = getModuleDef(moduleKey).label;
  return { ok: true, message: hidden ? `${label} görünümünüzden gizlendi.` : `${label} yeniden görünür.` };
}

/** Tüm kişisel gizlemeleri kaldırır (ofisin açık tuttuğu her şey yeniden görünür). */
export async function resetModuleHidden(): Promise<ModulePrefResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda kişisel görünüm değiştirilemez." };
  const supabase = await createClient();
  const { error } = await supabase.from("user_module_prefs").delete().eq("user_id", gate.userId).eq("tenant_id", gate.tenantId);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return { error: UNAVAILABLE };
    console.error("user_module_prefs silinemedi", error);
    return { error: "Tercihler sıfırlanamadı, bağlantınızı kontrol edip tekrar deneyin." };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Tüm modüller yeniden görünür." };
}
