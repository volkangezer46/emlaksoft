// Yazı boyutu tercihi (Küçük / Normal / Büyük). Kullanıcıya özel, cihazlar arası:
// KAYNAK Supabase auth user_metadata.font_scale (yeni tablo/migration yok); hızlı yol
// kullanıcı kimliğine bağlı birinci taraf çerez `es_font` ("<userId>.<sm|md|lg>").
// Çerez başka bir hesaba aitse yok sayılır (aynı tarayıcıda hesap değişince sızıntı olmaz).
// Yalnız /app ve /admin kabuğunda uygulanır; public site ve portallar her zaman varsayılan kalır.
// Saf yardımcılar burada (sunucu + istemci güvenli); DOM'a dokunan kısım FontScaleController'da.

export type FontScale = "sm" | "md" | "lg";

export const DEFAULT_FONT_SCALE: FontScale = "md";
export const FONT_SCALE_META_KEY = "font_scale";
export const FONT_SCALE_COOKIE = "es_font";
export const FONT_SCALE_ATTR = "data-font-size";
export const FONT_SCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Beyaz liste: tek kaynak. Yüzdeler console.css kurallarıyla senkron (sözleşme testi doğrular). */
export const FONT_SCALES: readonly { value: FontScale; label: string; percent: number }[] = [
  { value: "sm", label: "Küçük", percent: 90 },
  { value: "md", label: "Normal", percent: 100 },
  { value: "lg", label: "Büyük", percent: 112.5 },
];

const VALUES = new Set<string>(FONT_SCALES.map((f) => f.value));

export function isFontScale(value: unknown): value is FontScale {
  return typeof value === "string" && VALUES.has(value);
}

/** Geçersiz/eksik değer Normal'e düşer. */
export function parseFontScale(value: unknown): FontScale {
  return isFontScale(value) ? value : DEFAULT_FONT_SCALE;
}

export function fontScaleLabel(scale: FontScale): string {
  return FONT_SCALES.find((f) => f.value === scale)?.label ?? "Normal";
}

export function serializeFontCookie(userId: string, scale: FontScale): string {
  return `${userId}.${scale}`;
}

/** Çerez değeri yalnız bu kullanıcıya aitse ölçeği verir; aksi halde null (metadata'ya düşülür). */
export function parseFontCookie(raw: string | null | undefined, userId: string | null | undefined): FontScale | null {
  if (!raw || !userId) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const owner = raw.slice(0, dot);
  const scale = raw.slice(dot + 1);
  return owner === userId && isFontScale(scale) ? scale : null;
}

/**
 * Kaydedilmiş ölçeği çözer: önce kullanıcıya bağlı çerez, sonra auth metadata, yoksa Normal.
 * Oturum yoksa (userId yok) her zaman Normal.
 */
export function resolveFontScale(input: {
  userId: string | null | undefined;
  cookieValue?: string | null;
  metadataValue?: unknown;
}): FontScale {
  if (!input.userId) return DEFAULT_FONT_SCALE;
  const fromCookie = parseFontCookie(input.cookieValue, input.userId);
  if (fromCookie) return fromCookie;
  return parseFontScale(input.metadataValue);
}

/**
 * SSR'da kabukta <style> olarak basılır: ilk boyamada doğru ölçek (yanıp sönme yok). Yalnız öznitelik
 * HENÜZ yokken geçerlidir; istemci denetleyicisi özniteliği yazınca console.css kuralları devralır
 * (canlı önizleme). Kabuk bileşeni sökülünce stil de düşer, public sayfalar etkilenmez.
 */
export function fontScaleCss(scale: FontScale): string {
  if (scale === DEFAULT_FONT_SCALE) return "";
  const pct = FONT_SCALES.find((f) => f.value === scale)?.percent ?? 100;
  return `html:not([${FONT_SCALE_ATTR}]){font-size:${pct}%}`;
}

/** İstemci: şu an uygulanan ölçek (öznitelik yoksa null). */
export function readAppliedFontScale(): FontScale | null {
  const raw = document.documentElement.getAttribute(FONT_SCALE_ATTR);
  return isFontScale(raw) ? raw : null;
}

/** İstemci: ölçeği <html>'e uygular (kalıcı değildir; kayıt yalnız saveFontScale action'ıyla). */
export function applyFontScale(scale: FontScale): void {
  document.documentElement.setAttribute(FONT_SCALE_ATTR, scale);
}

/** Kabuktan çıkışta (public sayfaya geçiş) özniteliği kaldırır. */
export function clearFontScale(): void {
  document.documentElement.removeAttribute(FONT_SCALE_ATTR);
}
