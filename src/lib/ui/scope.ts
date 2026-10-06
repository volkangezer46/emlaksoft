// Ofis geneli / Benim işlerim kapsam tercihi (ScopeSwitch). Saf yardımcılar: sunucu + istemci güvenli.
// Tercih yalnız GÖRÜNÜM içindir; yetki her istekte rolden yeniden çözülür (danışman "ofis" çerezi taşısa da
// yönetim rolü olmadığı için ofis geneline geçemez).

export type ScopeValue = "ofis" | "ben";

export const SCOPE_COOKIE = "es_scope";
export const SCOPE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export function parseScope(raw: unknown): ScopeValue | null {
  return raw === "ofis" || raw === "ben" ? raw : null;
}

/**
 * Etkin kapsam: URL (`?kapsam=`) > son seçim çerezi > varsayılan "ben". Yönetim rolü değilse her zaman "ben".
 * `explicit`: URL'de geçerli kapsam var mı (bağlantılar bunu korur).
 */
export function resolveScope(input: { canSwitch: boolean; param: unknown; cookie: unknown }): { scope: ScopeValue; explicit: ScopeValue | null } {
  if (!input.canSwitch) return { scope: "ben", explicit: null };
  const explicit = parseScope(input.param);
  return { scope: explicit ?? parseScope(input.cookie) ?? "ben", explicit };
}
