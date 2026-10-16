"use client";

import { usePathname } from "next/navigation";
import { isHrefLocked } from "@/lib/billing/locked-href";
import { useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useShellNav } from "@/components/app/nav-glyph";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { useIdlePrefetch } from "@/hooks/use-idle-prefetch";
import { resolveStripHubIn, type ShellNavSet } from "@/lib/nav-shell";

/**
 * Sayfanın üstündeki TEK sekme şeridi: etkin menü merkezinin (Müşteriler, İlanlar, Satış ve Para, Ekibim…) kardeş
 * sayfaları. 2-3 katlı şerit YOKTUR: merkezin sayfaları ve eski alt sekmeler tek düz listede toplanmıştır.
 * En çok 5 sekme görünür, fazlası "Diğer" menüsündedir; etiketler mobilde de görünür, şerit yatay kaydırılır ve
 * etkin sekme görünür alana getirilir (MorphNav). Merkezde tek sayfa varsa şerit çizilmez.
 * Kaynak: src/lib/nav-roles.ts (merkez tanımı) + src/lib/nav-config.ts; sunucuda düz veriye çevrilir (nav-shell-server),
 * istemcide `resolveStripHub` kuralıyla (nav-shell `resolveStripHubIn`) etkin merkez seçilir.
 *
 * Kabukla birlikte Suspense DIŞINDA çizilir (iskelet yer tutucusu yok; B021). Hız (B024): kardeş sekmeler önceden
 * yükleme kuyruğunun EN ÖNCELİKLİ kademesidir (`siblings`, TAM veri); tıklanan sekme yeni sayfa gelmeden AYNI karede
 * etkin görünür (iyimser durum; adres değişince gerçek etkin sekme devralır).
 */
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
  // İyimser etkin sekme: yalnız tıklandığı adreste geçerlidir (adres değişince kendiliğinden düşer; efekt gerekmez).
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  // Adres değişince iyimser durum DÜŞER (render sırasında ayarlama): yoksa geri tuşuyla tıklamanın yapıldığı adrese
  // dönüldüğünde eski tıklanan sekme yeniden etkin görünürdü.
  if (pending && pending.from !== pathname) setPending(null);
  const isLocked = (href: string) => isHrefLocked(href, lockedHrefs);
  // Mevcut merkezin kardeş sayfaları boşta TAM veriyle, kuyruğun en önünde önceden yüklenir (sekme tıklaması ağ turu beklemez).
  const siblingTargets = hub ? hub.pages.map((p) => p.href).filter((h) => h !== pageHref && !isLocked(h)) : [];
  useIdlePrefetch(siblingTargets, 8, { tier: "siblings" });
  if (!hub || hub.pages.length < 2) return null;

  const optimistic = pending && pending.from === pathname ? pending.href : null;
  const activeId = optimistic && hub.pages.some((p) => p.href === optimistic) ? optimistic : pageHref;
  // Sekme bağlantıları MorphNav içinde: tıklama tek yerden (olay yetkisi) yakalanır. Yeni sekme / değiştirici tuşlu
  // tıklama gezinme başlatmaz → iyimser durum yalnız düz sol tıklamada.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest?.("a[href]");
    const href = a?.getAttribute("href");
    if (!href || a?.getAttribute("target") === "_blank") return;
    setPending({ href, from: pathname });
  };

  return (
    <div className="mb-4 flex items-start gap-2" onClickCapture={onClickCapture}>
      <MorphNav
        variant="underline"
        label={`${hub.label} sayfaları`}
        activeId={activeId}
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
