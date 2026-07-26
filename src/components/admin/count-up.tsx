"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  durationMs?: number;
  money?: boolean;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  className?: string;
};

function format(n: number, { money, decimals }: { money?: boolean; decimals?: number }) {
  if (money) {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(Math.round(n));
  }
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 0,
  }).format(n);
}

/** Sayıyı 0'dan hedefe akıcı biçimde sayar (ease-out). Görünürlüğe girince tetiklenir. */
export function CountUp({ value, durationMs = 1100, money, suffix, prefix, decimals, className }: Props) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const run = () => {
      if (started.current) return;
      started.current = true;
      // Hareket azaltma tercihi: RAF döngüsünü hiç başlatma
      if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setDisplay(value);
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(value * eased);
        if (t < 1) requestAnimationFrame(tick);
        else setDisplay(value);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [value, durationMs]);

  return (
    // numeric: tabular rakamlar — sayım sırasında genişlik titremesin
    <span ref={ref} className={`numeric ${className ?? ""}`.trim()}>
      {prefix}
      {format(display, { money, decimals })}
      {suffix}
    </span>
  );
}
