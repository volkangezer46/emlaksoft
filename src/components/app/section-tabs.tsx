"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useShellNav } from "@/components/app/nav-glyph";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { useIdlePrefetch } from "@/hooks/use-idle-prefetch";
import { resolveActiveHubIn, resolveStripHubIn, type ResolvableNav, type ShellNavSet } from "@/lib/nav-shell";

/**
 * Sayfanın üstündeki TEK sekme şeridi: etkin menü merkezinin (Müşteriler, İlanlar, Satış ve Para, Ekibim…) kardeş
 * sayfaları. 2-3 katlı şerit YOKTUR: merkezin sayfaları ve eski alt sekmeler tek düz listede toplanmıştır.
 * En çok 5 sekme görünür, fazlası "Diğer" menüsündedir; etiketler mobilde de görünür, şerit yatay kaydırılır ve
 * etkin sekme görünür alana getirilir (MorphNav). Merkezde tek sayfa varsa şerit çizilmez.
 * Kaynak: src/lib/nav-roles.ts (merkez tanımı) + src/lib/nav-config.ts; sunucuda düz veriye çevrilir (nav-shell-server),
 * istemcide `resolveStripHub` kuralıyla (nav-shell `resolveStripHubIn`) etkin merkez seçilir.
 */

/**
 * Kabuk verisi (izinler) akarken sekme çubuğunun yerini tutan iskelet: etkin merkez TAM erişimde ≥2 sayfa
 * içeriyorsa şerit yüksekliği kadar yer ayrılır (içerik geldiğinde sayfa aşağı kaymasın). Link çizmez
 * (yetkisiz sekme bir an bile görünmez).
 */

export function SectionTabsPlaceholder({ nav, extra }: { nav: ResolvableNav; extra: readonly (readonly [string, string])[] }) {
  const pathname = usePathname();
  const { hub } = useMemo(() => resolveActiveHubIn(pathname, nav, extra), [pathname, nav, extra]);
  if (!hub || hub.pages.length < 2) return null;
  return (
    <div className="mb-4" aria-hidden="true">
      <div className="skeleton h-11 w-full max-w-xl rounded-[var(--radius-control)]" />
    </div>
  );
}

export function SectionTabs({
  navs,
  role = null,
  scopeCookie = null,
  lockedHrefs = [],
  counts,
  actions,
}: {
  /** Kapsam çerezi (es_scope): yönetim rolünde "Benim işlerim" kişisel menü düzenine geçirir. */
  scopeCookie?: string | null;
  /** Rolün menü düzenleri (sunucuda yetki + kapalı modül süzülmüş; yan menüyle AYNI nesne). */
  navs: ShellNavSet;
  /** Etkin rol: merkez yapısını belirler (yetkiyi değiştirmez). */
  role?: string | null;
  /** Pakete dahil olmayan sayfalar (kilit simgesi). */
  lockedHrefs?: string[];
  /** Sekme href -> GERÇEK kayıt sayısı (mevcut sorgulardan). Verilmeyen sekmede sayaç gösterilmez. */
  counts?: Record<string, number>;
  /** Şeridin sağındaki isteğe bağlı eylem alanı (filtre/ayar düğmesi). */
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const { nav, owner, extra } = useShellNav(navs, role, scopeCookie);
  const { hub, pageHref } = useMemo(() => resolveStripHubIn(pathname, nav, owner, extra), [pathname, nav, owner, extra]);
  const isLocked = (href: string) => lockedHrefs.some((h) => href === h || href.startsWith(`${h}/`));
  // Mevcut merkezin kardeş sayfaları boşta TAM veriyle önceden yüklenir (sekme tıklaması ağ turu beklemez).
  const siblingTargets = hub ? hub.pages.map((p) => p.href).filter((h) => h !== pageHref && !isLocked(h)) : [];
  useIdlePrefetch(siblingTargets, 8);
  if (!hub || hub.pages.length < 2) return null;

  return (
    <div className="mb-4 flex items-start gap-2">
      <MorphNav
        variant="underline"
        label={`${hub.label} sayfaları`}
        activeId={pageHref}
        className="min-w-0 flex-1"
        items={hub.pages.map((page) => ({
          id: page.href,
          href: page.href,
          label: page.label,
          icon: page.icon,
          count: counts?.[page.href] ?? null,
          locked: isLocked(page.href),
        }))}
      />
      {actions ? <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div> : null}
    </div>
  );
}
