"use client";

import type { LucideIcon } from "lucide-react";
import { glyph } from "@/components/app/glyph";
import { bindAdminNav, type AdminNavItem, type AdminNavLink, type AdminNavSection } from "@/lib/admin/nav-core";
import type { AdminNavCatalog } from "@/lib/admin/nav-client-catalog";
import type { ShellIcon } from "@/lib/nav-shell";

type BoundAdminNav = ReturnType<typeof bindAdminNav<LucideIcon>> & { catalog: readonly AdminNavSection[] };

const CACHE = new WeakMap<AdminNavCatalog, BoundAdminNav>();

const link = (l: AdminNavLink<ShellIcon>): AdminNavLink => {
  const { children, tabIcon, ...rest } = l;
  return { ...rest, ...(tabIcon ? { tabIcon: glyph(tabIcon) } : {}), ...(children ? { children: children.map(link) } : {}) };
};

/**
 * Kabuğun verdiği düz /admin kataloğunu (`adminNavCatalog`, sunucu) ikon bileşenli kataloğa çevirir ve menü kurallarını
 * (`adminNavFor`, `activeAdminItem`, `adminMobileTabs`, `adminSidebarModel`) ona bağlar — `nav.ts` ile AYNI uygulama
 * (`nav-core.ts`), yalnız veri kaynağı props. Aynı katalog nesnesi için bir kez hesaplanır (yan menü, üst çubuk ve sekme
 * şeridi aynı RSC nesnesini paylaşır).
 */
export function useAdminNav(catalog: AdminNavCatalog): BoundAdminNav {
  const hit = CACHE.get(catalog);
  if (hit) return hit;
  const sections: AdminNavSection[] = catalog.map((s) => ({
    ...s,
    items: s.items.map((i): AdminNavItem => {
      const { icon, tabs, children, tabIcon, palette: _palette, ...rest } = i;
      return {
        ...rest,
        icon: glyph(icon),
        ...(tabIcon ? { tabIcon: glyph(tabIcon) } : {}),
        ...(children ? { children: children.map(link) } : {}),
        ...(tabs ? { tabs: tabs.map(link) } : {}),
      };
    }),
  }));
  const bound: BoundAdminNav = { ...bindAdminNav(sections), catalog: sections };
  CACHE.set(catalog, bound);
  return bound;
}
