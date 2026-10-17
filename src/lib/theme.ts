// Tema tercihi: mod ("system" | "light" | "dark") + vurgu rengi (AccentPref).
// Yalnız /app ve /admin'de uygulanır (public sayfalar açık ve marka renginde kalır).
// Saf yardımcılar burada; DOM'a dokunan kısım ThemeController'da. Kök layout'taki
// satır içi script (THEME_BOOT_SCRIPT) aynı kuralı ilk boyamadan önce uygular —
// iki yer senkron kalmalı. Kalıcılık: localStorage + çerez yedeği (DB'siz).

export type ThemePref = "system" | "light" | "dark";
/** Vurgu temalarının değerleri (tanınan `data-accent`). Etiket/renk tablosu `theme-catalog.ts` `ACCENTS` (aynı sıra). */
export const ACCENT_VALUES = ["ocean", "emerald", "indigo", "amber", "graphite", "gold", "burgundy", "petrol", "olive"] as const;
export type AccentPref = (typeof ACCENT_VALUES)[number];

export const THEME_STORAGE_KEY = "es-theme";
export const ACCENT_STORAGE_KEY = "es-accent";
export const DENSITY_STORAGE_KEY = "es-density";
export const THEME_EVENT = "es-theme-change";
export const THEMED_PATH = /^\/(app|admin)(\/|$)/;
export const DEFAULT_ACCENT: AccentPref = "ocean";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type DensityPref = "comfortable" | "compact";
export const DEFAULT_DENSITY: DensityPref = "comfortable";
export function isDensityPref(value: unknown): value is DensityPref {
  return value === "comfortable" || value === "compact";
}

export function isThemePref(value: unknown): value is ThemePref {
  return value === "system" || value === "light" || value === "dark";
}

export function isAccentPref(value: unknown): value is AccentPref {
  return typeof value === "string" && (ACCENT_VALUES as readonly string[]).includes(value);
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

export function readDensityPref(): DensityPref {
  const raw = readStored(DENSITY_STORAGE_KEY);
  return isDensityPref(raw) ? raw : DEFAULT_DENSITY;
}

export function writeDensityPref(pref: DensityPref): void {
  writeStored(DENSITY_STORAGE_KEY, pref);
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
  if (readDensityPref() === "compact") root.setAttribute("data-density", "compact");
  else root.removeAttribute("data-density");
}

/** Çıkışta (public sayfaya geçiş) tüm tema özniteliklerini kaldırır. */
export function clearTheme(): void {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
  document.documentElement.removeAttribute("data-density");
}
