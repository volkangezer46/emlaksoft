"use client";

import { Children, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Mobil kayıt eylem çubuğu (MP6) — müşteri ve portföy detayında sık eylemler (Ara · WhatsApp · Not · Randevu /
 * Paylaş · WhatsApp · Randevu · Fotoğraf) her zaman bir başparmak uzaklığında.
 *
 * - Yalnız < lg (masaüstünde hiç görünmez); alt gezinme çubuğunun HEMEN ÜSTÜNE sabitlenir (safe-area dahil).
 * - Künyedeki eylem satırı (`watchId`) ekrandan yukarı çıkınca belirir; künye görünürken gizlidir (çift düğme yok).
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
  /** Künyedeki eylem satırının id'si; görünürlük ona göre. */
  watchId: string;
  label: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const cells = Children.toArray(children).filter(Boolean);

  useEffect(() => {
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
        className={cn(
          "fixed inset-x-0 z-30 border-t border-line/70 bg-surface px-2 py-1.5 shadow-[0_-6px_20px_-12px_rgb(0_0_0/0.35)] transition duration-200 lg:hidden",
          "bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom,0px))]",
          visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
        )}
      >
        <ul className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
          {cells.map((cell, i) => (
            <li key={i} className="flex min-w-0">
              {cell}
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
