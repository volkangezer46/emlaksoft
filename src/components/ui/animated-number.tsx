"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
// cn() (tailwind-merge, ~9 KB gz) bilerek kullanılmaz: public ana sayfa paketine girmesin.
import { formatAnimatedNumber, type AnimatedNumberFormat } from "./animated-number-format";

/**
 * AnimatedNumber — DEĞER DEĞİŞİNCE hane hane akan sayı (`@number-flow/react`).
 * Rol ayrımı: `CountUp` = ilk görünümde bir kez sayar (sunucu KPI'ları, 0 KB ek);
 * `AnimatedNumber` = kullanıcı girdisiyle canlı değişen sonuç (hesaplayıcı, önizleme).
 * İkisi aynı öğede kullanılmaz.
 *
 * Bütçe ve CLS:
 *  - Sunucu çıktısı, hidrasyon ve hareket azaltma tercihi: düz biçimli metin (tr-TR Intl,
 *    `tabular-nums`). Kütüphane `next/dynamic` (ssr: false) ile AYRI parçadır; ilk yük
 *    paketine girmez, parça inene kadar aynı metin görünür (yer değişmez).
 *  - Hareket azaltmada parça hiç indirilmez.
 *
 * Kullanım: <AnimatedNumber value={tutar} kind="currency" />  → "₺1.234"
 *           <AnimatedNumber value={tutar} suffix=" ₺" />       → "1.234 ₺"
 *           <AnimatedNumber value={12} kind="percent" />       → "%12"
 */
const FallbackText = createContext("");

function Fallback() {
  return useContext(FallbackText);
}

let flowLoaded = false;

const Flow = dynamic(
  () =>
    import("./animated-number-flow").then((m) => {
      flowLoaded = true;
      return m;
    }),
  { ssr: false, loading: Fallback },
);

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function AnimatedNumber({
  value,
  from,
  className,
  ...format
}: AnimatedNumberFormat & {
  value: number;
  /**
   * Bileşen yeniden bağlandığında (ör. "hesaplanıyor" durumundan dönüş) önceki değer:
   * verilirse sayı `from` → `value` akar. Yalnız parça zaten yüklüyse dikkate alınır.
   */
  from?: number;
  className?: string;
}) {
  // Sunucu + hidrasyon anlık görüntüsü "azalt" = düz metin; hidrasyondan sonra gerçek tercih okunur.
  const reduce = useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE).matches,
    () => true,
  );
  // `from` yalnız parça bağlanma anında hazırsa kullanılır; aksi halde yedek metin yeni değeri
  // gösterirken sayaç eski değerden başlayıp geri sıçrardı.
  const [fromAtMount] = useState(() => (flowLoaded ? from : undefined));
  const text = formatAnimatedNumber(value, format);

  return (
    <span className={className ? `tabular-nums ${className}` : "tabular-nums"}>
      {reduce ? (
        text
      ) : (
        <FallbackText.Provider value={text}>
          <Flow value={value} from={fromAtMount} format={format} />
        </FallbackText.Provider>
      )}
    </span>
  );
}
