import type { LucideIcon } from "lucide-react";
import type { ShellIcon } from "@/lib/nav-shell";
import { shellIcon } from "@/lib/nav-shell-server";
import { ADMIN_NAV } from "./nav";
import type { AdminNavItem, AdminNavLink, AdminNavSection } from "./nav-core";
import { adminTabIcon } from "./tab-icons";

/** Kabuğun istemci bileşenlerine verdiği düz /admin kataloğu (ikonlar çizim verisi; `useAdminNav` lucide'a çevirir). */
export type AdminNavCatalog = readonly AdminNavSection<ShellIcon>[];

let CATALOG: AdminNavCatalog | null = null;

/**
 * /admin kataloğunun istemciye giden düz kopyası — YALNIZ sunucu bileşenlerinden (admin layout) çağrılır. Böylece
 * `ADMIN_NAV`, menü ikonları ve sekme ikonu eşlemesi (`tab-icons.ts`) /admin ilk yük JS paketine girmez.
 * Tüm katalog gider (rol süzgeci istemcide aynı kuralla çalışır; bkz. `bindAdminNav`): sekme şeridi yer tutucusu süzgeçsiz
 * kataloğa bakar ve katalog zaten herkese aynı istemci paketinde gidiyordu (yeni bilgi açılmaz). `palette` alanı
 * yalnız komut paletinindir (tembel parça `nav.ts`'i kendisi yükler), burada taşınmaz. Sekme ikonu sunucuda çözülür
 * (`adminTabIcon(href, öğe ikonu)`); şerit ikonu aynı kalır. Modül düzeyinde tek nesne: RSC yükü aynı istekte
 * (yan menü, üst çubuk, sekme şeridi) kataloğu bir kez yazar.
 */
export function adminNavCatalog(): AdminNavCatalog {
  if (CATALOG) return CATALOG;
  const tab = (t: AdminNavLink, fallback: LucideIcon): AdminNavLink<ShellIcon> => {
    const { children, tabIcon: _tabIcon, ...rest } = t;
    return { ...rest, tabIcon: shellIcon(adminTabIcon(t.href, fallback)), ...(children ? { children: children.map(link) } : {}) };
  };
  const link = (l: AdminNavLink): AdminNavLink<ShellIcon> => {
    const { children, tabIcon: _tabIcon, ...rest } = l;
    return { ...rest, ...(children ? { children: children.map(link) } : {}) };
  };
  const item = (i: AdminNavItem): AdminNavItem<ShellIcon> => {
    const { icon, tabs, children, palette: _palette, tabIcon: _tabIcon, ...rest } = i;
    return {
      ...rest,
      icon: shellIcon(icon),
      ...(children ? { children: children.map(link) } : {}),
      ...(tabs ? { tabs: tabs.map((t) => tab(t, icon)) } : {}),
    };
  };
  CATALOG = ADMIN_NAV.map((s) => ({ ...s, items: s.items.map(item) }));
  return CATALOG;
}
