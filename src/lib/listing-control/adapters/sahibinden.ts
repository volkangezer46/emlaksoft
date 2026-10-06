import { createSkeletonAdapter } from "./skeleton";

/**
 * Sahibinden adaptör İSKELETİ. Resmi API'nin "ilan durumu okuma" kapsamı DOĞRULANMADI (sözleşme + EİDS şartı; sahip
 * başvurusu K1/K2). Şimdilik: URL normalizasyonu + ofis panelinden dışa aktarım dosyası içe aktarma + manuel teyit.
 * Örnek ilan yolu: /ilan/<slug>-<ilan no>/detay (kalıp doğrulanmamıştır).
 */
export const sahibindenAdapter = createSkeletonAdapter({
  id: "sahibinden",
  label: "Sahibinden",
  hosts: ["sahibinden.com"],
  idFromPath: /-(\d{6,12})(?:\/detay)?\/?$/,
  urlPatternVerified: false,
});
