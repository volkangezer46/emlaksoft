"use client";

import Link from "@/components/ui/smart-link";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useShellNav } from "@/components/app/nav-glyph";
import { formatTrTime, now } from "@/lib/clock";
import { CLIENT_CACHE_REFRESHED_EVENT, getFetchedAt } from "@/lib/client-cache-state";
import { activeTabHref, resolveStripHubIn, type ShellNavSet } from "@/lib/nav-shell";

/**
 * Üst çubuk KONUM + TAZELİK (P1-12): iki satırlık kompakt blok, arama kutusunun solunda (xl ve üstü).
 *  1. Sayfa yolu: Merkez › Sayfa (› Ayrıntı / Yeni kayıt). Ad yan menüyle AYNI kaynaktan (rol merkezi + sekme adı);
 *     menüde olmayan yolda gösterilmez. Tek satır, taşan son öğe kesilir (yükseklik sabit, CLS 0).
 *  2. "Son güncelleme 14:32 · Taze": sayfa verisinin istemciye geldiği an (önce göster sonra tazele önbelleği,
 *     `client-cache-state`); 2 dakikadan eskiyse "· N dk önce" (tazelemeyi ClientCacheSync kendiliğinden yapar).
 * Saat yalnız istemcide yazılır (sunucuda aynı genişlikte boş yer tutucu; hidrasyon farkı yok).
 */
const FRESH_MS = 120_000;
const TICK_MS = 30_000;

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

function Freshness() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = `${pathname}?${search}`;
  const [state, setState] = useState<{ at: number; nowMs: number } | null>(null);

  useEffect(() => {
    // Önbellek varış işareti (ClientCacheSync) aynı karede yazılır: bir sonraki görev turunda okunur; sessiz tazeleme
    // bitince (CLIENT_CACHE_REFRESHED_EVENT) saat yenilenir.
    const read = () => {
      const t = now();
      setState({ at: getFetchedAt(key) ?? t, nowMs: t });
    };
    const first = setTimeout(read, 0);
    const tick = setInterval(() => setState((s) => (s ? { ...s, nowMs: now() } : s)), TICK_MS);
    window.addEventListener(CLIENT_CACHE_REFRESHED_EVENT, read);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      window.removeEventListener(CLIENT_CACHE_REFRESHED_EVENT, read);
    };
  }, [key]);

  if (!state) return <span className="block h-4" aria-hidden />;
  const age = Math.max(0, state.nowMs - state.at);
  const fresh = age < FRESH_MS;
  const ago = fresh ? "Taze" : `${Math.max(2, Math.round(age / 60_000))} dk önce`;
  return (
    <p
      title={fresh ? "Veriler güncel" : "Sayfa arka planda kendiliğinden tazelenir"}
      className="flex h-4 min-w-0 items-center gap-1.5 text-xs leading-4 text-text-faint"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${fresh ? "bg-mint-500" : "bg-amber-500"}`} aria-hidden />
      <span className="num truncate">
        Son güncelleme {formatTrTime(state.at)} · <span className={fresh ? "font-semibold text-mint-600" : "font-semibold text-text-muted"}>{ago}</span>
      </span>
    </p>
  );
}

export function AppTopbarTrail({ navs, role = null, scopeCookie = null }: { navs: ShellNavSet; role?: string | null; scopeCookie?: string | null }) {
  const crumbs = useCrumbs(navs, role, scopeCookie);
  return (
    <div className="hidden w-[15rem] min-w-0 shrink-0 flex-col justify-center gap-0.5 xl:flex">
      {crumbs.length > 0 ? (
        <nav aria-label="Konum" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs leading-4 text-text-muted">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={`${c.label}-${i}`} className={`flex items-center gap-1 ${last ? "min-w-0" : "shrink-0"}`}>
                  {c.href && !last ? (
                    <Link href={c.href} className="focus-ring rounded-sm transition-colors hover:text-text">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={last ? "truncate font-semibold text-text" : undefined}>
                      {c.label}
                    </span>
                  )}
                  {!last ? <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" aria-hidden /> : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : (
        <span className="block h-4" aria-hidden />
      )}
      <Freshness />
    </div>
  );
}
