"use client";

import { useEffect, useRef } from "react";

type CountUpProps = {
  to: number;
  from?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  /** Turkish thousands separator */
  separator?: boolean;
};

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function format(value: number, decimals: number, separator: boolean) {
  const fixed = value.toFixed(decimals);
  if (!separator) return fixed;
  const [int, dec] = fixed.split(".");
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec ? `${withSep},${dec}` : withSep;
}

export function CountUp({
  to,
  from = 0,
  duration = 850,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
  separator = false,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let io: IntersectionObserver | null = null;

    const run = () => {
      if (started.current) return;
      started.current = true;
      // Hareket azaltma tercihi: CSS kuralı JS RAF döngüsünü durdurmaz,
      // burada elle sonlandırıyoruz.
      if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
        el.textContent = `${prefix}${format(to, decimals, separator)}${suffix}`;
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const value = from + (to - from) * easeOutExpo(p);
        el.textContent = `${prefix}${format(value, decimals, separator)}${suffix}`;
        if (p < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver === "undefined") {
      run();
    } else {
      io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            run();
            io?.disconnect();
          }
        },
        { threshold: 0.01, rootMargin: "220px 0px 220px 0px" },
      );
      io.observe(el);
    }

    return () => {
      io?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [decimals, duration, from, prefix, separator, suffix, to]);

  return (
    // numeric: tabular rakamlar — sayım sırasında genişlik titremesin
    <span ref={ref} className={`numeric ${className}`.trim()}>
      {prefix}
      {format(from, decimals, separator)}
      {suffix}
    </span>
  );
}
