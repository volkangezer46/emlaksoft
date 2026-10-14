import { OG_SIZE } from "@/lib/vitrin-og";
import { loadPresentationOg, renderPublicLinkOgImage } from "@/lib/public-link-og";

export const alt = "Portföy sunumu";
export const size = OG_SIZE;
export const contentType = "image/png";
// Token kapısı (süre, iptal, ofis durumu, modül) her istekte yeniden değerlendirilir: önbellek yok.
export const dynamic = "force-dynamic";

/** WhatsApp/sosyal önizleme: ofis adı + logo, sunum başlığı ve ilk portföyün fotoğrafı (yoksa markalı yedek kart). */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderPublicLinkOgImage(await loadPresentationOg(token));
}
