"use client";

import { useCallback } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Dialog, DialogDescription, DialogFullscreenContent, DialogTitle } from "@/components/ui/dialog";
import type { DocumentRow } from "@/lib/documents";

/*
 * Belge merkezi görsel önizlemesi — document-list'ten AYRI parça: Radix tam ekran dialog ve klavye/indirme
 * mantığı yalnız bir görsele tıklanınca iner (document-list.tsx `dynamic(..., { ssr: false })`).
 */
/**
 * Görsel önizleme — ortak Radix tam ekran primitive'i ile body portalına basılır.
 * `GalleryLightbox` yeniden kullanılamadı: o bileşen kaynağı sabit olarak
 * `/api/property-media/[id]` kuruyor; belge merkezinde görseller iki farklı
 * yetkili uçtan gelir. Esc, focus trap, scroll kilidi ve focus dönüşünü ortak
 * dialog sağlar; görseller arası ok tuşu davranışı burada kalır.
 */
export function DocumentLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: DocumentRow[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const count = images.length;
  const prev = useCallback(() => onIndex((index - 1 + count) % count), [index, count, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % count), [index, count, onIndex]);

  const current = images[index];

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogFullscreenContent
        overlayClassName="bg-ink-950/95 backdrop-blur-sm"
        className="flex flex-col bg-ink-950/95"
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            prev();
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            next();
          }
        }}
      >
      <DialogTitle className="sr-only">{current.name} önizleme</DialogTitle>
      <DialogDescription className="sr-only">
        {count} görsellik belge önizlemesi. Önceki ve sonraki görsele ok tuşlarıyla geçebilirsiniz.
      </DialogDescription>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm font-semibold text-white/85">
          {current.name}
          <span className="ml-2 text-white/45">
            {index + 1} / {count}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {current.downloadUrl ? (
            <a
              href={current.downloadUrl}
              download={current.name}
              className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Bu görseli indir"
            >
              <Download className="h-5 w-5" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Önizlemeyi kapat (Esc)"
            className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        {/* Yetkili uçtan gelen, ölçüsü bilinmeyen belge görseli — next/image
            optimizasyonu burada kazanç sağlamaz, düz <img> kullanılıyor. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.key}
          src={current.previewUrl ?? ""}
          alt={current.name}
          className="max-h-full max-w-full object-contain"
        />
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Önceki görsel"
              className="focus-ring absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Sonraki görsel"
              className="focus-ring absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        ) : null}
      </div>
      </DialogFullscreenContent>
    </Dialog>
  );
}
