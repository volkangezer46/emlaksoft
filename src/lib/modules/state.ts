import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabledIn, stateFromQuery, type ModuleRow, type TenantModuleState } from "@/lib/modules/logic";
import { isFeatureKey, normalizeClosed, type FeatureKey } from "@/lib/modules/registry";

/**
 * Modül durumunun TEK sunucu kapısı. İstek-içi (React `cache()`) tek sorgu: layout, sayfa kapısı ve
 * ana ekran aynı istekte paylaşır; istekler ARASI paylaşım yoktur (kapatma bir sonraki istekte hemen
 * yansır, bayat durum riski yok). RLS'li kullanıcı client'ı kullanılır (admin client yok).
 * Tablo yokken (migration uygulanmadı) tüm modüller AÇIK sayılır; durum `unavailable` olarak
 * döner ve Modüller ekranı bunu açıkça gösterir. Beklenmeyen hata `error` durumunda loglanır.
 */

/** Herhangi bir supabase client'ı (kullanıcı ya da cron/public için admin) ile satırları okur. */
export async function loadTenantModuleState(client: SupabaseClient, tenantId: string): Promise<TenantModuleState> {
  const { data, error } = await client
    .from("tenant_modules")
    .select("module_key, enabled, locked_by_platform")
    .eq("tenant_id", tenantId);
  const state = stateFromQuery(data as ModuleRow[] | null, error);
  if (state.status === "error") console.error("tenant_modules okunamadı", error);
  return state;
}

export const getTenantModuleState = cache(async (tenantId: string): Promise<TenantModuleState> => {
  const supabase = await createClient();
  return loadTenantModuleState(supabase, tenantId);
});

/** Tek kapı: modül bu ofiste açık mı? Çekirdek/bilinmeyen anahtar her zaman açık; tenantId yoksa açık. */
export async function isModuleEnabled(tenantId: string | null | undefined, moduleKey: string): Promise<boolean> {
  if (!tenantId || !isFeatureKey(moduleKey)) return true;
  return isFeatureEnabledIn(await getTenantModuleState(tenantId), moduleKey);
}

/** Menü, palet ve ana ekran için kapalı modül anahtarları (hata/yoksa boş). */
export async function getClosedFeatures(tenantId: string | null | undefined): Promise<FeatureKey[]> {
  if (!tenantId) return [];
  return (await getTenantModuleState(tenantId)).closed;
}

/**
 * Cron/toplu işler için: verilen client ile (genelde zaten kullanılan admin client) tüm kapalı modülleri
 * ofis bazında tek sorguda okur. Tablo yoksa boş harita (hiçbir iş atlanmaz). Hata durumunda GÜVENLİ varsayılan
 * "atlama yok" olup hata loglanır (bir okuma hatası işi sessizce durdurmaz).
 */
export async function getDisabledModulesByTenant(client: SupabaseClient): Promise<Map<string, Set<FeatureKey>>> {
  const out = new Map<string, Set<FeatureKey>>();
  const { data, error } = await client.from("tenant_modules").select("tenant_id, module_key, enabled");
  if (error) {
    if (stateFromQuery(null, error).status === "error") console.error("tenant_modules (cron) okunamadı", error);
    return out;
  }
  for (const row of (data ?? []) as { tenant_id: string; module_key: string; enabled: boolean }[]) {
    if (row.enabled !== false || !isFeatureKey(row.module_key)) continue;
    const set = out.get(row.tenant_id) ?? new Set<FeatureKey>();
    set.add(row.module_key);
    out.set(row.tenant_id, set);
  }
  // Bağımlılık tutarlılığı: kapalı modüle bağlı olan da kapalı (ör. portallar kapalı -> kaçak da).
  for (const [tenantId, set] of out) out.set(tenantId, new Set(normalizeClosed(set)));
  return out;
}

/** Cron yardımcısı: ofis `key` modülünü kapatmış mı? */
export function isDisabledFor(map: Map<string, Set<FeatureKey>>, tenantId: string, key: FeatureKey): boolean {
  return map.get(tenantId)?.has(key) ?? false;
}
