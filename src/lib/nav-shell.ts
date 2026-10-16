import { findActiveNavigationHref } from "@/lib/navigation";

/**
 * /app kabuğunun (yan menü, kırıntı, sekme şeridi, kısayollar) DÜZ VERİ modeli.
 *
 * NEDEN: menü kataloğu (`nav-config` NAV_SECTIONS + açıklama/eş anlamlılar), rol düzenleri (`nav-roles`), ikon sözlüğü
 * (`icons.ts`, ağaç sallanamayan 105 lucide ikonu) ve palet eylemleri her /app sayfasının ilk yük paketine giriyordu.
 * Artık bunlar SUNUCUDA (`nav-shell-server.ts`, app/layout.tsx) rol + yetki + kapalı modül + paket kilidiyle hesaplanır;
 * istemciye yalnız görünen merkezler/sayfalar ve kullanılan ikonların lucide düğüm verisi gider. İstemci bu dosyadaki
 * saf çözümleyicilerle (etkin merkez, sekme şeridi) çalışır. Bu dosya bağımlılıksızdır (yalnız `navigation`).
 */

/** lucide ikon düğümü: `[etiket, öznitelikler]` listesi (lucide `__iconNode` biçimi). */
export type ShellIconNode = readonly (readonly [string, Readonly<Record<string, string | number>>])[];

/** Sunucuda bir lucide bileşeninden çıkarılan ikon: lucide sınıf adları + düğüm verisi (çizim birebir aynıdır). */
export type ShellIcon = { readonly cls: string; readonly node: ShellIconNode };

export type ShellPage<I = ShellIcon> = {
  href: string;
  label: string;
  icon: I;
  /** Menü ipucu (title) için tek cümle. */
  description?: string;
  /** Katalogdaki sahibi öğenin ilk yolu (rozet eşlemesi: nav-badges `itemHref`). */
  itemHref: string;
  /** Şeritte önde görünen temel sekme (C04); yoksa "Tümü" altında. */
  core?: true;
};

export type ShellHub<I = ShellIcon> = {
  id: string;
  label: string;
  icon: I;
  group?: string;
  short?: string;
  /** Yan menüde satır içi alt liste (ok ile açılır). */
  sub?: true;
  /** Yan menüde satırın üstündeki bölüm başlığı ("Yönetim"). */
  heading?: string;
  href: string;
  pages: ShellPage<I>[];
};

export type ShellNav<I = ShellIcon> = {
  hubs: ShellHub<I>[];
  dock: ShellHub<I>[];
  tools: ShellPage<I>[];
  mobile: string[];
};

/**
 * Kabuğun bütün menü düzenleri (tek istek, tek hesap):
 *  - `own`: kullanıcının rol düzeni; `personal`: yönetim rolü "Benim işlerim" seçtiğinde danışman düzeni (yoksa null);
 *  - `owner`: sekme şeridi yedeği (sayfa rolün menüsünde yoksa ofis yöneticisi düzeninin merkezi);
 *  - `extra`: katalogdaki `matchPaths` ek yolları → sahibi sayfa (ör. Kapanış kayıpları → İlan Kontrol).
 */
export type ShellNavSet<I = ShellIcon> = {
  own: ShellNav<I>;
  personal: ShellNav<I> | null;
  owner: ShellNav<I>;
  extra: readonly (readonly [string, string])[];
};

/** Hızlı oluşturma eylemi (yetki, paket kilidi ve kapalı modül süzgeci sunucuda uygulanmış). */
export type ShellAction<I = ShellIcon> = { label: string; href: string; icon: I; shortcut?: string };

/** Klavye kısayolu satırı (keyboard-shortcuts.tsx). */
export type ShellShortcut = { tuslar: string; hedef: string; etiket: string };

