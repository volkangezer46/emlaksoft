/**
 * /app/ayarlar sayfa gövdesi sekmeleri (SAF; birim testli). URL kontratı: `?sekme=` (yoksa/bilinmiyorsa `dizin`).
 * Açılış sekmesi kategorili ve aranabilir ayar dizinidir (OA13); marka/kimlik formu ve eşleştirme ağırlıkları kendi
 * sekmelerindedir. Diğer ayar sayfaları dizinde ve Ayarlar şeridindedir (`nav-roles.ts` AYARLAR).
 */
export const SETTINGS_TABS = [
  { id: "dizin", label: "Tüm ayarlar" },
  { id: "kimlik", label: "Marka ve kimlik" },
  { id: "eslestirme", label: "Eşleştirme" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function parseSettingsTab(raw: string | string[] | undefined): SettingsTabId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SETTINGS_TABS.some((t) => t.id === v) ? (v as SettingsTabId) : "dizin";
}

export function settingsTabHref(id: SettingsTabId, hash?: string): string {
  return `${id === "dizin" ? "/app/ayarlar" : `/app/ayarlar?sekme=${id}`}${hash ? `#${hash}` : ""}`;
}
