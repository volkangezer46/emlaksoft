// Kullanıcı arayüz tercihi: "Sade görünüm" + "Yazı boyutu". ÇEREZ tabanlıdır çünkü /app layout'u
// sunucu bileşenidir: menü ve yazı ölçeği ilk HTML'de doğru gelir (hidrasyon uyumlu, yanıp sönme yok).
// Çerez adı ofis+kullanıcı kapsamlıdır; aynı tarayıcıda başka kullanıcı/ofis etkilenmez.
// Çerez yoksa (yeni kullanıcı): sade görünüm AÇIK, yazı boyutu BÜYÜK.

export type UiFont = "normal" | "large" | "xlarge";
export type UiPrefs = { simple: boolean; font: UiFont };

export const DEFAULT_UI_PREFS: UiPrefs = { simple: true, font: "large" };

export const UI_FONTS: readonly { value: UiFont; label: string; percent: number }[] = [
  { value: "normal", label: "Normal", percent: 100 },
  { value: "large", label: "Büyük", percent: 112.5 },
  { value: "xlarge", label: "Çok büyük", percent: 125 },
];

const FONT_VALUES = new Set<string>(UI_FONTS.map((f) => f.value));
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Çerez adı: yalnız güvenli karakterler (kimlikler uuid); geçersiz kimlikte null (tercih saklanmaz). */
export function uiPrefCookieName(tenantId: string | null | undefined, userId: string | null | undefined): string | null {
  const safe = (x: string | null | undefined) => (x && /^[A-Za-z0-9-]{8,64}$/.test(x) ? x : null);
  const t = safe(tenantId);
  const u = safe(userId);
  return t && u ? `es_ui_${t}_${u}` : null;
}

export function serializeUiPrefs(p: UiPrefs): string {
  return `${p.simple ? 1 : 0}.${p.font}`;
}

/** Bozuk/eksik değerde varsayılan; kısmi bozuklukta geçerli kısım korunur. */
export function parseUiPrefs(raw: string | null | undefined): UiPrefs {
  if (!raw) return DEFAULT_UI_PREFS;
  const [s, f] = raw.split(".");
  return {
    simple: s === "0" ? false : s === "1" ? true : DEFAULT_UI_PREFS.simple,
    font: f && FONT_VALUES.has(f) ? (f as UiFont) : DEFAULT_UI_PREFS.font,
  };
}

/** İstemci: çerezi yazar (çağıran ardından router.refresh() ile sunucu çıktısını yeniler). */
export function writeUiPrefsCookie(name: string, p: UiPrefs): void {
  document.cookie = `${name}=${serializeUiPrefs(p)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * SSR'da <style> olarak basılır (html'e uygulanır, kök layout'a dokunmaz; /app'ten çıkınca düşer).
 * rem tabanlı bileşenler birlikte ölçeklenir. Dokunma hedefi: Büyük/Çok büyükte 44px altı
 * etkileşimli öğeler (menü satırı, açılır menü satırı, 7/30/90 gün çipi, sabitle ikonu) 44px'e çıkar.
 */
export function uiPrefsCss(font: UiFont): string {
  if (font === "normal") return "";
  const pct = UI_FONTS.find((f) => f.value === font)?.percent ?? 100;
  return [
    `html{font-size:${pct}%}`,
    `html .nav-row{min-height:44px}`,
    `.nav-pin{min-width:44px;min-height:44px}`,
    `.pm-seg a{display:inline-flex;align-items:center;justify-content:center;min-height:44px}`,
    `[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]{min-height:44px}`,
  ].join("");
}
