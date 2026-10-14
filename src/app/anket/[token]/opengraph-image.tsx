import { OG_SIZE } from "@/lib/vitrin-og";
import { loadDocLinkOg, renderPublicLinkOgImage } from "@/lib/public-link-og";

export const alt = "Memnuniyet anketi";
export const size = OG_SIZE;
export const contentType = "image/png";
// Token kapısı (süre, iptal, ofis durumu, modül) her istekte yeniden değerlendirilir: önbellek yok.
export const dynamic = "force-dynamic";

/** Önizleme: yalnız ofis markası + belge türü. */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderPublicLinkOgImage(await loadDocLinkOg("survey", token));
}
