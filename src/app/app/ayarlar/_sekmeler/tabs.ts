/**
 * /app/ayarlar sayfa gövdesi sekmeleri (SAF; birim testli). URL kontratı: `?sekme=` (yoksa/bilinmiyorsa `kimlik`).
 * Gövde yalnız iki sekmedir; diğer ayar sayfaları Ayarlar şeridindedir (`nav-roles.ts` AYARLAR).
 */
export const SETTINGS_TABS = [
  { id: "kimlik", label: "Marka ve kimlik" },
  { id: "eslestirme", label: "Eşleştirme" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function parseSettingsTab(raw: string | string[] | undefined): SettingsTabId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SETTINGS_TABS.some((t) => t.id === v) ? (v as SettingsTabId) : "kimlik";
}

export function settingsTabHref(id: SettingsTabId, hash?: string): string {
  return `${id === "kimlik" ? "/app/ayarlar" : `/app/ayarlar?sekme=${id}`}${hash ? `#${hash}` : ""}`;
}
