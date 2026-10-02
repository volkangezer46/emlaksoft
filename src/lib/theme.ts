// Tema tercihi: "system" | "light" | "dark". Yalnız /app ve /admin'de uygulanır
// (public sayfalar açık kalır). Saf yardımcılar burada; DOM'a dokunan kısım
// ThemeController'da. Kök layout'taki satır içi script (THEME_BOOT_SCRIPT) aynı
// kuralı ilk boyamadan önce uygular — iki yer senkron kalmalı.

export type ThemePref = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "es-theme";
export const THEME_EVENT = "es-theme-change";
export const THEMED_PATH = /^\/(app|admin)(\/|$)/;

export function isThemePref(value: unknown): value is ThemePref {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): "light" | "dark" {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

export function isThemedPath(pathname: string): boolean {
  return THEMED_PATH.test(pathname);
}

export function readThemePref(): ThemePref {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePref(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function writeThemePref(pref: ThemePref): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Depolama kapalı (özel pencere vb.): tercih yalnız bu oturumda geçerli olmaz.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

/** <html> üzerindeki data-theme'i tercihe göre ayarlar. */
export function applyTheme(): void {
  const root = document.documentElement;
  const dark = resolveTheme(readThemePref(), window.matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
  if (dark) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

/** İlk boyamadan önce çalışır; yanıp sönmeyi önler. THEME_STORAGE_KEY ve THEMED_PATH ile aynı kural. */
export const THEME_BOOT_SCRIPT = `(function(){try{if(!/^\\/(app|admin)(\\/|$)/.test(location.pathname))return;var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t==="dark"||((t===null||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`;
