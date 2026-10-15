import ListingOgImage from "./opengraph-image";
import { OG_SIZE } from "@/lib/vitrin-og";

export const alt = "Emlak ilanı";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

/**
 * X/Telegram kartı (SK8 B151): opengraph-image ile AYNI ofis markalı ilan kartı. Sayfa metadata'sında `twitter.images`
 * anahtarı yoktur; dosya kuralı bu görseli ekler (anahtar olsaydı Next dosya görselini atlardı).
 */
export default ListingOgImage;
