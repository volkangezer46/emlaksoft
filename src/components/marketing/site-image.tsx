import type { CSSProperties } from "react";
import { mediaUrl, type MediaVariant, type SiteMediaView } from "@/lib/site-media/types";

/**
 * Site medyası görseli: düz `<picture>` (AVIF + WebP `srcset`, yedek `<img>` WebP). İstemci JS'i yok; statik ana sayfa
 * dönüştürücüsü bu HTML'i olduğu gibi taşır (adacık gerekmez). `width`/`height` HER ZAMAN yazılır (CLS=0).
 * Öncelik: hero görseli `fetchpriority="high"` ve tembel yükleme YOK; diğerleri `loading="lazy"` + `decoding="async"`.
 * LQIP varsa bulanık arka plan olarak satır içi stilde durur (ek istek yok, pazarlama CSS'i değişmez).
 */

const srcSet = (id: string, list: readonly MediaVariant[]) =>
  [...list].sort((a, b) => a.w - b.w).map((v) => `${mediaUrl(id, v.file)} ${v.w}w`).join(", ");

/** Yedek `<img src>`: 960 px'e en yakın WebP (yoksa herhangi bir varyant). */
function fallback(variants: readonly MediaVariant[]): MediaVariant | undefined {
  const webp = variants.filter((v) => v.format === "webp").sort((a, b) => Math.abs(a.w - 960) - Math.abs(b.w - 960));
  return webp[0] ?? variants[0];
}

export function SiteImage({
  media,
  alt,
  priority = false,
  sizes = "100vw",
  className,
  style,
}: {
  media: SiteMediaView;
  /** Sayfaya özel alt metin; yoksa kütüphanedeki (zorunlu) alt metin. */
  alt?: string;
  /** İlk ekran (hero) görseli: yüksek öncelik, tembel yükleme yok. */
  priority?: boolean;
  sizes?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const img = fallback(media.variants);
  if (!img) return null;
  const avif = media.variants.filter((v) => v.format === "avif");
  const webp = media.variants.filter((v) => v.format === "webp");
  const look: CSSProperties = {
    display: "block",
    width: "100%",
    height: "auto",
    ...(media.lqip ? { backgroundImage: `url(data:image/webp;base64,${media.lqip})`, backgroundSize: "cover", backgroundPosition: "center" } : null),
    ...style,
  };
  const load = priority ? { fetchPriority: "high" as const } : { loading: "lazy" as const, decoding: "async" as const };
  return (
    <picture>
      {avif.length ? <source type="image/avif" srcSet={srcSet(media.id, avif)} sizes={sizes} /> : null}
      {webp.length ? <source type="image/webp" srcSet={srcSet(media.id, webp)} sizes={sizes} /> : null}
      <img src={mediaUrl(media.id, img.file)} width={media.w} height={media.h} alt={alt ?? media.alt} className={className} style={look} {...load} />
    </picture>
  );
}
