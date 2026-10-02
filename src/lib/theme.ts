// Tema tercihi: mod ("system" | "light" | "dark") + vurgu rengi (AccentPref).
// Yalnız /app ve /admin'de uygulanır (public sayfalar açık ve marka renginde kalır).
// Saf yardımcılar burada; DOM'a dokunan kısım ThemeController'da. Kök layout'taki
// satır içi script (THEME_BOOT_SCRIPT) aynı kuralı ilk boyamadan önce uygular —
// iki yer senkron kalmalı. Kalıcılık: localStorage + çerez yedeği (DB'siz).

export type ThemePref = "system" | "light" | "dark";
export type AccentPref = "ocean" | "emerald" | "indigo" | "amber" | "graphite";

/**
 * Vurgu temaları. fill/text renkleri themes.css ile senkron (örnek kartlar için);
 * design-tokens-contract.test.ts bu tabloyu CSS ve AA kontrastıyla doğrular.
 */
export const ACCENTS: {
  value: AccentPref;
  label: string;
  hint: string;
  fill: string;
  text: string;
  fillDark: string;
  textDark: string;
}[] = [
  { value: "ocean", label: "Okyanus", hint: "Güven veren mavi", fill: "#1463ff", text: "#0b4fd6", fillDark: "#1463ff", textDark: "#7aa9ff" },
  { value: "emerald", label: "Zümrüt", hint: "Sakin ve büyüyen", fill: "#047857", text: "#065f46", fillDark: "#047857", textDark: "#34d399" },
  { value: "indigo", label: "İndigo", hint: "Gece mavisi derinlik", fill: "#4350d6", text: "#3a46c0", fillDark: "#4350d6", textDark: "#a5b4fc" },
  { value: "amber", label: "Kehribar", hint: "Sıcak, altın vurgu", fill: "#b45309", text: "#92400e", fillDark: "#b45309", textDark: "#fbbf24" },
  { value: "graphite", label: "Grafit", hint: "Sade ve kurumsal", fill: "#334155", text: "#1e293b", fillDark: "#64748b", textDark: "#cbd5e1" },
];

export const THEME_STORAGE_KEY = "es-theme";
export const ACCENT_STORAGE_KEY = "es-accent";
export const THEME_EVENT = "es-theme-change";
export const THEMED_PATH = /^\/(app|admin)(\/|$)/;
export const DEFAULT_ACCENT: AccentPref = "ocean";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemePref(value: unknown): value is ThemePref {
  return value === "system" || value === "light" || value === "dark";
}

export function isAccentPref(value: unknown): value is AccentPref {
  return typeof value === "string" && ACCENTS.some((a) => a.value === value);
}

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): "light" | "dark" {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

export function isThemedPath(pathname: string): boolean {
  return THEMED_PATH.test(pathname);
}

function readStored(key: string): string | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return raw;
  } catch {
    // localStorage kapalı: çerezden okunur.
  }
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${key}=`));
  return match ? decodeURIComponent(match.slice(key.length + 1)) : null;
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Depolama kapalı (özel pencere vb.): çerez yedeği yine de yazılır.
  }
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

export function readThemePref(): ThemePref {
  const raw = readStored(THEME_STORAGE_KEY);
  return isThemePref(raw) ? raw : "system";
}

export function writeThemePref(pref: ThemePref): void {
  writeStored(THEME_STORAGE_KEY, pref);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function readAccentPref(): AccentPref {
  const raw = readStored(ACCENT_STORAGE_KEY);
  return isAccentPref(raw) ? raw : DEFAULT_ACCENT;
}

export function writeAccentPref(pref: AccentPref): void {
  writeStored(ACCENT_STORAGE_KEY, pref);
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

/** <html> üzerindeki data-theme ve data-accent'i tercihe göre ayarlar. */
export function applyTheme(): void {
  const root = document.documentElement;
  const dark = resolveTheme(readThemePref(), window.matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
  if (dark) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  const accent = readAccentPref();
  if (accent === DEFAULT_ACCENT) root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", accent);
}

/** Çıkışta (public sayfaya geçiş) tüm tema özniteliklerini kaldırır. */
export function clearTheme(): void {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
}

/**
 * İlk boyamadan önce çalışır; yanıp sönmeyi önler. THEME_STORAGE_KEY,
 * ACCENT_STORAGE_KEY ve THEMED_PATH ile aynı kural; localStorage yoksa çereze düşer.
 * (Çerez SSR'da okunmaz: kök layout'ta cookies() çağrısı tüm public sayfaları
 * dinamik yapardı. Bloklayıcı satır içi script aynı FOUC'suz sonucu verir.)
 */
export const THEME_BOOT_SCRIPT = `(function(){try{if(!/^\\/(app|admin)(\\/|$)/.test(location.pathname))return;var g=function(k){var v=null;try{v=localStorage.getItem(k)}catch(e){}if(v===null){var m=document.cookie.match(new RegExp("(?:^|; )"+k+"=([^;]*)"));if(m)v=decodeURIComponent(m[1])}return v};var r=document.documentElement;var t=g("${THEME_STORAGE_KEY}");var d=t==="dark"||((t===null||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)r.setAttribute("data-theme","dark");var a=g("${ACCENT_STORAGE_KEY}");if(a&&/^(emerald|indigo|amber|graphite)$/.test(a))r.setAttribute("data-accent",a)}catch(e){}})()`;
