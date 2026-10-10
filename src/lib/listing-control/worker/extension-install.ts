import { isAllowedAppOrigin } from "./extension-pairing";

/**
 * KURULUM SONRASI KARŞILAMA (SAF, testli). Eklenti mağazadan ilk kez kurulduğunda (`chrome.runtime.onInstalled`, reason
 * `install`) EmlakSoft'u yeni sekmede açar: `/app/ilan-kontrol?bagla=1`. Köken YALNIZ derleme zamanında manifest'e yazılan
 * EmlakSoft kökenlerinden gelir (başka adres açılamaz). Sayfa yalnız "Bağla" düğmesini öne çıkarır; bağlama yine gerçek
 * kullanıcı tıklamasıyla olur, otomatik token/bağlantı YOKTUR.
 */

export const INSTALL_LANDING_PATH = "/app/ilan-kontrol";
export const INSTALL_LANDING_QUERY = "bagla=1";

/** Yalnız ilk kurulumda açılır (güncelleme, tarayıcı güncellemesi, geliştirici "yeniden yükle" açmaz). */
export function shouldOpenInstallLanding(reason: string | null | undefined): boolean {
  return reason === "install";
}

/** Açılacak adres; izinli köken yoksa null (hiçbir şey açılmaz). `origins` sonuncusu birincil EmlakSoft kökenidir. */
export function installLandingUrl(origins: readonly string[]): string | null {
  const origin = origins[origins.length - 1];
  if (!origin || !isAllowedAppOrigin(origin, origins)) return null;
  return `${origin.replace(/\/$/, "")}${INSTALL_LANDING_PATH}?${INSTALL_LANDING_QUERY}`;
}

/** Sayfa `?bagla=1` ile mi açıldı. */
export function isBindLanding(value: string | null | undefined): boolean {
  return value === "1";
}
