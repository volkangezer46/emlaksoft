/**
 * /app/ayarlar sekmeleri (SAF; birim testli). URL kontratı: `?sekme=` (yoksa/bilinmiyorsa `kimlik`).
 * Her sekme yalnız kendi verisini okur ve kendi istemci adasını çizer (ilk yük azalır, HIZ_OLCUM_RAPORU_5 §5).
 * Eski derin bağlantılar (`#marka-kimlik`, `#eslestirme-agirliklari`) `LEGACY_HASH_TAB` ile sekmeye çevrilir.
 */
export const SETTINGS_TABS = [
  { id: "kimlik", label: "Marka ve kimlik" },
  { id: "eslestirme", label: "Eşleştirme" },
  { id: "entegrasyon", label: "Entegrasyonlar" },
  { id: "bildirim", label: "Bildirimler" },
  { id: "tum", label: "Tüm ayarlar" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function parseSettingsTab(raw: string | string[] | undefined): SettingsTabId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SETTINGS_TABS.some((t) => t.id === v) ? (v as SettingsTabId) : "kimlik";
}

export function settingsTabHref(id: SettingsTabId, hash?: string): string {
  return `${id === "kimlik" ? "/app/ayarlar" : `/app/ayarlar?sekme=${id}`}${hash ? `#${hash}` : ""}`;
}

/** Eski tek sayfa çapaları → sekme (abonelik, eşleştirme ve lisans kartı bağlantıları geriye dönük çalışsın). */
export const LEGACY_HASH_TAB: Record<string, SettingsTabId> = {
  "marka-kimlik": "kimlik",
  "eslestirme-agirliklari": "eslestirme",
  entegrasyonlar: "entegrasyon",
  bildirimler: "bildirim",
};
