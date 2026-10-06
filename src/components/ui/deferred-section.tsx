"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * DeferredSection — ekran-altı blokları görünür alana yaklaşınca çizen kapı.
 *
 * Sunucu bileşenlerini `children` olarak alır (RSC yükü yine sunucuda hazırlanır ve akar); DOM'a bağlama,
 * hidrasyon ve alt iskelet/içerik geçişleri yalnız kullanıcı o bölgeye yaklaşınca olur. İlk HTML'de
 * `fallback` (içerikle AYNI yükseklikte iskelet) vardır → düzen kayması yok, ilk boyama ve ana iş parçacığı
 * yükü daha küçük. IntersectionObserver yoksa (eski tarayıcı) hemen çizer. Hareket yok: değişim anlıktır,
 * `prefers-reduced-motion` tercihinde ek bir şey yapılmaz (animasyon kullanılmaz).
 *
 * Not: veri çekimi ertelenmez (sunucu bileşenleri isteğin parçasıdır); bu kapı yalnız istemci maliyetini erteler.
 */
export function DeferredSection({
  children,
  fallback,
  rootMargin = "320px 0px",
  className,
  label,
}: {
  children: ReactNode;
  /** Görünür olana dek çizilen iskelet; içerikle aynı yükseklikte olmalı (CLS=0). */
  fallback: ReactNode;
  /** Görünür alana bu kadar kala çizmeye başla. */
  rootMargin?: string;
  className?: string;
  /** Erişilebilirlik: bölge adı (ör. "Ekip performansı"). */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (show) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setShow(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, show]);

  return (
    <div ref={ref} className={className} aria-label={label} data-deferred={show ? "shown" : "pending"}>
      {show ? children : fallback}
    </div>
  );
}
