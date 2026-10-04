"use client";

import { useEffect, useState } from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import {
  ANIMATED_NUMBER_LOCALE,
  animatedNumberOptions,
  animatedNumberValue,
  type AnimatedNumberFormat,
} from "./animated-number-format";

/**
 * AnimatedNumber'ın TEMBEL parçası: `@number-flow/react` yalnız bu dosyadan içe aktarılır ve
 * `animated-number.tsx` bunu `next/dynamic` (ssr: false) ile yükler. Başka yerden doğrudan
 * içe aktarma: kütüphane o sayfanın ilk yük paketine girer.
 */
export default function AnimatedNumberFlow({
  value,
  from,
  format,
}: {
  value: number;
  /** Verilirse ilk karede bu değer çizilir, sonraki karede `value`ya akar (yeniden bağlanan sayaçlar). */
  from?: number;
  format: AnimatedNumberFormat;
}) {
  const [entered, setEntered] = useState(from === undefined);
  useEffect(() => {
    if (entered) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [entered]);
  const shown = entered ? value : (from ?? value);

  return (
    <NumberFlow
      value={animatedNumberValue(shown, format.kind)}
      locales={ANIMATED_NUMBER_LOCALE}
      format={animatedNumberOptions(format) as Format}
      prefix={format.prefix}
      suffix={format.suffix}
    />
  );
}
