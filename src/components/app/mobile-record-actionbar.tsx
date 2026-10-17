"use client";

import { Children, useEffect, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMobileMenu } from "@/components/app/mobile-menu-trigger";
import { pressOpenHandlers } from "@/components/app/tap-veil";
import { RECORD_BAR_CELL, RECORD_BAR_ICON } from "@/lib/record-actionbar";
import { cn } from "@/lib/utils";

/**
 * Mobil kayıt eylem çubuğu (MP6) — müşteri ve portföy detayında sık eylemler (Ara · WhatsApp · Not · Randevu /
 * Paylaş · WhatsApp · Randevu · Fotoğraf) her zaman bir başparmak uzaklığında.
 *
 * - Yalnız < lg (masaüstünde hiç görünmez). Görünürken alt gezinmenin (`.mbar`) YERİNİ alır (WP1): ekranın dibine oturur,
 *   yüksekliği `--mbar-h` (globals.css, tek kaynak) ve görünürken `.mbar` CSS ile gizlenir (premium.css
 *   `html:has([data-record-actionbar][data-visible="1"]) .mbar`). Son hücre "Menü" çekmeceyi açar (ortak `useMobileMenu`).
 * - Künyedeki eylem satırı (`watchId`) ekrandan yukarı çıkınca belirir; künye görünürken gizlidir (çift düğme yok).
 *   `watchId` verilmezse çubuk HEP görünür (sade görünüm: künyedeki eylem satırı telefonda hiç çizilmez, eylemler
 *   yalnız bu çubuktadır; Ara/WhatsApp ekranda tek kez durur).
 * - Opak zemin (cam bütçesi: mobil kaydırmada bulanıklık pahalı; alt gezinmeyle aynı ilke).
 * - Gizliyken `inert`: klavye/ekran okuyucu odağı almaz.
 * - Sayfa sonunda içerik çubuğun altında kalmasın diye akışta bir boşluk bırakır.
 * Hücreler sunucuda hazırlanır (`RECORD_BAR_CELL`, @/lib/record-actionbar); bu bileşen yalnız kabuk + görünürlük.
 */
export function MobileRecordActionBar({
  watchId,
  label,
  children,
}: {
  /** Künyedeki eylem satırının id'si; görünürlük ona göre. Verilmezse çubuk her zaman görünür. */
  watchId?: string;
  label: string;
  children: ReactNode;
}) {
  const [scrolledPast, setVisible] = useState(false);
  const visible = !watchId || scrolledPast;
  const cells = Children.toArray(children).filter(Boolean);
  const menu = useMobileMenu();

  useEffect(() => {
    if (!watchId) return;
    const el = document.getElementById(watchId);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Yalnız künye YUKARIDA kaldığında göster (sayfa başındayken değil).
        setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [watchId]);

  if (cells.length === 0) return null;

  return (
    <>
      <div className="h-20 lg:hidden" aria-hidden />
      <nav
        aria-label={label}
        inert={!visible}
        data-record-actionbar=""
        data-visible={visible ? "1" : undefined}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex min-h-[var(--mbar-h)] items-center border-t border-line/70 bg-surface px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] shadow-[0_-6px_20px_-12px_rgb(0_0_0/0.35)] transition duration-200 lg:hidden",
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
        )}
      >
        <ul className="grid w-full gap-1.5" style={{ gridTemplateColumns: `repeat(${cells.length + 1}, minmax(0, 1fr))` }}>
          {cells.map((cell, i) => (
            <li key={i} className="flex min-w-0">
              {cell}
            </li>
          ))}
          <li className="flex min-w-0">
            {/* Kanonik Button (odak/basma tek yerde); hücre görünümü diğer hücrelerle aynı sınıftan → eşit yükseklik. */}
            <Button
              type="button"
              variant="ghost"
              {...pressOpenHandlers({ open: menu.requestOpen, press: menu.press })}
              onPointerEnter={menu.warm}
              onFocus={menu.warm}
              onTouchStart={menu.warm}
              aria-haspopup="dialog"
              aria-expanded={menu.open}
              aria-controls="app-mobile-navigation"
              aria-label="Menü: tüm sayfalar"
              className={RECORD_BAR_CELL}
            >
              <Menu className={RECORD_BAR_ICON} aria-hidden /> Menü
            </Button>
          </li>
        </ul>
      </nav>
    </>
  );
}
