/**
 * TARAYICI / İŞLETİM SİSTEMİ ALGILAMA (SAF, testli; saat/DOM yok). Eklenti Chromium tabanlı masaüstü tarayıcılarda çalışır:
 * Chrome, Brave, Arc, Opera, Vivaldi → Chrome Web Store; Edge → Edge Add-ons. Safari, Firefox ve mobil tarayıcılar desteklenmez.
 * `userAgentData` varsa o, yoksa UA metni kullanılır.
 */

export type BrowserFamily = "chrome" | "edge" | "unsupported";
export type OsFamily = "mac" | "windows" | "other";

export type BrowserInfo = {
  family: BrowserFamily;
  /** Kullanıcıya gösterilen ad (örn. "Chrome", "Safari"). */
  name: string;
  os: OsFamily;
  mobile: boolean;
};

export type BrowserSignals = {
  ua?: string | null;
  platform?: string | null;
  brands?: readonly string[] | null;
  mobile?: boolean | null;
  touchPoints?: number | null;
};

export function detectBrowser(s: BrowserSignals): BrowserInfo {
  const ua = s.ua ?? "";
  const brands = (s.brands ?? []).map((b) => b.toLowerCase());
  const platform = `${s.platform ?? ""} ${ua}`.toLowerCase();

  const iosLike = /iphone|ipad|ipod/.test(platform) || (/mac/.test(platform) && (s.touchPoints ?? 0) > 1);
  const mobile = s.mobile === true || /android|iphone|ipad|ipod|mobile/i.test(ua) || iosLike;
  const os: OsFamily = iosLike ? "other" : /mac/.test(platform) ? "mac" : /win/.test(platform) ? "windows" : "other";

  const has = (re: RegExp) => re.test(ua);
  const brand = (re: RegExp) => brands.some((b) => re.test(b));

  let family: BrowserFamily = "unsupported";
  let name = "Bu tarayıcı";
  if (has(/firefox\/|fxios/i)) name = "Firefox";
  else if (brand(/edge/) || has(/\bedg(e|a|ios)?\//i)) {
    name = "Edge";
    family = "edge";
  } else if (brand(/opera/) || has(/\bopr\/|opera/i)) {
    name = "Opera";
    family = "chrome";
  } else if (brand(/brave/)) {
    name = "Brave";
    family = "chrome";
  } else if (brand(/vivaldi/) || has(/vivaldi/i)) {
    name = "Vivaldi";
    family = "chrome";
  } else if (brand(/chrom/) || has(/\b(chrome|chromium|crios)\//i)) {
    name = "Chrome";
    family = "chrome";
  } else if (has(/safari\//i)) name = "Safari";

  if (mobile) family = "unsupported";
  return { family, name, os, mobile };
}

/** Düzenleyici tuş adı: Mac'te ⌘, diğerlerinde Ctrl. */
export function modKey(os: OsFamily): string {
  return os === "mac" ? "⌘" : "Ctrl";
}

export type InstallAction =
  | { kind: "store"; store: "chrome" | "edge"; href: string; label: string }
  | { kind: "zip"; href: string }
  | { kind: "none" }
  | { kind: "unsupported" };

/**
 * Tek birincil eylem: mağaza adresi tanımlıysa "Chrome'a ekle" / "Edge'e ekle"; tanımsızsa ZIP + yerel kurulum yönergesine düşer.
 * Edge, Chrome Web Store'dan da eklenti kurabildiği için yalnız Chrome adresi tanımlıysa Edge'e o adres verilir.
 */
export function pickInstallAction(b: BrowserInfo, urls: { chrome: string | null; edge: string | null; zip: string | null }): InstallAction {
  if (b.family === "unsupported") return { kind: "unsupported" };
  if (b.family === "edge") {
    const href = urls.edge ?? urls.chrome;
    if (href) return { kind: "store", store: urls.edge ? "edge" : "chrome", href, label: "Edge'e ekle" };
  } else if (urls.chrome) {
    return { kind: "store", store: "chrome", href: urls.chrome, label: "Chrome'a ekle" };
  }
  return urls.zip ? { kind: "zip", href: urls.zip } : { kind: "none" };
}
