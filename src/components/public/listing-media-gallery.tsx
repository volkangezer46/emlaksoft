import dynamic from "next/dynamic";
import { MediaTabs } from "@/components/public/media-tabs";
import type { GalleryImage } from "@/components/public/gallery-lightbox";

// Lightbox etkileşimli client komponenti — dynamic import ile ayrı chunk'a alınır, galeri alanı yüklenene dek
// en-boy oranını koruyan iskelet görünür.
const GalleryLightbox = dynamic(
  () => import("@/components/public/gallery-lightbox").then((m) => m.GalleryLightbox),
  { loading: () => <div className="aspect-[16/10] w-full animate-pulse bg-ink-950/8" /> },
);

/**
 * Public ilan medyası (vitrin ilan detayı, paylaşım linki): "Fotoğraflar" ve "Kat planı" ayrı sekmeler (PF-01 / PUB-9).
 * Kat planı kırpılmadan (beyaz zeminde, contain) gösterilir. Yalnız public kuralından geçmiş görseller verilir
 * (`isPublicListingImage`; belge asla). Kat planı yoksa sekme şeridi çizilmez, galeri eskisi gibi görünür.
 */
export function ListingMediaGallery({
  photos,
  floorPlans,
  alt,
  priority = false,
  sizes = "(max-width: 1024px) 100vw, 60vw",
  mainClassName = "relative aspect-[16/10] w-full",
  thumbsClassName = "grid grid-cols-5 gap-2 p-2",
  tone = "light",
  tabsClassName,
}: {
  photos: GalleryImage[];
  floorPlans: GalleryImage[];
  alt: string;
  priority?: boolean;
  sizes?: string;
  mainClassName?: string;
  thumbsClassName?: string;
  /** Koyu zeminli yüzey (paylaşım linki) için sekme renkleri. */
  tone?: "light" | "dark";
  /** Sekme paneli ile şerit arası boşluk gibi yüzeye özgü sarmalayıcı sınıfı. */
  tabsClassName?: string;
}) {
  const tabs = [
    ...(photos.length > 0
      ? [
          {
            id: "fotograflar",
            label: "Fotoğraflar",
            count: photos.length,
            content: (
              <GalleryLightbox
                images={photos}
                alt={alt}
                priority={priority}
                sizes={sizes}
                mainClassName={mainClassName}
                thumbsClassName={thumbsClassName}
              />
            ),
          },
        ]
      : []),
    ...(floorPlans.length > 0
      ? [
          {
            id: "kat-plani",
            label: floorPlans.length > 1 ? "Kat planları" : "Kat planı",
            count: floorPlans.length,
            content: (
              <GalleryLightbox
                images={floorPlans}
                alt={`${alt} — kat planı`}
                priority={priority && photos.length === 0}
                sizes={sizes}
                mainClassName={mainClassName}
                thumbsClassName={thumbsClassName}
                fit="contain"
              />
            ),
          },
        ]
      : []),
  ];
  if (tabs.length === 0) return null;
  const content = <MediaTabs tabs={tabs} label="İlan fotoğrafları ve kat planı" tone={tone} />;
  return tabsClassName && tabs.length > 1 ? <div className={tabsClassName}>{content}</div> : content;
}
