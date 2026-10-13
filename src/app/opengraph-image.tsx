import { OG_ALT, OG_SIZE, renderBrandCard } from "@/lib/brand/og-card";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";
/** Kart metni yönetimden gelir (Site menüsü > Paylaşım kartı): yayında "site-menu" etiketi düşer; en geç 5 dk'da tazelenir. */
export const revalidate = 300;

/** 1200x630 marka kartı (logo süper admin ayarından, metin site menüsü yapılandırmasından). */
export default async function OpengraphImage() {
  return renderBrandCard();
}
