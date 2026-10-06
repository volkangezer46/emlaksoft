import { emlakjetAdapter } from "./emlakjet";
import { hepsiemlakAdapter } from "./hepsiemlak";
import { registerAdapter, getAdapter } from "./registry";
import { sahibindenAdapter } from "./sahibinden";

/**
 * Varsayılan adaptör kaydı. Yeni portal: kendi dosyasını yaz, buraya TEK satır ekle (diğerlerine dokunma).
 * Modül yükleme sırasında bir kez kaydeder (idempotent: zaten kayıtlıysa atlar).
 */
for (const adapter of [sahibindenAdapter, hepsiemlakAdapter, emlakjetAdapter]) {
  if (!getAdapter(adapter.id)) registerAdapter(adapter);
}

export * from "./types";
export { getAdapter, listAdapters, assistedAllowedHosts } from "./registry";
export { parseInventoryCsv, parseCsv, parsePriceText } from "./inventory-csv";
