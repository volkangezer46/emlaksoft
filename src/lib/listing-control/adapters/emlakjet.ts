import { createSkeletonAdapter } from "./skeleton";

/**
 * Emlakjet adaptör İSKELETİ. "API ile ilan transferi" belgeli ama OKUMA kapsamı doğrulanmadı.
 * Şimdilik: URL normalizasyonu + CSV/XML içe aktarma + manuel teyit. URL kalıbı doğrulanmamıştır.
 */
export const emlakjetAdapter = createSkeletonAdapter({
  id: "emlakjet",
  label: "Emlakjet",
  hosts: ["emlakjet.com"],
  idFromPath: /-(\d{6,12})\/?$/,
  urlPatternVerified: false,
});
