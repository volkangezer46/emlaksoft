import { STATIC_ROUTES, type StaticRouteDef, type StaticRouteId } from "@/lib/static-home/registry";

/**
 * Statik sayfa anahtarları (SAF; G/Ç yok).
 *  - `statik.routes` = {"<id>": true|false} (platform_settings, düz JSON). Proxy bunu bakım/kayıt bayraklarıyla AYNI
 *    okumada alır (src/lib/platform-flags-cache.ts, 30 sn TTL) → istek başına ek DB turu yok, değişiklik ≤60 sn'de etkin.
 *  - `statik.rev` = tamsayı sayaç; her süreç 5 sn TTL ile okur, değişince kendi bellek önbelleğini düşürür (cache.ts).
 *  - ENV ÜSTÜNLÜĞÜ: `STATIC_HOME=off` tüm statik sunumu kapatır (eski genel kapatma anahtarı); `STATIC_PAGES=off` ana
 *    sayfa dışındaki statik sayfaları kapatır. DB ayarı env kapatmasını hiçbir zaman ezemez.
 */
export const STATIC_ROUTES_SETTING_KEY = "statik.routes";
export const STATIC_REV_SETTING_KEY = "statik.rev";

export type StaticRouteToggles = Partial<Record<StaticRouteId, boolean>>;

/** Ham ayar metni → anahtar haritası (bozuk/eksik değer = boş harita → varsayılanlar). */
export function parseStaticRoutes(raw: string | null | undefined): StaticRouteToggles {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: StaticRouteToggles = {};
    for (const r of STATIC_ROUTES) {
      const b = (v as Record<string, unknown>)[r.id];
      if (typeof b === "boolean") out[r.id] = b;
    }
    return out;
  } catch {
    return {};
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const isOff = (v: string | undefined) => v?.trim().toLowerCase() === "off";

/** Env bu rotayı kapatıyor mu? (DB'den bağımsız; yönetim ekranında "env ile kapatıldı" durumu.) */
export function envDisables(route: Pick<StaticRouteDef, "id">, env: Env = process.env): boolean {
  if (isOff(env.STATIC_HOME)) return true;
  return route.id !== "home" && isOff(env.STATIC_PAGES);
}

export type StaticRouteMode = "on" | "off" | "env_off" | "disabled";

/** Tek rotanın etkin durumu: kalıcı kapalı > env kapatması > DB anahtarı > varsayılan. */
export function staticRouteMode(route: StaticRouteDef, toggles: StaticRouteToggles, env: Env = process.env): StaticRouteMode {
  if (route.disabled) return "disabled";
  if (envDisables(route, env)) return "env_off";
  return (toggles[route.id] ?? route.defaultEnabled) ? "on" : "off";
}

/** Proxy için açık kimlikler kümesi. */
export function enabledStaticIds(routesRaw: string | null | undefined, env: Env = process.env): ReadonlySet<StaticRouteId> {
  const toggles = parseStaticRoutes(routesRaw);
  const out = new Set<StaticRouteId>();
  for (const r of STATIC_ROUTES) if (staticRouteMode(r, toggles, env) === "on") out.add(r.id);
  return out;
}

/** `statik.rev` ham değeri → tamsayı (yoksa/bozuksa 0). */
export function parseStaticRev(raw: string | null | undefined): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
