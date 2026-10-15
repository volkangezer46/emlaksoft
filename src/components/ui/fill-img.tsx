"use client";

/* eslint-disable @next/next/no-img-element -- bilinçli: `next/image` `unoptimized` + `fill` ile AYNI çıktı, istemci kodu olmadan */
import { useState, type CSSProperties } from "react";

/** next/image `fill` stili (alan doldurma; görsel yüklenemezse alt metin görünür olsun diye `color` kalkar). */
const FILL: CSSProperties = { position: "absolute", height: "100%", width: "100%", left: 0, top: 0, right: 0, bottom: 0, color: "transparent" };
const FILL_ALT: CSSProperties = { position: "absolute", height: "100%", width: "100%", left: 0, top: 0, right: 0, bottom: 0 };

/**
 * Kimlik doğrulamalı/imzalı medya ucundan gelen, OPTİMİZE EDİLMEYEN (`unoptimized`) doldurma görseli. `next/image`
 * bu durumda hiçbir dönüşüm yapmaz ama istemci paketine ~5 KB yükleyici/doğrulama kodu ekliyordu; bu bileşen aynı
 * işaretlemeyi basar (alt, loading=lazy, decoding=async, data-nimg=fill, sınıf, fill stili, src sırası dahil) ve
 * hata anında alt metni görünür yapar (next/image `showAltText` davranışı). Üst öğe `relative` olmalıdır.
 */
export function FillImg({
  src,
  alt,
  className,
  width,
  height,
}: {
  src: string;
  alt: string;
  className?: string;
  /** İsteğe bağlı içsel boyut (B031): tarayıcı en-boy oranını bilir, kod çözme ipucu alır; yerleşim yine `fill`. */
  width?: number;
  height?: number;
}) {
  const [showAlt, setShowAlt] = useState(false);
  return (
    <img
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      data-nimg="fill"
      className={className}
      style={showAlt ? FILL_ALT : FILL}
      src={src}
      onError={() => setShowAlt(true)}
    />
  );
}
