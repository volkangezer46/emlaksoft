"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { resolveActiveNav, visibleSections } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";

/**
 * Üst çubuk konum yolu: Bugün > İş başlığı > Sayfa (en çok 3 seviye). Kaynak nav-config
 * (yetkiye süzülü başlıklar); menüde olmayan yolda gösterilmez. lg altında gizli.
 */
export function AppBreadcrumb({ accessibleModules }: { accessibleModules: AppModule[] }) {
  const pathname = usePathname();
  const sections = useMemo(() => visibleSections(accessibleModules), [accessibleModules]);
  const { section, href } = resolveActiveNav(pathname, sections);
  if (!section || !href) return null;
  const item = section.items.find((i) => i.href === href);
  if (!item) return null;
  const items: BreadcrumbItem[] = [];
  if (section.id !== "bugun") items.push({ label: "Bugün", href: "/app" });
  const sectionHref = sections.find((s) => s.id === section.id)?.href;
  const isDetail = pathname !== href && !pathname.startsWith(`${href}?`) && pathname.length > href.length;
  items.push({ label: section.title, href: sectionHref });
  items.push({ label: item.label, href: isDetail ? href : undefined });
  if (isDetail) {
    // Son segment: /yeni → "Yeni kayıt", diğer her şey (kimlik) → "Ayrıntı".
    const last = pathname.replace(/\/+$/, "").split("/").pop();
    items.push({ label: last === "yeni" ? "Yeni kayıt" : "Ayrıntı" });
  }
  const unique = items.filter((it, i) => i === 0 || it.label !== items[i - 1]!.label);
  const trimmed = unique.length > 3 ? unique.slice(-3) : unique;
  return <Breadcrumb items={trimmed} className="hidden min-w-0 shrink-0 lg:block" />;
}
