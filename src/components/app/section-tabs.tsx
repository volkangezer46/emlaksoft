"use client";

import { usePathname } from "next/navigation";
import { isHrefLocked } from "@/lib/billing/locked-href";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useShellNav } from "@/components/app/nav-glyph";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { useIdlePrefetch } from "@/hooks/use-idle-prefetch";
import { resolveStripHubIn, type ShellNavSet } from "@/lib/nav-shell";

/**
 * Sayfanın üstündeki TEK sekme şeridi: etkin menü merkezinin (Müşteriler, İlanlar, Satış ve Para, Ekibim…) kardeş
 * sayfaları. 2-3 katlı şerit YOKTUR: merkezin sayfaları ve eski alt sekmeler tek düz listede toplanmıştır.
 * En çok 5 sekme görünür, fazlası "Tümü" menüsündedir; etiketler mobilde de görünür, şerit yatay kaydırılır ve
 * etkin sekme görünür alana getirilir (MorphNav). Merkezde tek sayfa varsa şerit çizilmez.
 * Kaynak: src/lib/nav-roles.ts (merkez tanımı) + src/lib/nav-config.ts; sunucuda düz veriye çevrilir (nav-shell-server),
 * istemcide `resolveStripHub` kuralıyla (nav-shell `resolveStripHubIn`) etkin merkez seçilir.
 *
 * Kabukla birlikte Suspense DIŞINDA çizilir (iskelet yer tutucusu yok; B021). Hız (B024): kardeş sekmeler önceden
 * yükleme kuyruğunun EN ÖNCELİKLİ kademesidir (`siblings`, TAM veri); tıklanan sekme yeni sayfa gelmeden AYNI karede
 * etkin görünür (iyimser durum; adres değişince gerçek etkin sekme devralır).
 *
 * Tek görünüm (sahip kararı 2026-10-16): TEMEL (`core`) sekmeler önde, şeritte telefonda en çok 4,
 * masaüstünde en çok 6 sekme görünür (şerit kaydırılır), kalanı "Tümü" menüsündedir (sayfa silinmez). Telefonda sekmeler
 * ikonsuz çizilir: etiket kesilmeden sığar. Ayarlar'ın açılış sayfasında şerit gizlidir (ayar dizini tüm bölümleri listeler).
 */
const NARROW_QUERY = "(max-width: 639.98px)";
export const SIMPLE_TABS_MOBILE = 4;
export const SIMPLE_TABS_DESKTOP = 6;
function subscribeNarrow(cb: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** Sunucu ve hidrasyon: telefon varsayılır (önce telefon; masaüstünde ilk karede 4, ardından 6 sekme). */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches, () => true);
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
  // İyimser etkin sekme: yalnız tıklandığı adreste geçerlidir (adres değişince kendiliğinden düşer; efekt gerekmez).
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  // Adres değişince iyimser durum DÜŞER (render sırasında ayarlama): yoksa geri tuşuyla tıklamanın yapıldığı adrese
  // dönüldüğünde eski tıklanan sekme yeniden etkin görünürdü.
  if (pending && pending.from !== pathname) setPending(null);
  const isLocked = (href: string) => isHrefLocked(href, lockedHrefs);
  // Mevcut merkezin kardeş sayfaları boşta TAM veriyle, kuyruğun en önünde önceden yüklenir (sekme tıklaması ağ turu beklemez).
  const siblingTargets = hub ? hub.pages.map((p) => p.href).filter((h) => h !== pageHref && !isLocked(h)) : [];
  useIdlePrefetch(siblingTargets, 8, { tier: "siblings" });
  const narrow = useNarrow();
  if (!hub || hub.pages.length < 2) return null;
  if (hub.id === "ayarlar" && pageHref === "/app/ayarlar") return null;
  // Temel sekmeler önde (kendi sıralarıyla), ardından diğerleri; sınırı aşan "Tümü" altında.
  const maxVisible = narrow ? SIMPLE_TABS_MOBILE : SIMPLE_TABS_DESKTOP;
  const corePages = hub.pages.filter((p) => p.core);
  const ordered = corePages.length > 0 ? [...corePages, ...hub.pages.filter((p) => !p.core)] : hub.pages;
  const showIcons = !narrow;

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
        maxVisible={maxVisible}
        items={ordered.map((page) => ({
          id: page.href,
          href: page.href,
          label: page.label,
          icon: showIcons ? page.icon : undefined,
          count: counts?.[page.href] ?? null,
          locked: isLocked(page.href),
        }))}
      />
      {actions ? <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div> : null}
    </div>
  );
}
