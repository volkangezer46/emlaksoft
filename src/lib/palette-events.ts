/**
 * Komut paleti yardımcılarının BAĞIMLILIKSIZ çekirdeği: açma olayı, Türkçe arama süzgeci ve "Son görülenler" deposu.
 * İkon tablosu (ICONS), nav-config ve tema modüllerine dokunmaz; böylece /admin paleti ve hızlı erişim şeridi
 * bunları kullanırken /app menü kataloğunu istemci paketine taşımaz. `palette-core` aynı adları yeniden dışa aktarır.
 */

/**
 * Komut paletini açan olay (ikinci bir arama kutusu YOK): yan menüdeki arama düğmesi ve ana ekran kutusu gönderir.
 * İsteğe bağlı `detail: { q?: string }` başlangıç metnidir (bkz. `openPalette`).
 */
export const OPEN_PALETTE_EVENT = "es-open-palette";

/** Türkçe duyarlı (İ/ı) büyük-küçük harf bağımsız içerme kontrolü. */
export function matchesQuery(label: string, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("tr-TR");
  if (!needle) return true;
  return label.toLocaleLowerCase("tr-TR").includes(needle);
}

/**
 * Palete DIŞARIDAN erişim (ana ekrandaki "Ne yapmak istiyorsun?" kutusu vb.): `OPEN_PALETTE_EVENT` olayı.
 * `detail.q` verilirse palet bu başlangıç metniyle açılır ve arama hemen çalışır; verilmezse boş açılır.
 * Kullanım: `openPalette("havuz")` ya da elle
 * `window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { q: "havuz" } }))`.
 */
export type OpenPaletteDetail = { q?: string };

export function openPalette(q?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenPaletteDetail>(OPEN_PALETTE_EVENT, { detail: q ? { q } : {} }));
}

/** Olay gövdesinden başlangıç metni (olay düz `Event` ise ya da detail yoksa boş). */
export function paletteQueryFromEvent(e: Event): string {
  const detail = (e as CustomEvent<OpenPaletteDetail | undefined>).detail;
  return typeof detail?.q === "string" ? detail.q.slice(0, 200) : "";
}

/* ------------------------------ Son görülenler ------------------------------ */

export type RecentItem = { label: string; href: string; kind: string };

const MAX_RECENTS = 8;
const NO_RECENTS: RecentItem[] = [];

/** Bozuk/yabancı localStorage içeriğini güvenle RecentItem listesine çevirir. */
export function parseRecents(raw: string | null): RecentItem[] {
  if (!raw) return NO_RECENTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NO_RECENTS;
    return parsed
      .filter(
        (x): x is RecentItem =>
          !!x &&
          typeof x === "object" &&
          typeof (x as RecentItem).label === "string" &&
          typeof (x as RecentItem).href === "string" &&
          /^\/app(\/|\?|$)/.test((x as RecentItem).href) &&
          typeof (x as RecentItem).kind === "string",
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return NO_RECENTS;
  }
}

/** Yeni kaydı başa alır, aynı href'i tekrarlamaz, en fazla 8 tutar. */
export function mergeRecent(list: readonly RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((r) => r.href !== item.href)].slice(0, MAX_RECENTS);
}

/**
 * useSyncExternalStore ile uyumlu küçük dış store (anahtar başına bir tane).
 * SSR'da boş liste döner; depolama kapalıysa yalnız oturum içi çalışır (try/catch).
 */
export function createRecentsStore(key: string) {
  let rawCache: string | null = null;
  let cache: RecentItem[] = NO_RECENTS;
  const listeners = new Set<() => void>();

  function read(): RecentItem[] {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return cache;
    }
    if (raw !== rawCache) {
      rawCache = raw;
      cache = parseRecents(raw);
    }
    return cache;
  }

  return {
    read,
    getServerSnapshot: (): RecentItem[] => NO_RECENTS,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    push(item: RecentItem) {
      const next = mergeRecent(read(), item);
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