/** Sekme şeridi iskeleti için ikon/etiket taşımayan en küçük model. */
export type ResolvableNav = {
  hubs: readonly { pages: readonly { href: string }[] }[];
  dock: readonly { pages: readonly { href: string }[] }[];
  tools: readonly { href: string }[];
};

export type ActiveHubOf<H> = { hub: H | null; pageHref: string | null; inDock: boolean; inTools: boolean };

/**
 * Yola göre etkin merkez ve sayfa (en uzun yol eşleşmesi). Detay sayfaları (/app/musteriler/123) ve
 * `extra` ek yolları (Kapanış kayıpları) sahibi sayfanın merkezini etkin yapar. nav-config `resolveActiveHub` bunu kullanır.
 */
export function resolveActiveHubIn<H extends { pages: readonly { href: string }[] }>(
  pathname: string,
  nav: { hubs: readonly H[]; dock: readonly H[]; tools: readonly { href: string }[] },
  extra: Iterable<readonly [string, string]>,
): ActiveHubOf<H> {
  const owner = new Map<string, { hub: H; dock: boolean }>();
  for (const hub of nav.hubs) for (const pg of hub.pages) if (!owner.has(pg.href)) owner.set(pg.href, { hub, dock: false });
  for (const hub of nav.dock) for (const pg of hub.pages) if (!owner.has(pg.href)) owner.set(pg.href, { hub, dock: true });
  const keys = new Map<string, string>([...owner.keys()].map((h) => [h, h]));
  for (const [path, target] of extra) if (owner.has(target) && !keys.has(path)) keys.set(path, target);
  const toolHrefs = nav.tools.map((t) => t.href);
  const hit = findActiveNavigationHref(pathname, [...keys.keys(), ...toolHrefs], "/app");
  if (!hit) return { hub: null, pageHref: null, inDock: false, inTools: false };
  const pageHref = keys.get(hit);
  const found = pageHref ? owner.get(pageHref) : undefined;
  if (pageHref && found) return { hub: found.hub, pageHref, inDock: found.dock, inTools: false };
  return { hub: null, pageHref: hit, inDock: false, inTools: true };
}

/**
 * Sekme şeridi / kırıntı için etkin merkez: önce görünen düzen; sayfa orada yoksa (ör. danışman Ctrl+K ile
 * Kampanyalar'a gitti) ofis yöneticisi düzeninin merkezi. nav-config `resolveStripHub` ile aynı kural.
 */
export function resolveStripHubIn<H extends { pages: readonly { href: string }[] }>(
  pathname: string,
  nav: { hubs: readonly H[]; dock: readonly H[]; tools: readonly { href: string }[] },
  fallback: { hubs: readonly H[]; dock: readonly H[]; tools: readonly { href: string }[] },
  extra: readonly (readonly [string, string])[],
): ActiveHubOf<H> {
  const own = resolveActiveHubIn(pathname, nav, extra);
  if (own.hub || own.inTools) return own;
  return resolveActiveHubIn(pathname, fallback, extra);
}

/**
 * Etkin sekme: yol eşleşmesi + (varsa) adresteki `?sekme=` görünümünün şeritteki SORGULU karşılığı (Talepler ›
 * Eşleşme `/app/talepler?sekme=eslesme`). Karşılığı yoksa yol eşleşmesi kalır. Sekme şeridi ve yan menü aynı kuralı kullanır.
 */
export function activeTabHref(pageHref: string | null, sekme: string | null, hrefs: readonly string[]): string | null {
  if (!pageHref || !sekme) return pageHref;
  const base = pageHref.split("?")[0];
  return hrefs.find((h) => h === `${base}?sekme=${sekme}`) ?? pageHref;
}

/** Görünen düzen: yönetim rolü "Benim işlerim" kapsamındaysa kişisel (danışman) düzen, değilse kendi düzeni. */
export function pickShellNav<I>(set: ShellNavSet<I>, personal: boolean): ShellNav<I> {
  return personal && set.personal ? set.personal : set.own;
}
