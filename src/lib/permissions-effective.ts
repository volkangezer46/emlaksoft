import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MATRIX, type AppRole } from "@/lib/permissions";
import { mergeEffectivePermissions, immutableReadonlyPermissions, type EffectivePermissions, type RoleOverrideRow, type UserOverrideRow } from "./permissions-merge";

export * from "./permissions-merge";

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
  const r = role as AppRole;
  const defaults = DEFAULT_MATRIX[r];

  // Missing and unknown identities fail closed. Authentication/bootstrap code
  // must establish a canonical role instead of silently inheriting advisor.
  if (!defaults) return {};

  // Readonly is used by platform impersonation. Returning before any database
  // override query prevents a target tenant from granting the support identity
  // create/edit/delete powers through role or cross-tenant user overrides.
  if (r === "readonly") return immutableReadonlyPermissions();

  if (!tenantId) return defaults;

  try {
    const supabase = await createClient();
    const [roleOverrideResult, userOverrideResult] = await Promise.all([
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
        : Promise.resolve({ data: [] as UserOverrideRow[], error: null }),
    ]);
    if (roleOverrideResult.error || userOverrideResult.error) {
      console.error(
        "getEffectivePermissions query",
        roleOverrideResult.error ?? userOverrideResult.error,
      );
      return {};
    }
    return mergeEffectivePermissions(
      r,
      (roleOverrideResult.data ?? []) as RoleOverrideRow[],
      (userOverrideResult.data ?? []) as UserOverrideRow[],
    );
  } catch (e) {
    console.error("getEffectivePermissions", e);
    return {};
  }
});
