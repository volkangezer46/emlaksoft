/**
 * Kullanıcıya özel arayüz durumu (YD5): ürün turu "görüldü" ve davet kartı "kapatıldı" işaretleri SUNUCUDA
 * (`profiles.ui_state`, yazma yalnız `profile_ui_state_mark` RPC'si), böylece cihazlar arası geçerli. localStorage
 * yalnız önbellektir. Saf modül: istemciden de içe aktarılır (sunucu modülü içermez).
 */

/** Anahtar deseni: migration'daki `profile_ui_state_mark` denetimiyle BİREBİR aynı. */
export const UI_STATE_KEY_RE = /^(tour|nudge):[a-z0-9_-]{1,48}$/;

export type UiState = Readonly<Record<string, string>>;

export function tourStateKey(tourId: string): string {
  return `tour:${tourId}`;
}

export function nudgeStateKey(moment: string): string {
  return `nudge:${moment}`;
}

export function isUiStateKey(key: string): boolean {
  return UI_STATE_KEY_RE.test(key);
}

/** Kolon değerini güvenle okur: yalnız geçerli anahtar → metin çiftleri; bozuk/eksik değer boş nesne. */
export function parseUiState(raw: unknown): UiState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isUiStateKey(k) && typeof v === "string") out[k] = v;
  }
  return out;
}
