import { getPlatformSetting, getPlatformSettingsMany } from "@/lib/platform-settings";
import { revealSecret } from "./secrets";

/**
 * Eski okuyucular (ai-advisor, netgsm, portal, e-fatura) için HAFİF gizli okuma: depo anahtarıyla değeri açar.
 * Geçiş dönemi: `v1.` öneki yoksa eski düz metin olduğu gibi kabul edilir. Registry/önbellek bağımlılığı YOKTUR.
 * Dönen düz değer log'a/istemciye/denetime verilmemelidir.
 */
export async function getPlatformSecret(storageKey: string): Promise<string | null> {
  return revealSecret(storageKey, await getPlatformSetting(storageKey));
}

/** Birden çok depo anahtarını tek sorguyla okur; `secretKeys` içindekiler açılır, diğerleri ham döner. */
export async function getPlatformSecretsMany(
  storageKeys: readonly string[],
  secretKeys: readonly string[],
): Promise<Record<string, string | null>> {
  const raw = await getPlatformSettingsMany(storageKeys);
  const out: Record<string, string | null> = {};
  for (const k of storageKeys) out[k] = secretKeys.includes(k) ? revealSecret(k, raw[k]) : (raw[k] ?? null);
  return out;
}