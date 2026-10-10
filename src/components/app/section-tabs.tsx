"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useClosedModules } from "@/components/app/closed-modules-context";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { resolveStripHub } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";
import { useNavRole } from "@/lib/ui/use-nav-role";

/**
 * Sayfanın üstündeki TEK sekme şeridi: etkin menü merkezinin (Müşteriler, İlanlar, Satış ve Para, Ekibim…) kardeş
 * sayfaları. 2-3 katlı şerit YOKTUR: merkezin sayfaları ve eski alt sekmeler tek düz listede toplanmıştır.
 * En çok 5 sekme görünür, fazlası "Diğer" menüsündedir; etiketler mobilde de görünür, şerit yatay kaydırılır ve
 * etkin sekme görünür alana getirilir (MorphNav). Merkezde tek sayfa varsa şerit çizilmez.
 * Kaynak: src/lib/nav-roles.ts (merkez tanımı) + src/lib/nav-config.ts (`resolveStripHub`).
 */

/**
 * Kabuk verisi (izinler) akarken sekme çubuğunun yerini tutan iskelet: etkin merkez TAM erişimde ≥2 sayfa
 * içeriyorsa şerit yüksekliği kadar yer ayrılır (içerik geldiğinde sayfa aşağı kaymasın). Link çizmez
 * (yetkisiz sekme bir an bile görünmez).
 */

export function SectionTabsPlaceholder({ allModules }: { allModules: AppModule[] }) {
  const pathname = usePathname();
  const { hub } = useMemo(() => resolveStripHub(pathname, allModules, { role: "owner" }), [pathname, allModules]);
  if (!hub || hub.pages.length < 2) return null;
  return (
    <div className="mb-4" aria-hidden="true">
      <div className="skeleton h-11 w-full max-w-xl rounded-[var(--radius-control)]" />
    </div>
  );
}

export function SectionTabs({
  accessibleModules,
  role = null,
  scopeCookie = null,
  lockedHrefs = [],
  counts,
  actions,
}: {
  /** Kapsam çerezi (es_scope): yönetim rolünde "Benim işlerim" kişisel menü düzenine geçirir. */
  scopeCookie?: string | null;
  accessibleModules: AppModule[];
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
  const closedModules = useClosedModules();
  const { navRole } = useNavRole(role, scopeCookie);
  const { hub, pageHref } = useMemo(
    () => resolveStripHub(pathname, accessibleModules, { role: navRole, closed: closedModules }),
    [pathname, accessibleModules, navRole, closedModules],
  );
  if (!hub || hub.pages.length < 2) return null;

  const isLocked = (href: string) => lockedHrefs.some((h) => href === h || href.startsWith(`${h}/`));

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
