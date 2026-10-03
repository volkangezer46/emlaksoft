/**
 * Yan menü "Sabitlenenler" ve "Son kullanılanlar" belleği.
 * Yalnız SAYFA YOLLARI saklanır (müşteri adı/kimlik gibi kişisel veri YOK); anahtar
 * ofis+kullanıcı kapsamlıdır. Okunurken menüdeki yetkili yollarla süzülür, yani yetki
 * kaybedilen sayfa belleğte kalsa bile görünmez.
 */

export const MAX_PINS = 6;
export const MAX_NAV_RECENTS = 5;
/** Menüde en çok kaç "son kullanılan" satırı görünür (liste kısa kalsın, aktif öğe itilmesin). */
export const MAX_RECENT_SHOWN = 3;

const NO_HREFS: string[] = [];

/** Güvenli yol: /app veya /app/... (protokol-göreli ve dış adres olamaz). */
export function isNavHref(x: unknown): x is string {
  return typeof x === "string" && /^\/app(\/[a-z0-9-]+)*$/.test(x);
}

export function parseHrefs(raw: string | null, max: number): string[] {
  if (!raw) return NO_HREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_HREFS;
    return [...new Set(parsed.filter(isNavHref))].slice(0, max);
  } catch {
    return NO_HREFS;
  }
}

/** Kapalı bölüm kimlikleri (örn. "musteriler"): yalnız küçük harf/rakam/tire. */
export function parseIds(raw: string | null, max: number): string[] {
  if (!raw) return NO_HREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_HREFS;
    return [...new Set(parsed.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x)))].slice(0, max);
  } catch {
    return NO_HREFS;
  }
}

export function togglePin(list: readonly string[], href: string): string[] {
  if (list.includes(href)) return list.filter((h) => h !== href);
  return [...list, href].slice(-MAX_PINS);
}

export function pushRecent(list: readonly string[], href: string): string[] {
  return [href, ...list.filter((h) => h !== href)].slice(0, MAX_NAV_RECENTS);
}

export type NavMemoryKind = "pins" | "recent" | "closed";

export function navMemoryKey(kind: NavMemoryKind, scope: string | undefined): string {
  return `es-nav-${kind}:${scope ?? "anon"}`;
}

/** useSyncExternalStore uyumlu küçük store; depolama kapalıysa yalnız oturum içi çalışır. */
export function createHrefStore(key: string, max: number, parse: (raw: string | null, max: number) => string[] = parseHrefs) {
  let rawCache: string | null = null;
  let cache: string[] = NO_HREFS;
  const listeners = new Set<() => void>();

  function read(): string[] {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return cache;
    }
    if (raw !== rawCache) {
      rawCache = raw;
      cache = parse(raw, max);
    }
    return cache;
  }

  return {
    read,
    getServerSnapshot: (): string[] => NO_HREFS,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    write(next: string[]) {
      const raw = JSON.stringify(next);
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // depolama kapalı/dolu — yalnız oturum içi
      }
      rawCache = raw;
      cache = next;
      listeners.forEach((l) => l());
    },
  };
}

const stores = new Map<string, ReturnType<typeof createHrefStore>>();
export function getHrefStore(kind: NavMemoryKind, scope: string | undefined) {
  const key = navMemoryKey(kind, scope);
  let s = stores.get(key);
  if (!s) {
    s =
      kind === "closed"
        ? createHrefStore(key, 24, parseIds)
        : createHrefStore(key, kind === "pins" ? MAX_PINS : MAX_NAV_RECENTS);
    stores.set(key, s);
  }
  return s;
}
