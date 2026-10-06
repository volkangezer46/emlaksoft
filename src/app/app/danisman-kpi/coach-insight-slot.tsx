import type { ReactNode } from "react";

/**
 * CoachInsightSlot — koçluk içgörüsü kartı İÇİN ayrılmış yer. İçgörü okuyucusu ana ekran
 * ajanında; o hazır olunca `children` olarak bağlanır. Çocuk yoksa HİÇBİR ŞEY çizilmez:
 * sahte/örnek içgörü üretilmez, boş kutu da bırakılmaz.
 */
export function CoachInsightSlot({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <section aria-label="Koçluk içgörüsü" data-slot="coach-insight" className="no-print">
      {children}
    </section>
  );
}
