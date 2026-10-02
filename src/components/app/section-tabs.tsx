"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Lock } from "lucide-react";
import { resolveActiveNav, visibleSections } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Aktif iş başlığındaki kardeş sayfalar için sekme çubuğu (ör. Müşteriler →
 * Talepler → Eşleştirme). Menü 9 başlığa indiği için sayfalar arası geçiş burada.
 * Başlıkta tek sayfa varsa görünmez. Kaynak: src/lib/nav-config.ts.
 */
export function SectionTabs({
  accessibleModules,
  lockedHrefs = [],
}: {
  accessibleModules: AppModule[];
  /** Pakete dahil olmayan sayfalar (kilit simgesi). */
  lockedHrefs?: string[];
}) {
  const pathname = usePathname();
  const sections = useMemo(() => visibleSections(accessibleModules), [accessibleModules]);
  const { section, href: activeHref } = resolveActiveNav(pathname, sections);
  if (!section || section.items.length < 2) return null;
  const current = sections.find((s) => s.id === section.id)!;

  return (
    <nav aria-label={`${current.title} sayfaları`} className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex min-w-max items-center gap-1 border-b border-line">
        {current.items.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-accent font-semibold text-text"
                    : "border-transparent text-text-muted hover:border-line-strong hover:text-text",
                )}
              >
                <item.icon className="h-3.5 w-3.5" aria-hidden />
                {item.label}
                {lockedHrefs.some((h) => item.href === h || item.href.startsWith(`${h}/`)) ? (
                  <Lock className="h-3 w-3 text-amber-600" aria-label="Paketinize dahil değil" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
