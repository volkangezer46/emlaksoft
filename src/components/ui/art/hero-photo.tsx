// Bilinçli <picture>: varyantlar derleme adımında hazır (AVIF+WebP, srcset); next/image optimizasyonu ikinci kez çalışmasın.
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { heroPhoto, heroPhotoSrcSet, heroPhotoUrl, type HeroPhotoId, type HeroPhotoMeta } from "@/lib/media/hero-photos";

/**
 * Metin kontrastı için koyu degrade katmanı. Renk `--hero-scrim` (varsayılan gece laciverti) ile temalanır:
 * - `bottom`: alttan yukarı (kart başlığı / alt bilgi)
 * - `left`: soldan sağa (hero metni solda, görsel sağda — v4 ana sayfa)
 * - `full`: tüm yüzeye eşit örtü (üstünde ortalanmış metin)
 * - `vignette`: kenarlardan merkeze hafif karartma (salt atmosfer)
 */
export type HeroPhotoOverlay = "none" | "bottom" | "left" | "full" | "vignette";

const SCRIM = "var(--hero-scrim, 8 15 32)";
const OVERLAY: Record<Exclude<HeroPhotoOverlay, "none">, string> = {
  bottom: `linear-gradient(to top, rgb(${SCRIM} / .82) 0%, rgb(${SCRIM} / .45) 38%, rgb(${SCRIM} / 0) 72%)`,
  left: `linear-gradient(to right, rgb(${SCRIM} / .86) 0%, rgb(${SCRIM} / .6) 34%, rgb(${SCRIM} / .12) 68%, rgb(${SCRIM} / 0) 100%)`,
  full: `linear-gradient(rgb(${SCRIM} / .55), rgb(${SCRIM} / .55))`,
  vignette: `radial-gradient(ellipse at 50% 45%, rgb(${SCRIM} / 0) 45%, rgb(${SCRIM} / .55) 100%)`,
};

/** Varsayılan `sizes`: tam genişlik hero. Kartlarda gerçek yerleşim genişliğini verin (örn. "(min-width: 1024px) 360px, 100vw"). */
const DEFAULT_SIZES = "100vw";

export type HeroPhotoProps = {
  /** Manifest kimliği (src/lib/media/hero-photos.ts) ya da doğrudan meta. */
  photo: HeroPhotoId | HeroPhotoMeta;
  /** true → alt="" ve aria-hidden (yalnız atmosfer; anlam yanındaki metindedir). */
  decorative?: boolean;
  /** Manifestteki Türkçe alt metni geçersiz kılar. */
  alt?: string;
  /** Ekranın ilk görünen büyük görseli (LCP): eager + fetchpriority=high. Sayfada en çok BİR tane. */
  priority?: boolean;
  sizes?: string;
  /** srcset'e girecek en büyük genişlik (küçük kartta 2560 indirilmesin). */
  maxWidth?: number;
  overlay?: HeroPhotoOverlay;
  /** Odak (object-position) geçersiz kılma; varsayılan manifest `focal`. */
  focal?: string;
  /**
   * `fill` (varsayılan): üst öğeyi doldurur (üst öğe boyut verir; bileşen kendisi `relative` + `overflow-hidden`).
   * `intrinsic`: görselin kendi en-boy oranıyla blok.
   */
  layout?: "fill" | "intrinsic";
  className?: string;
  imgClassName?: string;
  style?: CSSProperties;
  /** Görselin ÜSTÜNDE çizilen içerik (overlay'in de üstünde). */
  children?: ReactNode;
};

/**
 * HeroPhoto — görsel kütüphanesindeki lisanslı fotoğrafı <picture> ile basar: AVIF → WebP srcset, baskın renk + LQIP
 * bulanık zemin (yüklenene kadar), odak noktası, isteğe bağlı koyu degrade. İstemci kodu yok (sunucu bileşeni).
 * Kullanım ve hangi ekrana hangi fotoğraf: docs/design/GORSEL_KUTUPHANE.md.
 */
export function HeroPhoto({
  photo,
  decorative = false,
  alt,
  priority = false,
  sizes = DEFAULT_SIZES,
  maxWidth,
  overlay = "none",
  focal,
  layout = "fill",
  className,
  imgClassName,
  style,
  children,
}: HeroPhotoProps) {
  const p = typeof photo === "string" ? heroPhoto(photo) : photo;
  const fallbackWidth = p.widths.filter((w) => w <= (maxWidth ?? Infinity)).at(-1) ?? p.widths[0];
  const fill = layout === "fill";
  return (
    <div
      className={cn("relative isolate overflow-hidden", fill && "h-full w-full", className)}
      style={{
        backgroundColor: p.color,
        backgroundImage: `url("${p.lqip}")`,
        backgroundSize: "cover",
        backgroundPosition: focal ?? p.focal,
        aspectRatio: fill ? undefined : `${p.width} / ${p.height}`,
        ...style,
      }}
      data-hero-photo={p.id}
    >
      <picture>
        <source type="image/avif" srcSet={heroPhotoSrcSet(p, "avif", maxWidth)} sizes={sizes} />
        <source type="image/webp" srcSet={heroPhotoSrcSet(p, "webp", maxWidth)} sizes={sizes} />
        <img
          src={heroPhotoUrl(p, fallbackWidth, "webp")}
          alt={decorative ? "" : (alt ?? p.alt)}
          aria-hidden={decorative || undefined}
          width={p.width}
          height={p.height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding={priority ? "sync" : "async"}
          draggable={false}
          className={cn("absolute inset-0 h-full w-full object-cover", imgClassName)}
          style={{ objectPosition: focal ?? p.focal }}
        />
      </picture>
      {overlay !== "none" ? <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: OVERLAY[overlay] }} /> : null}
      {children ? <div className="relative z-[1] h-full">{children}</div> : null}
    </div>
  );
}
