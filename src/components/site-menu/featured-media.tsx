"use client";

/* eslint-disable @next/next/no-img-element -- menü medyası dinamik rotadan (sandbox'lı) gelir; sabit oranlı kutuda <img>/<video> */
import { useSyncExternalStore } from "react";
import type { PublicFeatured } from "@/lib/site-menu/public";

/**
 * Öne çıkan kart medyası. YALNIZ panel açıkken çizilir (kapalıyken hiçbir dosya indirilmez).
 * Önce poster (durağan kare) gelir; hareket tercihi serbestse ve Veri Tasarrufu kapalıysa animasyonlu görsel / video
 * poster üstünde yumuşakça belirir. prefers-reduced-motion veya Save-Data'da yalnız poster kalır.
 * Kutu `aspect-ratio` ile sabittir (CLS=0).
 */

type Conn = { saveData?: boolean; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  conn?.addEventListener?.("change", cb);
  return () => {
    mq.removeEventListener("change", cb);
    conn?.removeEventListener?.("change", cb);
  };
}

function snapshotStatic(): boolean {
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || conn?.saveData === true;
}

/** true: animasyon yok, yalnız poster. Sunucu çıktısında da güvenli varsayım (panel istemcide açıldığında çizilir). */
function useStaticOnly(): boolean {
  return useSyncExternalStore(subscribe, snapshotStatic, () => true);
}

const RATIO: Record<string, string> = { "16:9": "16 / 9", "4:3": "4 / 3", "3:2": "3 / 2", "1:1": "1 / 1", "21:9": "21 / 9" };

export function FeaturedMedia({ media, active }: { media: NonNullable<PublicFeatured["media"]>; active: boolean }) {
  const staticOnly = useStaticOnly();
  const ratio = RATIO[media.ratio] ?? "16 / 9";
  const ready = (el: HTMLElement) => {
    el.dataset.ready = "1";
  };

  return (
    <span className="mk-feat-media" style={{ aspectRatio: ratio, display: "block" }} aria-hidden={media.alt ? undefined : "true"}>
      {active ? (
        <>
          {media.posterSrc ? <img src={media.posterSrc} alt={media.alt} decoding="async" /> : null}
          {!staticOnly && media.kind === "animated" ? (
            <img className="mk-feat-anim" src={media.src} alt="" decoding="async" onLoad={(e) => ready(e.currentTarget)} />
          ) : null}
          {!staticOnly && media.kind === "video" ? (
            <video
              className="mk-feat-anim"
              src={media.src}
              poster={media.posterSrc ?? undefined}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              aria-hidden="true"
              tabIndex={-1}
              onCanPlay={(e) => ready(e.currentTarget)}
            />
          ) : null}
        </>
      ) : null}
    </span>
  );
}
