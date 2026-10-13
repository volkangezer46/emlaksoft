"use client";

import Link from "@/components/ui/smart-link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";
import { useMemo } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { hubNav, resolveStripHub } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";
import { useNavRole } from "@/lib/ui/use-nav-role";

/**
 * Üst çubuk konum yolu: Bugün > Merkez > Sayfa (en çok 3 seviye). Ara düğüm yan menüyle AYNI kaynaktan gelir:
 * rolün merkezi (nav-roles HubDef: etiket, tek sayfalı merkezde grup başlığı), katalog iş başlığı DEĞİL. Böylece
 * kırıntıdaki ad menüde tıklanan satırla aynıdır. Menüde olmayan yolda gösterilmez. lg altında gizli.
 */
export function AppBreadcrumb({
  accessibleModules,
  role = null,
  scopeCookie = null,
}: {
  accessibleModules: AppModule[];
  /** Etkin rol (yan menüyle aynı merkez düzeni için). */
  role?: string | null;
  scopeCookie?: string | null;
}) {
  const pathname = usePathname();
  const closedModules = useClosedModules();
  const { navRole } = useNavRole(role, scopeCookie);
  const opts = useMemo(() => ({ role: navRole, closed: closedModules }), [navRole, closedModules]);
  const tools = useMemo(() => hubNav(accessibleModules, opts).tools, [accessibleModules, opts]);
  const { hub, pageHref, inTools } = resolveStripHub(pathname, accessibleModules, opts);
  if (!pageHref) return null;
  const page = hub ? hub.pages.find((p) => p.href === pageHref) : tools.find((t) => t.href === pageHref);
  if (!page || (!hub && !inTools)) return null;

  const items: BreadcrumbItem[] = [];
  if (hub?.id !== "bugun") items.push({ label: "Bugün", href: "/app" });
  // Ara düğüm: merkez adı (sayfa adından farklıysa) ya da tek sayfalı merkezde menü grup başlığı (bağlantısız).
  if (inTools) items.push({ label: "Araçlar" });
  else if (hub && hub.label !== page.label) items.push({ label: hub.label, href: hub.href });
  else if (hub?.group) items.push({ label: hub.group });
  const isDetail = pathname !== pageHref && pathname.startsWith(`${pageHref}/`);
  items.push({ label: page.label, href: isDetail ? pageHref : undefined });
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
        className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full border border-hairline bg-surface-raised text-text-muted transition-colors hover:text-text touch:min-h-11 touch:min-w-11"
      >
        <House className="h-4 w-4" aria-hidden="true" />
      </Link>
      <Breadcrumb items={trimmed} className="min-w-0" />
    </div>
  );
}
