"use client";

import Link from "@/components/ui/smart-link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";
import { useMemo } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { resolveActiveNav, visibleSections } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";

/**
 * Üst çubuk konum yolu: Bugün > İş başlığı > Sayfa (en çok 3 seviye). Kaynak nav-config
 * (yetkiye süzülü başlıklar); menüde olmayan yolda gösterilmez. lg altında gizli.
 */
export function AppBreadcrumb({ accessibleModules }: { accessibleModules: AppModule[] }) {
  const pathname = usePathname();
  const closedModules = useClosedModules();
  const sections = useMemo(() => visibleSections(accessibleModules, { closed: closedModules }), [accessibleModules, closedModules]);
  const { section, href } = resolveActiveNav(pathname, sections);
  if (!section || !href) return null;
  const item = section.items.find((i) => i.href === href);
  if (!item) return null;
  const items: BreadcrumbItem[] = [];
  if (section.id !== "bugun") items.push({ label: "Bugün", href: "/app" });
  const sectionHref = sections.find((s) => s.id === section.id)?.href;
  // Sekmeli öğede sekme sayfasının kendisi (ör. /app/hedefler) "Ayrıntı" değil sekme adıyla görünür.
  const activeTab = (item.tabs ?? [])
    .filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const isTabRoot = Boolean(activeTab && pathname === activeTab.href);
  const isDetail =
    !isTabRoot && pathname !== href && !pathname.startsWith(`${href}?`) && pathname.length > href.length;
  items.push({ label: section.title, href: sectionHref });
  if (activeTab && activeTab.href !== href) {
    items.push({ label: item.label, href });
    items.push({ label: activeTab.label, href: isDetail ? activeTab.href : undefined });
  } else {
    items.push({ label: item.label, href: isDetail ? href : undefined });
  }
  if (isDetail) {
    // Son segment: /yeni → "Yeni kayıt", diğer her şey (kimlik) → "Ayrıntı".
    const last = pathname.replace(/\/+$/, "").split("/").pop();
    items.push({ label: last === "yeni" ? "Yeni kayıt" : "Ayrıntı" });
  }
  const unique = items.filter((it, i) => i === 0 || it.label !== items[i - 1]!.label);
  const trimmed = unique.length > 3 ? unique.slice(-3) : unique;
  // v4 kabuk (/admin ile aynı): ev ikonlu konum şeridi.
  return (
    <div className="hidden min-w-0 shrink-0 items-center gap-2.5 lg:flex">
      <Link
        href="/app"
        aria-label="Bugün (ana ekran)"
        className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full border border-hairline bg-surface-raised text-text-muted transition-colors hover:text-text"
      >
        <House className="h-4 w-4" aria-hidden="true" />
      </Link>
      <Breadcrumb items={trimmed} className="min-w-0" />
    </div>
  );
}
