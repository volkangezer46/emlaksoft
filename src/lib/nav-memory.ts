/**
 * Yan menü "Sabitlenenler" ve "Son kullanılanlar" belleği.
 * Yalnız SAYFA YOLLARI saklanır (müşteri adı/kimlik gibi kişisel veri YOK); anahtar
 * ofis+kullanıcı kapsamlıdır. Okunurken menüdeki yetkili yollarla süzülür, yani yetki
 * kaybedilen sayfa belleğte kalsa bile görünmez.
 */

export const MAX_PINS = 6;
export const MAX_NAV_RECENTS = 5;
/** Menüde en çok kaç "son kullanılan" satırı görünür (liste kısa kalsın, aktif öğe itilmesin). */
export const MAX_RECENT_SHOWN = 2;

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

/** Güvenli admin yolu: /admin veya /admin/... (admin menüsünün Hızlı erişim belleği). */
export function isAdminHref(x: unknown): x is string {
  return typeof x === "string" && /^\/admin(\/[a-z0-9-]+)*$/.test(x);
}

export function parseAdminHrefs(raw: string | null, max: number): string[] {
  if (!raw) return NO_HREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_HREFS;
    return [...new Set(parsed.filter(isAdminHref))].slice(0, max);
  } catch {
    return NO_HREFS;
  }
}

/**
 * Menü durum kimliği (closedStore): "<önek>-<yol dilimi>" (ör. alt-musteriler). Depo kimlik kuralına
 * (küçük harf/rakam/tire, en çok 32) uyar; /app ve /admin önekleri atılır.
 */
export function navStateId(prefix: string, href: string): string {
  const slug = href
    .replace(/^\/(app|admin)\/?/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug || "ana"}`.slice(0, 32);
}

/* ------------------------- Kullanım sayacı (en çok kullanılanlar) ------------------------- */

/** Menüde otomatik "en çok kullandıkların" satır sayısı. */
export const MAX_TOP_USED = 4;
/** Bir sayfa en az bu kadar ziyaret edilmeden "çok kullanılan" sayılmaz (rastgele tıklama öne çıkmasın). */
export const MIN_USES_FOR_TOP = 3;
/** Sayaç tablosunda tutulan en çok sayfa; aşılırsa en az kullanılanlar atılır. */
export const MAX_USAGE_ENTRIES = 40;
/** Bir sayaç bu değere ulaşınca tüm sayaçlar yarıya iner (eski alışkanlıklar zamanla sönsün). */
export const USAGE_HALVE_AT = 200;

export type NavUsage = Readonly<Record<string, number>>;
const NO_USAGE: NavUsage = Object.freeze({});

function trimUsage(u: Record<string, number>): NavUsage {
  const entries = Object.entries(u).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries.slice(0, MAX_USAGE_ENTRIES));
}

/** Yerel sayaç ayrıştırıcı: yalnız güvenli yol + pozitif tam sayı; bozuk veri boş sayılır. */
export function parseUsage(raw: string | null, accept: (x: unknown) => x is string = isNavHref): NavUsage {
  if (!raw) return NO_USAGE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NO_USAGE;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (accept(k) && typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1_000_000) out[k] = v;
    }
    return trimUsage(out);
  } catch {
    return NO_USAGE;
  }
}

/** Bir sayfa ziyaretini sayar (saf; yeni nesne döner). Eşik aşılırsa tüm sayaçlar yarıya iner. */
export function bumpUsage(usage: NavUsage, href: string): NavUsage {
  const next: Record<string, number> = { ...usage, [href]: (usage[href] ?? 0) + 1 };
  if ((next[href] ?? 0) >= USAGE_HALVE_AT) {
    for (const k of Object.keys(next)) {
      const half = Math.floor((next[k] ?? 0) / 2);
      if (half > 0) next[k] = half;
      else delete next[k];
    }
  }
  return trimUsage(next);
}

/**
 * "En çok kullandıkların": eşiği geçen, hariç tutulmayan, sayaca göre azalan ilk N yol.
 * `allowed` verilirse yalnız menüde (yetkili) olan yollar döner; eşitlikte yol sırası sabittir.
 */
export function topUsed(
  usage: NavUsage,
  opts: { exclude?: readonly string[]; allowed?: ReadonlySet<string>; limit?: number } = {},
): string[] {
  const { exclude = [], allowed, limit = MAX_TOP_USED } = opts;
  return Object.entries(usage)
    .filter(([h, n]) => n >= MIN_USES_FOR_TOP && !exclude.includes(h) && (!allowed || allowed.has(h)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([h]) => h);
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
export function getHrefStore(kind: NavMemoryKind, scope: string | undefined, accept: "app" | "admin" = "app") {
  const key = navMemoryKey(kind, scope);
  let s = stores.get(key);
  if (!s) {
    const parse = accept === "admin" ? parseAdminHrefs : parseHrefs;
    s =
      kind === "closed"
        ? createHrefStore(key, 64, parseIds)
        : createHrefStore(key, kind === "pins" ? MAX_PINS : MAX_NAV_RECENTS, parse);
    stores.set(key, s);
  }
  return s;
}

/** Kullanım sayacı deposu (useSyncExternalStore uyumlu); depolama kapalıysa yalnız oturum içi. */
export function createUsageStore(key: string, accept: (x: unknown) => x is string = isNavHref) {
  let rawCache: string | null = null;
  let cache: NavUsage = NO_USAGE;
  const listeners = new Set<() => void>();

  function read(): NavUsage {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return cache;
    }
    if (raw !== rawCache) {
      rawCache = raw;
      cache = parseUsage(raw, accept);
    }
    return cache;
  }

  function write(next: NavUsage) {
    const empty = Object.keys(next).length === 0;
    const raw = JSON.stringify(next);
    try {
      if (empty) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, raw);
    } catch {
      // depolama kapalı/dolu — yalnız oturum içi
    }
    rawCache = empty ? null : raw;
    cache = next;
    listeners.forEach((l) => l());
  }

  return {
    read,
    write,
    /** Sayaçları sıfırla (Hızlı erişim "Sıfırla"). */
    reset: () => write(NO_USAGE),
    getServerSnapshot: (): NavUsage => NO_USAGE,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

const usageStores = new Map<string, ReturnType<typeof createUsageStore>>();
export function getUsageStore(scope: string | undefined, accept: "app" | "admin" = "app") {
  const key = `es-nav-usage:${scope ?? "anon"}`;
  let s = usageStores.get(key);
  if (!s) {
    s = createUsageStore(key, accept === "admin" ? isAdminHref : isNavHref);
    usageStores.set(key, s);
  }
  return s;
}
