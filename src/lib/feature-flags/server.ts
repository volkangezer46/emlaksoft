import "server-only";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { getSettings } from "@/lib/settings/read";
import { now } from "@/lib/clock";
import { FEATURE_FLAGS, getFeatureFlagDef, type FeatureFlagDef } from "./registry";
import { loadFlagRules, type FlagRuleWithMeta } from "./rules";
import { evaluateTargeted, type FlagTarget } from "./targeting";

/**
 * Özellik bayrağı OKUYUCUSU — tek kapı. Ayar bayrakları ayar defterinden (`getSettings`, 30 sn önbellek, bozuk = varsayılan),
 * ham platform bayrakları platform_settings'ten, ortam bayrakları mevcut kod yolunun değerlendirmesiyle okunur.
 * Bilinmeyen anahtar KAPALI döner (fail-closed). `requires` bağlı bayrak kapalıysa sonuç kapalıdır.
 * HEDEFLEME (DG8): `targetable` bayrak ofis bağlamıyla (`target`) okunursa `feature_flag_rules` kuralı uygulanır
 * (ofis listesi / plan / yüzde / zaman; anlam `./targeting.ts`). Bağlamsız okuma genel durumu verir.
 */

export type FeatureFlagState = { def: FeatureFlagDef; raw: boolean; enabled: boolean; rule: FlagRuleWithMeta | null };

async function rawStates(defs: readonly FeatureFlagDef[]): Promise<Map<string, boolean>> {
  const settingKeys = defs.filter((d) => d.source === "setting" && d.settingKey).map((d) => d.settingKey!);
  const storageKeys = defs.filter((d) => d.source === "platform" && d.storageKey).map((d) => d.storageKey!);
  const [settings, platform] = await Promise.all([
    settingKeys.length ? getSettings(settingKeys).catch(() => ({}) as Record<string, unknown>) : Promise.resolve({} as Record<string, unknown>),
    storageKeys.length ? getPlatformSettingsMany(storageKeys).catch(() => ({}) as Record<string, string | null>) : Promise.resolve({} as Record<string, string | null>),
  ]);
  const out = new Map<string, boolean>();
  for (const d of defs) {
    if (d.source === "setting") out.set(d.key, settings[d.settingKey!] === true);
    else if (d.source === "platform") out.set(d.key, (platform[d.storageKey!] ?? null) === (d.onValue ?? "on"));
    else out.set(d.key, d.env ? d.env(process.env) : false);
  }
  return out;
}

/** Tüm bayrakların durumu (yönetim ekranı için). */
export async function getFeatureFlagStates(): Promise<FeatureFlagState[]> {
  const [raw, { rules }] = await Promise.all([rawStates(FEATURE_FLAGS), loadFlagRules()]);
  return FEATURE_FLAGS.map((def) => {
    const own = raw.get(def.key) ?? false;
    const enabled = own && (!def.requires || (raw.get(def.requires) ?? false));
    return { def, raw: own, enabled, rule: def.targetable ? (rules.get(def.key) ?? null) : null };
  });
}

/**
 * Bayrak etkin mi (bağlı bayrak dahil). Bilinmeyen anahtar = kapalı. `target` (ofis + plan) verilirse ve bayrak
 * hedeflenebilirse kural uygulanır: genel anahtar kapalıysa yine kapalı, kural yoksa genel durum.
 */
export async function isFeatureEnabled(key: string, target?: FlagTarget | null): Promise<boolean> {
  const def = getFeatureFlagDef(key);
  if (!def) return false;
  const defs = def.requires ? [def, getFeatureFlagDef(def.requires)].filter((d): d is FeatureFlagDef => Boolean(d)) : [def];
  const targeted = Boolean(target && def.targetable);
  const [raw, ruleSet] = await Promise.all([rawStates(defs), targeted ? loadFlagRules() : Promise.resolve(null)]);
  const globalOn = (raw.get(def.key) ?? false) && (!def.requires || (raw.get(def.requires) ?? false));
  if (!targeted || !target || !ruleSet) return globalOn;
  return evaluateTargeted({ globalOn, rule: ruleSet.rules.get(def.key) ?? null, target, nowMs: now() });
}
