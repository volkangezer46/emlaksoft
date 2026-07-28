"use client";

import type { ReactNode } from "react";
import { CompareToggle } from "@/components/public/compare-select";
import type { CompareItem } from "@/components/public/compare-table";

/**
 * Portföy kartı karşılaştırma kabuğu — vitrin VitrinCardShell deseninin
 * app varyantı: sunucudan gelen kart <Link>'ini relative sarmalayıcıya alır,
 * public CompareToggle'ı görselin sağında (fiyat sağlığı rozetinin ALTINDA)
 * absolute + z-10 konumlar. Toggle kendi tıkını durdurur (preventDefault +
 * stopPropagation), kart linkiyle çakışmaz.
 *
 * Seçim durumu public compare-select store'unda yaşar (oturumluk, sayfa
 * yenilenince sıfırlanır); alt çubuk + tablo overlay'i sayfadaki tek
 * CompareBar yönetir. Fiyat sağlığı rozeti CompareItem'da ayrı alan olarak
 * bulunmadığından (public komponente DOKUNMUYORUZ) sağlık etiketi sunucu
 * tarafında başlık metnine gömülür — tabloda kolon başlığında görünür.
 */
export function PropertyCompareShell({
  item,
  children,
  actions,
}: {
  item: CompareItem;
  children: ReactNode;
  /** Kart üstüne bindirilen ek aksiyonlar (ör. malik portalı linki). */
  actions?: ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      <div className="absolute right-3 top-12 z-10 flex flex-col items-end gap-2">
        <CompareToggle item={item} />
        {actions}
      </div>
    </div>
  );
}
