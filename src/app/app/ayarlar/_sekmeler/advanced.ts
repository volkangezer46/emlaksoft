/**
 * Ayarlar açılışında "Gelişmiş ayarlar" altına KATLANAN ekranlar (sadeleştirme planı 2.2 / C26). Sırası menüde değil,
 * yalnız dizinde geçerlidir; aramada hepsi bulunur. Etiketler dizinden (settings-directory.ts) gelir.
 */
export const ADVANCED_SETTINGS_HREFS: readonly string[] = [
  "/app/ayarlar/api-webhook",
  "/app/ayarlar/ozel-alanlar",
  "/app/ayarlar/is-akislari",
  "/app/otomasyonlar/diziler",
  "/app/ayarlar?sekme=eslestirme",
  "/app/otomasyonlar",
];

export function isAdvancedSetting(href: string): boolean {
  return ADVANCED_SETTINGS_HREFS.includes(href);
}
