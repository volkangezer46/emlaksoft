"use client";

import Link from "@/components/ui/smart-link";
import { ChevronRight } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useShellNav } from "@/components/app/nav-glyph";
import { TopbarFreshness } from "@/components/app/topbar-freshness";
import { activeTabHref, resolveStripHubIn, type ShellNavSet } from "@/lib/nav-shell";

/**
 * Üst çubuk SAYFA BAŞLIĞI + TAZELİK (v4 referansı "Ana sayfa / Son güncelleme 00:22 · Taze"): iki satırlık blok, arama
 * kutusunun solunda (xl ve üstü).
 *  1. Sayfa başlığı (kalın) ve önünde küçük üst merkezler: Merkez › Sayfa (› Ayrıntı / Yeni kayıt). Ad yan menüyle AYNI kaynaktan (rol merkezi + sekme adı);
 *     menüde olmayan yolda gösterilmez. Tek satır, taşan son öğe kesilir (yükseklik sabit, CLS 0).
 *  2. "Son güncelleme 14:32 · Taze": sayfa verisinin istemciye geldiği an (önce göster sonra tazele önbelleği,
 *     `client-cache-state`); 2 dakikadan eskiyse "· N dk önce" (tazelemeyi ClientCacheSync kendiliğinden yapar).
 * Saat yalnız istemcide yazılır (sunucuda aynı genişlikte boş yer tutucu; hidrasyon farkı yok).
 */

type Crumb = { label: string; href?: string };

function useCrumbs(navs: ShellNavSet, role: string | null, scopeCookie: string | null): Crumb[] {
  const pathname = usePathname();
  const sekme = useSearchParams().get("sekme");
  const { nav, owner, extra } = useShellNav(navs, role, scopeCookie);
  const { hub, pageHref: pathHref, inTools } = resolveStripHubIn(pathname, nav, owner, extra);
  if (!pathHref) return [];
  const pageHref = (hub ? activeTabHref(pathHref, sekme, hub.pages.map((p) => p.href)) : pathHref) ?? pathHref;
  const page = hub ? hub.pages.find((p) => p.href === pageHref) : nav.tools.find((t) => t.href === pageHref);
  if (!page) return [];
  const items: Crumb[] = [];
  if (inTools) items.push({ label: "Araçlar" });
  else if (hub && hub.label !== page.label && hub.pages.length > 1) items.push({ label: hub.label, href: hub.href });
  const base = pageHref.split("?")[0] ?? pageHref;
  const isDetail = pathname !== base && pathname.startsWith(`${base}/`);
  items.push({ label: page.label, href: isDetail ? pageHref : undefined });
  if (isDetail) items.push({ label: pathname.replace(/\/+$/, "").split("/").pop() === "yeni" ? "Yeni kayıt" : "Ayrıntı" });
  return items;
}

export function AppTopbarTrail({ navs, role = null, scopeCookie = null }: { navs: ShellNavSet; role?: string | null; scopeCookie?: string | null }) {
  const crumbs = useCrumbs(navs, role, scopeCookie);
  const last = crumbs.at(-1);
  const parents = crumbs.slice(0, -1);
  return (
    <div className="hidden w-[14.5rem] min-w-0 shrink-0 flex-col justify-center gap-1 xl:flex">
      {last ? (
        <nav aria-label="Konum" className="min-w-0">
          <ol className="flex min-w-0 items-baseline gap-1 whitespace-nowrap leading-5">
            {parents.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                {c.href ? (
                  <Link href={c.href} className="focus-ring rounded-sm transition-colors hover:text-text">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
                <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" aria-hidden />
              </li>
            ))}
            <li className="min-w-0">
              {last.href ? (
                <Link href={last.href} className="focus-ring block truncate rounded-sm font-display text-base font-bold tracking-tight text-[var(--heading)]">
                  {last.label}
                </Link>
              ) : (
                <span aria-current="page" className="block truncate font-display text-base font-bold tracking-tight text-[var(--heading)]">
                  {last.label}
                </span>
              )}
            </li>
          </ol>
        </nav>
      ) : (
        <span className="block h-5" aria-hidden />
      )}
      <TopbarFreshness />
    </div>
  );
}
