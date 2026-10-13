import type { ReactNode } from "react";
import { PublicMeasure } from "@/components/public-measure/public-measure";

/**
 * Vitrin kabuğu (ofis vitrini, ilan detayı, favoriler, değerleme). Görsel bir şey eklemez.
 * S6: SP3'ün herkese açık ziyaret ölçümü `<PublicMeasure />` TEK yerde, kabuğun sonuna (children'dan sonra) eklenir.
 * Yol şablona sunucuda indirgenir (/vitrin/[ofis], /vitrin/[ofis]/[ilan]); kişiye özel favoriler sayfası sayılmaz.
 */
export default function VitrinLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PublicMeasure />
    </>
  );
}
