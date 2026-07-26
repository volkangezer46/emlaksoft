"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";

export type GalleryImage = { id: string; alt?: string | null };

const MAX_THUMBS = 10;

type GalleryLightboxProps = {
  images: GalleryImage[];
  /** Alt metni olmayan görseller için varsayılan alt (ilan başlığı). */
  alt: string;
  /** Ana görsel kapsayıcısı — relative + en-boy oranı sınıflarını sayfa verir. */
  mainClassName?: string;
  /** Küçük görsel grid'i — kolon/boşluk sınıflarını sayfa verir. */
  thumbsClassName?: string;
  priority?: boolean;
  sizes?: string;
};

/**
 * Public ilan galerisi: küçük görsele tıklayınca büyük görsel değişir,
 * büyük görsele tıklayınca tüm fotoğrafların gezilebildiği lightbox açılır
 * (Esc kapatır, ok tuşları gezdirir, body scroll kilitlenir).
 * Lightbox portal ile body'ye basılır — backdrop-blur/overflow'lu kart
 * ataları fixed konumlandırmayı kırmasın diye.
 */
export function GalleryLightbox({
  images,
  alt,
  mainClassName = "relative aspect-[16/10] w-full",
  thumbsClassName = "grid grid-cols-5 gap-2 p-2",
  priority = false,
  sizes = "(max-width: 1024px) 100vw, 60vw",
}: GalleryLightboxProps) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const count = images.length;
  const prev = useCallback(() => setIndex((i) => (i - 1 + count) % count), [count]);
  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Tab") {
        // Elle kurulmuş dialog: Tab odağı lightbox içinde döndürsün,
        // arkadaki (scroll'u kilitli) sayfaya sızmasın.
        const root = dialogRef.current;
        if (!root) return;
        const focusables = Array.from(root.querySelectorAll<HTMLElement>("button"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement;
        if (e.shiftKey) {
          if (current === first || !root.contains(current)) {
            e.preventDefault();
            last.focus();
          }
        } else if (current === last || !root.contains(current)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, prev, next]);

  if (count === 0) return null;
  const current = images[Math.min(index, count - 1)];
  const srcOf = (img: GalleryImage) => `/api/property-media/${img.id}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`block w-full cursor-zoom-in ${mainClassName}`}
        aria-label="Fotoğrafı tam ekran aç"
      >
        <Image
          key={current.id}
          src={srcOf(current)}
          alt={current.alt ?? alt}
          fill
          priority={priority}
          sizes={sizes}
          className="object-cover"
        />
        <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-ink-950/70 px-2.5 py-1 text-[11px] font-bold text-white">
          <Expand className="h-3.5 w-3.5" /> {index + 1}/{count}
        </span>
      </button>

      {count > 1 ? (
        <div className={thumbsClassName}>
          {images.slice(0, MAX_THUMBS).map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Fotoğraf ${i + 1}'i göster`}
              aria-current={i === index}
              className={`relative aspect-square w-full overflow-hidden rounded-[8px] transition ${
                i === index ? "ring-2 ring-brand-500" : "opacity-75 hover:opacity-100"
              }`}
            >
              <Image
                src={srcOf(img)}
                alt={img.alt ?? `${alt} — fotoğraf ${i + 1}`}
                fill
                sizes="120px"
                className="object-cover"
              />
            </button>
          ))}
          {count > MAX_THUMBS ? (
            <button
              type="button"
              onClick={() => {
                setIndex(MAX_THUMBS);
                setOpen(true);
              }}
              className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-[8px] bg-ink-950/80 text-xs font-extrabold text-white transition hover:bg-ink-950/70"
              aria-label={`${count - MAX_THUMBS} fotoğraf daha — galeriyi aç`}
            >
              +{count - MAX_THUMBS}
            </button>
          ) : null}
        </div>
      ) : null}

      {open
        ? createPortal(
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`${alt} fotoğraf galerisi`}
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[100] flex flex-col bg-ink-950/95 outline-none backdrop-blur-sm"
            >
              <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
                <span className="text-sm font-semibold text-white/80">
                  {index + 1} / {count}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Galeriyi kapat (Esc)"
                  className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="relative flex-1">
                <Image
                  key={current.id}
                  src={srcOf(current)}
                  alt={current.alt ?? alt}
                  fill
                  sizes="100vw"
                  className="object-contain"
                />
                {count > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        prev();
                      }}
                      aria-label="Önceki fotoğraf"
                      className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        next();
                      }}
                      aria-label="Sonraki fotoğraf"
                      className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
