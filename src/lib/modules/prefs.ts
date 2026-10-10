import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getClosedFeatures } from "@/lib/modules/state";
import { loadShellBootstrap } from "@/lib/app-shell/bootstrap";
import { isFeatureKey, mergeHidden, type FeatureKey } from "@/lib/modules/registry";

/**
 * Kişisel modül gizleme (`user_module_prefs`): YALNIZ görünürlük. Yetkiyi değiştirmez; ofisin kapattığı modülün
 * yazma reddi `guard.ts`'te ofis düzeyinde kalır. RLS'li kullanıcı client'ı (yalnız kendi satırı). Tablo yoksa
 * ya da okunamazsa hiçbir şey gizlenmez (güvenli varsayılan).
 */
export const getUserHiddenModules = cache(async (userId: string, tenantId: string): Promise<FeatureKey[]> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("user_module_prefs")
      .select("module_key")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .eq("hidden", true);
    if (error || !data) return [];
    return (data as { module_key: string }[]).map((r) => r.module_key).filter(isFeatureKey);
  } catch {
    return [];
  }
});

/**
 * /app sayfaları: kabuk RPC'si (layout, istek başına önbellekli) `hidden_modules` döndürdüyse onu kullanır
 * (ek tur yok); alan/RPC yoksa eski okuma. Kimlik/ofis kabuk profiliyle birebir eşleşmezse de eski okuma.
 */
async function hiddenFromShellOrDb(userId: string, tenantId: string): Promise<FeatureKey[]> {
  const boot = await loadShellBootstrap();
  if (boot?.hiddenModules && boot.profile.id === userId && boot.profile.tenantId === tenantId) {
    return boot.hiddenModules.filter(isFeatureKey);
  }
  return getUserHiddenModules(userId, tenantId);
}

/** Menü/palet/ana ekran için görünmez modüller: ofis kapalıları ∪ kullanıcının gizledikleri. */
export async function getInvisibleFeatures(tenantId: string | null | undefined, userId: string | null | undefined): Promise<FeatureKey[]> {
  if (!tenantId) return [];
  const [closed, hidden] = await Promise.all([
    getClosedFeatures(tenantId),
    userId ? hiddenFromShellOrDb(userId, tenantId) : Promise.resolve([] as FeatureKey[]),
  ]);
  return mergeHidden(closed, hidden);
}
