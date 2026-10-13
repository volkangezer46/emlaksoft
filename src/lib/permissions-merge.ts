/**
 * Saf yetki birleştirme yardımcıları (sunucu bağımlılığı YOK): istemci bileşenleri de içe aktarabilir.
 * Sunucu okuması (`getEffectivePermissions`) `permissions-effective.ts`te; o dosya bunları yeniden dışa verir.
 */
import { DEFAULT_MATRIX, type AppAction, type AppModule, type AppRole } from "@/lib/permissions";


export type EffectivePermissions = Partial<Record<AppModule, AppAction[]>>;

export type UserOverrideRow = { module: string; actions: string[]; expires_at: string | null };

/** Süresi geçmiş kullanıcı istisnası yok sayılır (geçici yetki). */
export function isOverrideActive(row: Pick<UserOverrideRow, "expires_at">, now = Date.now()) {
  return !row.expires_at || new Date(row.expires_at).getTime() > now;
}

const READONLY_CEILING = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFAULT_MATRIX.readonly).map(([mod, actions]) => [
      mod,
      Object.freeze([...(actions ?? [])]),
    ]),
  ),
) as EffectivePermissions;

/** Readonly is a security ceiling: tenant/user overrides can never add writes. */
export function immutableReadonlyPermissions(): EffectivePermissions {
  return READONLY_CEILING;
}

export type RoleOverrideRow = { module: string; action: string; allowed: boolean };

/**
 * SAF birleşim (DB yok): varsayılan matris → tenant rol override'ları → kullanıcı istisnaları.
 * `getEffectivePermissions` ve kabuk RPC yolu (`app_shell_bootstrap`, src/lib/app-shell) AYNI fonksiyonu kullanır;
 * iş kuralı tek yerdedir. Bilinmeyen rol → {} (fail-closed), readonly → değişmez tavan.
 */
export function mergeEffectivePermissions(
  role: string | null | undefined,
  roleOverrides: readonly RoleOverrideRow[],
  userOverrides: readonly UserOverrideRow[],
  nowMs = Date.now(),
): EffectivePermissions {
  const r = role as AppRole;
  const defaults = DEFAULT_MATRIX[r];
  if (!defaults) return {};
  if (r === "readonly") return immutableReadonlyPermissions();

  const merged: Partial<Record<AppModule, Set<AppAction>>> = {};
  for (const mod of Object.keys(defaults) as AppModule[]) {
    merged[mod] = new Set(defaults[mod]);
  }
  for (const row of roleOverrides) {
    const mod = row.module as AppModule;
    const action = row.action as AppAction;
    if (!merged[mod]) merged[mod] = new Set();
    if (row.allowed) merged[mod]!.add(action);
    else merged[mod]!.delete(action);
  }
  // Kullanıcı katmanı: satır varsa modülün kümesini tamamen değiştirir. Owner muaftır (istisna yazılamaz da).
  if (r !== "owner") {
    for (const row of userOverrides) {
      if (!isOverrideActive(row, nowMs)) continue;
      merged[row.module as AppModule] = new Set(row.actions as AppAction[]);
    }
  }

  const result: EffectivePermissions = {};
  for (const [mod, set] of Object.entries(merged)) {
    result[mod as AppModule] = Array.from(set as Set<AppAction>);
  }
  return result;
}

export function effectiveHasPermission(perms: EffectivePermissions, mod: AppModule, action: AppAction) {
  return (perms[mod] ?? []).includes(action);
}

export function effectiveCanAccessModule(perms: EffectivePermissions, mod: AppModule) {
  return effectiveHasPermission(perms, mod, "view");
}
