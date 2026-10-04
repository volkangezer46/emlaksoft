import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTenantModuleState } from "@/lib/modules/state";
import type { FeatureKey } from "@/lib/modules/registry";

/**
 * Herkese açık (token'lı) sayfalar için modül kapısı. Sayfa zaten admin client ile token'dan
 * ofisi çözer; aynı client ile ofisin modülü kapatıp kapatmadığına bakılır. Tablo yoksa ya da
 * okuma hatasında AÇIK sayılır (hata loglanır). Kapalıysa sayfa `PublicModuleClosed` gösterir.
 */
export async function isPublicFeatureClosed(admin: SupabaseClient, tenantId: string, key: FeatureKey): Promise<boolean> {
  const state = await loadTenantModuleState(admin, tenantId);
  return state.closed.includes(key);
}
