import { OG_SIZE } from "@/lib/vitrin-og";
import { loadShareOg, renderPublicLinkOgImage } from "@/lib/public-link-og";

export const alt = "Paylaşılan portföy";
export const size = OG_SIZE;
export const contentType = "image/png";
// Token kapısı (süre, iptal, ofis durumu, modül) her istekte yeniden değerlendirilir: önbellek yok.
export const dynamic = "force-dynamic";

/** X/Telegram kartı: opengraph-image ile aynı ofis markalı görsel (yoksa kökteki EmlakSoft kartı düşerdi). */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderPublicLinkOgImage(await loadShareOg(token));
}
