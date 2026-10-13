import type { ReactNode } from "react";

/**
 * Vitrin kabuğu (ofis vitrini, ilan detayı, favoriler, değerleme). Görsel bir şey eklemez.
 * Bağlantı noktası (S6 dikişi): SP3'ün herkese açık ziyaret ölçümü `<PublicMeasure />` TEK yerde, kabuğun sonuna
 * (children'dan sonra) eklenir.
 */
export default function VitrinLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* S6: <PublicMeasure /> */}
    </>
  );
}
