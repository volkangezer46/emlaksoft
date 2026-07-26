import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "@/lib/permissions";

export type EffectivePermissions = Partial<Record<AppModule, AppAction[]>>;

export type UserOverrideRow = { module: string; actions: string[]; expires_at: string | null };

/** Süresi geçmiş kullanıcı istisnası yok sayılır (geçici yetki). */
export function isOverrideActive(row: Pick<UserOverrideRow, "expires_at">, now = Date.now()) {
  return !row.expires_at || new Date(row.expires_at).getTime() > now;
}

/**
 * Etkin izin haritası — üç katmanın birleşimi, alttan üste:
 *   1. varsayılan matris (`DEFAULT_MATRIX`)
 *   2. tenant'a özel rol override'ları (`tenant_role_permissions`) — hücre bazlı ekle/çıkar
 *   3. (opsiyonel `userId` verilirse) kullanıcı istisnaları (`user_permission_overrides`) —
 *      modül bazlı: satır varsa o modülün aksiyon kümesi TAMAMEN satırın `actions` dizisidir
 *      (boş dizi = modül kapalı). `expires_at` geçmişteyse satır yok sayılır.
 *
 * `userId` verilmezse davranış eskisiyle birebir aynıdır (yalnız rol katmanları) —
 * rol matrisi ekranı gibi "rolün etkin izni" isteyen çağıranlar için.
 *
 * `cache()` ile istek başına bir kez hesaplanır (server component ağacı içinde dedupe edilir).
 */
export const getEffectivePermissions = cache(async function getEffectivePermissions(
  tenantId: string | null | undefined,
  role: string | null | undefined,
  userId?: string | null,
): Promise<EffectivePermissions> {
  const r = (role || "advisor") as AppRole;
  const defaults = DEFAULT_MATRIX[r] ?? {};

  if (!tenantId) return defaults;

  try {
    const supabase = await createClient();
    const [{ data: overrides }, userOverrides] = await Promise.all([
      supabase
        .from("tenant_role_permissions")
        .select("module, action, allowed")
        .eq("tenant_id", tenantId)
        .eq("role", r),
      // Owner istisnalardan muaftır (istisna yazılamaz da — bkz. actions/permissions.ts)
      // Tablo yoksa/erişilemezse supabase hatayı `error` alanında döndürür (throw etmez) —
      // data null olur ve katman boş kalır.
      userId && r !== "owner"
        ? supabase
            .from("user_permission_overrides")
            .select("module, actions, expires_at")
            .eq("tenant_id", tenantId)
            .eq("user_id", userId)
            .then(({ data }) => (data ?? []) as UserOverrideRow[])
        : Promise.resolve([] as UserOverrideRow[]),
    ]);

    const merged: Partial<Record<AppModule, Set<AppAction>>> = {};
    for (const mod of Object.keys(defaults) as AppModule[]) {
      merged[mod] = new Set(defaults[mod]);
    }
    for (const row of overrides ?? []) {
      const mod = row.module as AppModule;
      const action = row.action as AppAction;
      if (!merged[mod]) merged[mod] = new Set();
      if (row.allowed) merged[mod]!.add(action);
      else merged[mod]!.delete(action);
    }

    // Kullanıcı katmanı: satır varsa modülün kümesini tamamen değiştirir.
    for (const row of userOverrides) {
      if (!isOverrideActive(row)) continue;
      merged[row.module as AppModule] = new Set(row.actions as AppAction[]);
    }

    const result: EffectivePermissions = {};
    for (const [mod, set] of Object.entries(merged)) {
      result[mod as AppModule] = Array.from(set as Set<AppAction>);
    }
    return result;
  } catch (e) {
    console.error("getEffectivePermissions", e);
    return defaults;
  }
});

export function effectiveHasPermission(perms: EffectivePermissions, mod: AppModule, action: AppAction) {
  return (perms[mod] ?? []).includes(action);
}

export function effectiveCanAccessModule(perms: EffectivePermissions, mod: AppModule) {
  return effectiveHasPermission(perms, mod, "view");
}
