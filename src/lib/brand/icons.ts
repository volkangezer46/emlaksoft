import type { Metadata } from "next";
import { DEFAULT_BRAND_ASSETS, brandAssetUrl, type BrandMeta } from "./slots";

/** Next metadata `icons` değeri: özel favicon varsa o, yoksa varsayılan dosyalar. */
export function brandIcons(meta: BrandMeta): NonNullable<Metadata["icons"]> {
  const fav = meta.slots.favicon;
  if (!fav) {
    return {
      // Yalnız gerekli bağlantılar (istek bütçesi): SVG (modern tarayıcı) + ICO (eski tarayıcı/bot) + Apple; 32 px PNG kaldırıldı.
      icon: [
        { url: DEFAULT_BRAND_ASSETS.favicon, type: "image/svg+xml" },
        { url: DEFAULT_BRAND_ASSETS.faviconIco, sizes: "48x48" },
      ],
      shortcut: DEFAULT_BRAND_ASSETS.faviconIco,
      apple: [{ url: DEFAULT_BRAND_ASSETS.appleTouch, sizes: "180x180", type: "image/png" }],
    };
  }
  const url = brandAssetUrl("favicon", fav);
  const type = fav.type === "svg" ? "image/svg+xml" : "image/png";
  return {
    icon: [{ url, type }],
    shortcut: url,
    apple: fav.type === "png" ? [{ url, sizes: "180x180", type: "image/png" }] : [{ url: DEFAULT_BRAND_ASSETS.appleTouch, sizes: "180x180", type: "image/png" }],
  };
}
