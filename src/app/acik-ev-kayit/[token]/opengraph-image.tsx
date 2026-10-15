import { OG_SIZE } from "@/lib/vitrin-og";
import { loadDocLinkOg, renderPublicLinkOgImage } from "@/lib/public-link-og";

export const alt = "Açık ev kaydı";
export const size = OG_SIZE;
export const contentType = "image/png";
// Token kapısı (süre, iptal, ofis durumu, modül) her istekte yeniden değerlendirilir: önbellek yok (SK8 B151).
export const dynamic = "force-dynamic";

/** Önizleme: ofis markası + açık ev ilan başlığı ve ilk public ilan fotoğrafı (adres yazılmaz). */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderPublicLinkOgImage(await loadDocLinkOg("open_house", token));
}
