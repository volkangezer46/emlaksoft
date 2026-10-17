"use client";

import type { LucideIcon } from "lucide-react";
import { glyph } from "@/components/app/glyph";
import { pickShellNav, type ShellNav, type ShellNavSet } from "@/lib/nav-shell";
import { useNavRole } from "@/lib/ui/use-nav-role";

export { glyph };

const NAV_CACHE = new WeakMap<ShellNav, ShellNav<LucideIcon>>();

/** Düz menü modelini ikon bileşenli modele çevirir (aynı nesne için önbellekli). */
export function hydrateNav(nav: ShellNav): ShellNav<LucideIcon> {
  const hit = NAV_CACHE.get(nav);
  if (hit) return hit;
  const pages = (ps: ShellNav["tools"]) => ps.map((p) => ({ ...p, icon: glyph(p.icon) }));
  const hubs = (hs: ShellNav["hubs"]) => hs.map((h) => ({ ...h, icon: glyph(h.icon), pages: pages(h.pages) }));
  const out: ShellNav<LucideIcon> = {
    hubs: hubs(nav.hubs),
    dock: hubs(nav.dock),
    tools: pages(nav.tools),
    mobile: nav.mobile,
  };
  NAV_CACHE.set(nav, out);
  return out;
}

/**
 * Görünen menü düzeni (ikonlu) + sekme şeridi yedeği. Yönetim rolü "Benim işlerim" kapsamına geçince (çerez ya da
 * ScopeSwitch olayı) sunucunun hazırladığı danışman düzenine anında geçer; yetki değişmez.
 */
export function useShellNav(set: ShellNavSet, role: string | null | undefined, scopeCookie: string | null | undefined) {
  const { navRole, personal } = useNavRole(role, scopeCookie);
  return { nav: hydrateNav(pickShellNav(set, personal)), owner: hydrateNav(set.owner), extra: set.extra, navRole, personal };
}
