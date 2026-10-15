"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { runWhenIdle } from "@/lib/idle";

/**
 * DeferredSection — ekran-altı blokları ilk boyamadan SONRA bağlayan kapı.
 *
 * Sunucu bileşenlerini `children` olarak alır (RSC yükü yine sunucuda hazırlanır ve akar); DOM'a bağlama ve hidrasyon
 * ilk boyamayı geciktirmesin diye ertelenir. Bağlama iki yoldan hangisi önce gelirse: (1) tarayıcı BOŞTA (ilk
 * boyama/etkileşim işleri bitince; B048 — eskiden yalnız kaydırınca bağlanıyordu, alt paneller 3-20 sn "Yükleniyor"
 * kalıyordu), (2) bölge görünür alana `rootMargin` kadar yaklaşınca. İlk HTML'de `fallback` (içerikle AYNI yükseklikte
 * iskelet) vardır → düzen kayması yok. Yedek ekran dışında beklediği için `role="status"` / `aria-busy` TAŞIMAMALI
 * (çağıran `aria-hidden` iskelet verir); kap da meşgul işaretlenmez. IntersectionObserver yoksa hemen çizer.
 * Hareket yok: değişim anlıktır.
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
  /** Bağlanana dek çizilen iskelet; içerikle aynı yükseklikte olmalı (CLS=0) ve `aria-busy`/`role="status"` taşımamalı. */
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
    const reveal = () => setShow(true);
    // İlk boyamadan sonra boşta kendiliğinden bağlan (görünür alana gelmesini bekleme).
    const cancelIdle = runWhenIdle(reveal);
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(reveal, 0);
      return () => {
        cancelIdle();
        clearTimeout(t);
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          reveal();
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => {
      cancelIdle();
      io.disconnect();
    };
  }, [rootMargin, show]);

  return (
    <div ref={ref} className={className} aria-label={label} data-deferred={show ? "shown" : "pending"}>
      {show ? children : fallback}
    </div>
  );
}
