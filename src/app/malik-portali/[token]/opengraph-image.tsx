import { OG_SIZE } from "@/lib/vitrin-og";
import { loadDocLinkOg, renderPublicLinkOgImage } from "@/lib/public-link-og";

export const alt = "Malik paneli";
export const size = OG_SIZE;
export const contentType = "image/png";
// Token kapısı (süre, iptal, ofis durumu, modül) her istekte yeniden değerlendirilir: önbellek yok (SK8 B151).
export const dynamic = "force-dynamic";

/** Önizleme: ofis markası + "Malik paneliniz" (kişi adı yazılmaz). */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderPublicLinkOgImage(await loadDocLinkOg("owner_portal", token));
}
