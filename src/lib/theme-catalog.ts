// Tema kataloğu: vurgu temalarının etiket/renk tablosu ve kök layout'un satır içi önyükleme betiği.
// AYRI modül: istemci kabuğu (ThemeController, tema düğmeleri) yalnız `theme.ts` yardımcılarını ister; bu tablo ve betik
// metni yalnız görünüm paneli (tembel), komut paleti çekirdeği (sunucu) ve kök layout'ta (sunucu) gerekir.

import { ACCENT_STORAGE_KEY, DEFAULT_ACCENT, DENSITY_STORAGE_KEY, THEME_STORAGE_KEY, type AccentPref } from "./theme";

/**
 * Vurgu temaları. fill/text renkleri themes.css ile senkron (örnek kartlar için);
 * design-tokens-contract.test.ts bu tabloyu CSS ile, theme-contrast.test.ts ise
 * CSS'ten okunan değerleri WCAG AA oranlarıyla doğrular.
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
  { value: "emerald", label: "Zümrüt", hint: "Sakin ve büyüyen", fill: "#047857", text: "#065f46", fillDark: "#047e5b", textDark: "#34d399" },
  { value: "indigo", label: "İndigo", hint: "Gece mavisi derinlik", fill: "#4350d6", text: "#3a46c0", fillDark: "#5661da", textDark: "#a5b4fc" },
  { value: "amber", label: "Kehribar", hint: "Sıcak, altın vurgu", fill: "#b45309", text: "#92400e", fillDark: "#b45309", textDark: "#fbbf24" },
  { value: "graphite", label: "Grafit", hint: "Sade ve kurumsal", fill: "#334155", text: "#1e293b", fillDark: "#64748b", textDark: "#cbd5e1" },
  { value: "gold", label: "Gece Altın", hint: "Lacivert zemin, altın vurgu", fill: "#9a6700", text: "#7a5200", fillDark: "#9a6700", textDark: "#f0c36a" },
  { value: "burgundy", label: "Bordo", hint: "Bordo ve krem, sıcak prestij", fill: "#9b1c3a", text: "#7f1530", fillDark: "#cc3555", textDark: "#f08ba0" },
  { value: "petrol", label: "Petrol", hint: "Deniz yeşili, sakin", fill: "#0f766e", text: "#0b5c56", fillDark: "#107d74", textDark: "#5eead4" },
  { value: "olive", label: "Zeytin", hint: "Doğal toprak tonu", fill: "#566b1f", text: "#435516", fillDark: "#5f781d", textDark: "#bfd86b" },
];

/**
 * İlk boyamadan önce çalışır; yanıp sönmeyi önler. THEME_STORAGE_KEY,
 * ACCENT_STORAGE_KEY ve THEMED_PATH ile aynı kural; localStorage yoksa çereze düşer.
 * (Çerez SSR'da okunmaz: kök layout'ta cookies() çağrısı tüm public sayfaları
 * dinamik yapardı. Bloklayıcı satır içi script aynı FOUC'suz sonucu verir.)
 * Tanınan vurgular ACCENTS tablosundan üretilir (varsayılan hariç): yeni tema
 * eklenince script kendiliğinden güncellenir, iki liste ayrışamaz.
 */
const BOOT_ACCENTS = ACCENTS.filter((a) => a.value !== DEFAULT_ACCENT)
  .map((a) => a.value)
  .join("|");
export const THEME_BOOT_SCRIPT = `(function(){try{if(!/^\\/(app|admin)(\\/|$)/.test(location.pathname))return;var g=function(k){var v=null;try{v=localStorage.getItem(k)}catch(e){}if(v===null){var m=document.cookie.match(new RegExp("(?:^|; )"+k+"=([^;]*)"));if(m)v=decodeURIComponent(m[1])}return v};var r=document.documentElement;var t=g("${THEME_STORAGE_KEY}");var d=t==="dark"||((t===null||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)r.setAttribute("data-theme","dark");var a=g("${ACCENT_STORAGE_KEY}");if(a&&/^(${BOOT_ACCENTS})$/.test(a))r.setAttribute("data-accent",a);if(g("${DENSITY_STORAGE_KEY}")==="compact")r.setAttribute("data-density","compact")}catch(e){}})()`;
