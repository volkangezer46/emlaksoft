import { createSkeletonAdapter } from "./skeleton";

/**
 * Hepsiemlak adaptör İSKELETİ. Kurumsal API/XML erişimi DOĞRULANMADI (ofis programı sayfası doğrulanamadı).
 * Şimdilik: URL normalizasyonu + dışa aktarım/CSV içe aktarma + manuel teyit. URL kalıbı doğrulanmamıştır.
 */
export const hepsiemlakAdapter = createSkeletonAdapter({
  id: "hepsiemlak",
  label: "Hepsiemlak",
  hosts: ["hepsiemlak.com"],
  idFromPath: /(\d{6,12})(?:-detay)?\/?$/,
  urlPatternVerified: false,
});
