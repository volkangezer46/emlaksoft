import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "@/lib/permissions";

export type EffectivePermissions = Partial<Record<AppModule, AppAction[]>>;

/**
 * Etkin izin haritası = varsayılan matris (`DEFAULT_MATRIX`) + tenant'a özel override'lar
 * (`tenant_role_permissions`). Bir modül×aksiyon için override satırı varsa onun `allowed`
 * değeri geçerlidir; yoksa varsayılan matris geçerlidir.
 *
 * `cache()` ile istek başına bir kez hesaplanır (server component ağacı içinde dedupe edilir).
 */
export const getEffectivePermissions = cache(async function getEffectivePermissions(
  tenantId: string | null | undefined,
  role: string | null | undefined,
): Promise<EffectivePermissions> {
  const r = (role || "advisor") as AppRole;
  const defaults = DEFAULT_MATRIX[r] ?? {};

  if (!tenantId) return defaults;

  try {
    const supabase = await createClient();
    const { data: overrides } = await supabase
      .from("tenant_role_permissions")
      .select("module, action, allowed")
      .eq("tenant_id", tenantId)
      .eq("role", r);

    if (!overrides || overrides.length === 0) return defaults;

    const merged: Partial<Record<AppModule, Set<AppAction>>> = {};
    for (const mod of Object.keys(defaults) as AppModule[]) {
      merged[mod] = new Set(defaults[mod]);
    }
    for (const row of overrides) {
      const mod = row.module as AppModule;
      const action = row.action as AppAction;
      if (!merged[mod]) merged[mod] = new Set();
      if (row.allowed) merged[mod]!.add(action);
      else merged[mod]!.delete(action);
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
