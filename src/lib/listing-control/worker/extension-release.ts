/**
 * EKLENTİ SÜRÜM VE DAĞITIM (SAF, testli). TEK sürüm kaynağı `EXTENSION_VERSION`: derleme betiği manifest sürümünü, ZIP dosya
 * adını ve uygulama içi "güncel mi" denetimini buradan alır (`manifest.base.json` ile eşitliği test kilitler).
 */

export const EXTENSION_VERSION = "0.2.0";
export const EXTENSION_ZIP_PREFIX = "emlaksoft-ilan-kontrol";
/** Derleme çıktısı ZIP'in kopyalandığı klasör (depoya girmez; indirme ucu buradan okur). */
export const EXTENSION_PACKAGE_DIR = "public/downloads";
export const EXTENSION_DOWNLOAD_PATH = "/api/app/ilan-kontrol/eklenti.zip";

export function extensionZipFileName(version: string = EXTENSION_VERSION): string {
  return `${EXTENSION_ZIP_PREFIX}-${version}.zip`;
}

/** "0.2.0" biçimli sürümleri karşılaştırır (a<b → -1). Geçersiz parça 0 sayılır. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function isOutdated(installed: string | null | undefined, latest: string = EXTENSION_VERSION): boolean {
  return !!installed && compareVersions(installed, latest) < 0;
}

const CHROME_STORE = /^https:\/\/(chromewebstore\.google\.com\/detail\/|chrome\.google\.com\/webstore\/detail\/)[\w%./~:-]+$/i;
const EDGE_STORE = /^https:\/\/microsoftedge\.microsoft\.com\/addons\/detail\/[\w%./~:-]+$/i;

/**
 * Mağaza bağlantıları ortam değişkeninden (`NEXT_PUBLIC_LISTING_EXTENSION_STORE_URL`, isteğe bağlı
 * `NEXT_PUBLIC_LISTING_EXTENSION_EDGE_STORE_URL`). Yalnız resmi mağaza adresleri kabul edilir; başka değer yok sayılır
 * (yapılandırma hatası kullanıcıyı yabancı bir siteye göndermesin).
 */
export function extensionStoreLinks(env: { chrome?: string | null; edge?: string | null }): { chrome: string | null; edge: string | null } {
  const c = (env.chrome ?? "").trim();
  const e = (env.edge ?? "").trim();
  return { chrome: CHROME_STORE.test(c) ? c : null, edge: EDGE_STORE.test(e) ? e : null };
}
