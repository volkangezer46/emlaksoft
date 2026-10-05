import { SETTING_CATEGORIES, type AnySettingDef, type SettingCategoryId } from "../types";
import { PLATFORM_SETTING_DEFS } from "./platform";

/** Tum ayar tanimlari (TEK kaynak). Ofis/sube/kullanici tanimlari sonraki pakette buraya eklenir. */
export const ALL_SETTING_DEFS: readonly AnySettingDef[] = [...PLATFORM_SETTING_DEFS];

const BY_KEY = new Map<string, AnySettingDef>();
const BY_STORAGE = new Map<string, AnySettingDef>();
for (const d of ALL_SETTING_DEFS) {
  BY_KEY.set(d.key, d);
  for (const legacy of d.legacyKeys ?? []) BY_KEY.set(legacy, d);
  BY_STORAGE.set(`${d.scope}:${d.storageKey ?? d.key}`, d);
}

/** Noktali anahtar VEYA eski anahtar ile tanim bulur. */
export function getSettingDef(key: string): AnySettingDef | undefined {
  return BY_KEY.get(key);
}

/** Depo anahtarindan (platform_settings.key) tanim bulur. */
export function getSettingDefByStorage(scope: string, storageKey: string): AnySettingDef | undefined {
  return BY_STORAGE.get(`${scope}:${storageKey}`);
}

export function storageKeyOf(def: AnySettingDef): string {
  return def.storageKey ?? def.key;
}

export function listSettingDefs(opts?: { scope?: AnySettingDef["scope"]; category?: SettingCategoryId }): AnySettingDef[] {
  return ALL_SETTING_DEFS.filter(
    (d) => (!opts?.scope || d.scope === opts.scope) && (!opts?.category || d.category === opts.category),
  );
}

export function categoriesWithCounts(scope: AnySettingDef["scope"] = "platform") {
  return SETTING_CATEGORIES.map((c) => ({ ...c, count: listSettingDefs({ scope, category: c.id }).length }));
}

export function isSecretDef(def: AnySettingDef): boolean {
  return def.sensitivity === "secret";
}