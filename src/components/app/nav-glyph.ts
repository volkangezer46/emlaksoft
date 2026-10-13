"use client";

import { createElement, forwardRef } from "react";
import { Icon, type IconNode, type LucideIcon, type LucideProps } from "lucide-react";
import { pickShellNav, type ShellIcon, type ShellNav, type ShellNavSet } from "@/lib/nav-shell";
import { useNavRole } from "@/lib/ui/use-nav-role";

/**
 * Sunucudan gelen ikon verisini (nav-shell `ShellIcon`) lucide bileşenine çevirir. lucide `createLucideIcon` ile AYNI
 * çağrı: `Icon`'a aynı `iconNode` ve aynı sınıf zinciri (`lucide lucide-<ad> …className`) verilir; SVG öznitelikleri,
 * boyut, çizgi kalınlığı ve viewBox birebir aynıdır. Bileşen ikon başına bir kez üretilir (kimlik sabit → yeniden bağlanmaz).
 */
const GLYPHS = new Map<string, LucideIcon>();

export function glyph(icon: ShellIcon): LucideIcon {
  const hit = GLYPHS.get(icon.cls);
  if (hit) return hit;
  const Glyph = forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) =>
    createElement(Icon, {
      ref,
      iconNode: icon.node as unknown as IconNode,
      className: [icon.cls, className].filter((c): c is string => typeof c === "string" && c.trim() !== "").join(" ").trim(),
      ...props,
    }),
  ) as LucideIcon;
  Glyph.displayName = "NavGlyph";
  GLYPHS.set(icon.cls, Glyph);
  return Glyph;
}

const NAV_CACHE = new WeakMap<ShellNav, ShellNav<LucideIcon>>();

/** Düz menü modelini ikon bileşenli modele çevirir (aynı nesne için önbellekli). */
export function hydrateNav(nav: ShellNav): ShellNav<LucideIcon> {
  const hit = NAV_CACHE.get(nav);
  if (hit) return hit;
  const pages = (ps: ShellNav["tools"]) => ps.map((p) => ({ ...p, icon: glyph(p.icon) }));
  const hubs = (hs: ShellNav["hubs"]) => hs.map((h) => ({ ...h, icon: glyph(h.icon), pages: pages(h.pages) }));
  const out: ShellNav<LucideIcon> = { hubs: hubs(nav.hubs), dock: hubs(nav.dock), tools: pages(nav.tools), mobile: nav.mobile };
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
