"use client";

import { createElement, forwardRef } from "react";
import { Icon, type IconNode, type LucideIcon, type LucideProps } from "lucide-react";
import type { ShellIcon } from "@/lib/nav-shell";

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

