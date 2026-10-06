import { unstable_cache } from "next/cache";
import { getPlatformSetting, getPlatformSettingsMany } from "@/lib/platform-settings";
import { createClient } from "@/lib/supabase/server";
import { ALL_SETTING_DEFS, getSettingDef, isSecretDef, listSettingDefs, storageKeyOf } from "./registry";
import { revealSecret, isSealed } from "./secrets";
export { getPlatformSecret, getPlatformSecretsMany } from "./secret-read";
import type { AnySettingDef, SettingView } from "./types";
import { buildView, coerceInput } from "./view";

/**
 * Ayar OKUMA (sunucu). Çözümleme: kullanıcı > şube > ofis > platform > varsayılan (şu an ofis ve platform katmanları).
 * Bozuk değer = varsayılan (codec.parse asla fırlatmaz). GİZLİ değerler `getSetting`/`getSettings`'ten ASLA dönmez;
 * yalnız `getSecret` (sunucu içi, düz metin) ve `getSecretStatus` (tanımlı mı) vardır.
 *
 * Önbellek: platform anlık görüntüsü `unstable_cache` (etiket `settings:platform`, 30 sn). Eski yazarlar etiketi
 * tazelemez; en fazla 30 sn gecikir. Gizli ayarlar önbelleğe GİRMEZ. Ofis kapsamı oturumlu istemciyle (RLS) okunur ve
 * önbelleksizdir (admin istemcili önbellek için kabul listesi satırı gerekir; sonraki paket).
 */

export const SETTINGS_PLATFORM_TAG = "settings:platform";
export const settingsTenantTag = (tenantId: string) => `settings:t:${tenantId}`;

const platformStorageKeys = () =>
  listSettingDefs({ scope: "platform" })
    .filter((d) => !isSecretDef(d))
    .map(storageKeyOf);

const cachedPlatformSnapshot = unstable_cache(
  async (): Promise<Record<string, string | null>> => getPlatformSettingsMany(platformStorageKeys()),
  ["settings-platform-snapshot-v1"],
  { revalidate: 30, tags: [SETTINGS_PLATFORM_TAG] },
);

async function readTenantRows(tenantId: string): Promise<Record<string, unknown>> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("tenant_settings").select("key, value").eq("tenant_id", tenantId);
    const out: Record<string, unknown> = {};
    for (const r of data ?? []) out[r.key as string] = r.value;
    return out;
  } catch {
    return {}; // tablo yok / yetki yok = ofis katmanı boş (varsayılana düşer)
  }
}

function resolveFrom(def: AnySettingDef, platformRaw: string | null, tenantRaw: unknown): unknown {
  if (def.scope !== "platform" && tenantRaw !== undefined && tenantRaw !== null) {
    // Ofis değeri RPC ile metin olarak (jsonb string) yazılır; coerceInput hem metni hem tipli değeri çözer, bozuk = düşer.
    const parsed = coerceInput(def, tenantRaw);
    if (parsed.ok) return parsed.value;
  }
  return def.codec.parse(platformRaw);
}

/** Tipli ayar değeri. Gizli ayarda hata fırlatır (kod hatası; `getSecret` kullanın). Bozuk/yok = varsayılan. */
export async function getSetting<T = unknown>(key: string, opts?: { tenantId?: string }): Promise<T> {
  const def = getSettingDef(key);
  if (!def) throw new Error(`Bilinmeyen ayar: ${key}`);
  if (isSecretDef(def)) throw new Error(`Gizli ayar getSetting ile okunamaz: ${key}`);
  const snap = await cachedPlatformSnapshot();
  const tenantRaw = opts?.tenantId && def.scope !== "platform" ? (await readTenantRows(opts.tenantId))[storageKeyOf(def)] : undefined;
  return resolveFrom(def, snap[storageKeyOf(def)] ?? null, tenantRaw) as T;
}

export async function getSettings(keys: readonly string[], opts?: { tenantId?: string }): Promise<Record<string, unknown>> {
  const snap = await cachedPlatformSnapshot();
  const tenantRows = opts?.tenantId ? await readTenantRows(opts.tenantId) : {};
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const def = getSettingDef(key);
    if (!def || isSecretDef(def)) continue;
    out[key] = resolveFrom(def, snap[storageKeyOf(def)] ?? null, tenantRows[storageKeyOf(def)]);
  }
  return out;
}

/** Gizli değerin düz metni (SUNUCU İÇİ; asla istemciye/log'a/denetime verilmez). Şifreli çözülür, eski düz metin kabul edilir. */
export async function getSecret(key: string): Promise<string | null> {
  const def = getSettingDef(key);
  if (!def || !isSecretDef(def)) throw new Error(`Gizli ayar değil: ${key}`);
  const sk = storageKeyOf(def);
  return revealSecret(sk, await getPlatformSetting(sk));
}

export async function getSecretStatus(key: string): Promise<{ configured: boolean; sealed: boolean; plaintext: boolean; undecryptable: boolean }> {
  const def = getSettingDef(key);
  if (!def || !isSecretDef(def)) throw new Error(`Gizli ayar değil: ${key}`);
  const sk = storageKeyOf(def);
  const raw = await getPlatformSetting(sk);
  if (!raw) return { configured: false, sealed: false, plaintext: false, undecryptable: false };
  const sealed = isSealed(raw);
  return { configured: true, sealed, plaintext: !sealed, undecryptable: sealed && revealSecret(sk, raw) === null };
}

/** Merkez ekranı için tüm platform ayarlarının görünümü (gizlide değer YOK; bozuk değer = varsayılan). */
export async function getPlatformSettingViews(): Promise<SettingView[]> {
  const defs = ALL_SETTING_DEFS.filter((d) => d.scope === "platform");
  const raw = await getPlatformSettingsMany(defs.map(storageKeyOf));
  return defs.map((d) => {
    const r = raw[storageKeyOf(d)] ?? null;
    return buildView(d, r, isSecretDef(d) ? { configured: Boolean(r), plaintext: Boolean(r) && !isSealed(r) } : undefined);
  });
}

/** Ofis Tanımları Merkezi: bir ofisin tüm ofis-kapsamlı ayar görünümleri (ofis değeri yoksa/bozuksa varsayılan). Oturumlu istemci (RLS). */
export async function getTenantSettingViews(tenantId: string): Promise<SettingView[]> {
  const defs = ALL_SETTING_DEFS.filter((d) => d.scope === "tenant" && !isSecretDef(d));
  const rows = await readTenantRows(tenantId);
  return defs.map((d) => {
    const stored = rows[storageKeyOf(d)];
    let raw: string | null = null;
    if (stored !== undefined && stored !== null) {
      const c = coerceInput(d, stored);
      if (c.ok) raw = d.codec.format(c.value);
    }
    return buildView(d, raw);
  });
}
