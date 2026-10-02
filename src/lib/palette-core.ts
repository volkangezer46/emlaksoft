import { Building2, CalendarDays, ListChecks, UserPlus } from "lucide-react";
import { visibleSections, type NavIcon } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";

/**
 * Komut paletleri (/app ve /admin) için ortak mantık: arama süzgeci, yetkiye göre
 * "Git" / "Eylemler" listeleri ve localStorage destekli "Son görülenler" deposu.
 * İki palet farklı arama kaynaklarına sahip olduğundan görünüm ayrı kalır;
 * veri ve davranış burada tek yerdedir.
 */

export type PaletteEntry = { label: string; href: string; icon: NavIcon };

/** Türkçe duyarlı (İ/ı) büyük-küçük harf bağımsız içerme kontrolü. */
export function matchesQuery(label: string, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("tr-TR");
  if (!needle) return true;
  return label.toLocaleLowerCase("tr-TR").includes(needle);
}

const APP_ACTIONS: (PaletteEntry & { module: AppModule })[] = [
  { label: "Yeni müşteri", href: "/app/musteriler?yeni=1", icon: UserPlus, module: "customers" },
  { label: "Yeni portföy", href: "/app/portfoyler?yeni=1", icon: Building2, module: "properties" },
  { label: "Yeni randevu", href: "/app/randevular/yeni", icon: CalendarDays, module: "appointments" },
  { label: "Yeni görev", href: "/app/gorevler/yeni", icon: ListChecks, module: "tasks" },
];

/** "Eylemler" grubu: kullanıcının erişebildiği modüllerin hızlı oluşturma bağlantıları. */
export function getAppActions(accessible: readonly AppModule[], q = ""): PaletteEntry[] {
  return APP_ACTIONS.filter((a) => accessible.includes(a.module) && matchesQuery(a.label, q)).map(
    ({ label, href, icon }) => ({ label, href, icon }),
  );
}

/** "Git" grubu: nav-config'teki yetkili sayfalar (menüyle birebir aynı süzgeç). */
export function getAppGoItems(accessible: readonly AppModule[], q = ""): PaletteEntry[] {
  return visibleSections(accessible)
    .flatMap((s) => s.items)
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
