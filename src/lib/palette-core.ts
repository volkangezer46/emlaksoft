import { ICONS } from "@/lib/icons";
import { visibleSections, type NavIcon } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";

/**
 * Komut paletleri (/app ve /admin) için ortak mantık: arama süzgeci, yetkiye göre
 * "Git" / "Eylemler" listeleri ve localStorage destekli "Son görülenler" deposu.
 * İki palet farklı arama kaynaklarına sahip olduğundan görünüm ayrı kalır;
 * veri ve davranış burada tek yerdedir.
 */

/** Yan menüdeki arama düğmesi komut paletini bu olayla açar (ikinci bir arama kutusu YOK). */
export const OPEN_PALETTE_EVENT = "es-open-palette";

export type PaletteEntry = { label: string; href: string; icon: NavIcon; shortcut?: string };

/** Türkçe duyarlı (İ/ı) büyük-küçük harf bağımsız içerme kontrolü. */
export function matchesQuery(label: string, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("tr-TR");
  if (!needle) return true;
  return label.toLocaleLowerCase("tr-TR").includes(needle);
}

/**
 * Üst çubuk "Yeni" menüsü ve komut paleti "Eylemler" grubunun TEK kaynağı: her `/yeni`
 * sayfası (16) + görüşme kaydı. `shortcut`, keyboard-shortcuts.tsx'teki `n` önekli
 * dizilerle birebir aynıdır (kısayol sözleşme testi bunu doğrular).
 */
export type AppAction = PaletteEntry & { module: AppModule };

export const APP_ACTIONS: readonly AppAction[] = [
  { label: "Yeni müşteri", href: "/app/musteriler/yeni", icon: ICONS.musteri, module: "customers", shortcut: "n m" },
  { label: "Yeni talep", href: "/app/talepler/yeni", icon: ICONS.talep, module: "demands", shortcut: "n t" },
  { label: "Yeni portföy", href: "/app/portfoyler/yeni", icon: ICONS.portfoy, module: "properties", shortcut: "n p" },
  { label: "Yeni randevu", href: "/app/randevular/yeni", icon: ICONS.randevu, module: "appointments", shortcut: "n r" },
  { label: "Yeni görev", href: "/app/gorevler/yeni", icon: ICONS.gorev, module: "tasks", shortcut: "n g" },
  { label: "Yeni anlaşma", href: "/app/anlasmalar/yeni", icon: ICONS.anlasma, module: "commissions", shortcut: "n a" },
  { label: "Yeni teklif", href: "/app/teklifler/yeni", icon: ICONS.teklif, module: "offers" },
  { label: "Yeni sözleşme", href: "/app/sozlesmeler/yeni", icon: ICONS.sozlesme, module: "contracts" },
  { label: "Yeni kiralama", href: "/app/kiralama/yeni", icon: ICONS.anahtar, module: "rentals" },
  { label: "Yeni proje", href: "/app/projeler/yeni", icon: ICONS.proje, module: "projects" },
  { label: "Yeni açık ev", href: "/app/acik-ev/yeni", icon: ICONS.acikEv, module: "open_house" },
  { label: "Yeni sunum", href: "/app/portfoyler/sunumlar/yeni", icon: ICONS.sunum, module: "properties" },
  { label: "Yeni kampanya", href: "/app/kampanyalar/yeni", icon: ICONS.mesaj, module: "campaigns" },
  { label: "Yeni onay talebi", href: "/app/onaylar/yeni", icon: ICONS.onay, module: "commissions" },
  { label: "Yeni otomasyon", href: "/app/otomasyonlar/yeni", icon: ICONS.otomasyon, module: "settings" },
  { label: "Yeni destek talebi", href: "/app/destek/yeni", icon: ICONS.destek, module: "support" },
  { label: "Görüşme kaydet", href: "/app/arama", icon: ICONS.telefon, module: "calls" },
];

/**
 * "Eylemler" grubu: erişilebilen modüllerin hızlı oluşturma bağlantıları.
 * `locked`: pakete dahil olmayan sayfalar (yükseltme sayfasına düşmesin diye elenir).
 */
export function getAppActions(accessible: readonly AppModule[], q = "", locked: readonly string[] = []): PaletteEntry[] {
  return APP_ACTIONS.filter(
    (a) =>
      accessible.includes(a.module) &&
      !locked.some((l) => a.href === l || a.href.startsWith(`${l}/`)) &&
      matchesQuery(a.label, q),
  ).map(({ label, href, icon, shortcut }) => ({ label, href, icon, shortcut }));
}
/** "Git" grubu: nav-config'teki yetkili sayfalar (menüyle birebir aynı süzgeç). */
export function getAppGoItems(accessible: readonly AppModule[], q = ""): PaletteEntry[] {
  return visibleSections(accessible)
    .flatMap((s) => s.items)
    .flatMap((i) => (i.tabs && i.tabs.length > 1 ? i.tabs : [i]))
    .filter((i) => matchesQuery(i.label, q))
    .map(({ label, href, icon }) => ({ label, href, icon }));
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
