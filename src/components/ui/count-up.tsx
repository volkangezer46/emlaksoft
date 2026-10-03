"use client";

import { useEffect, useRef } from "react";

/**
 * CountUp — KPI değeri ilk görünümde bir kez yukarı sayar.
 * Sunucu çıktısı ve hidrasyon SONUÇ değeri basar (CLS/SEO/JS'siz güvenli);
 * animasyon yalnız ekrana girince DOM metnini günceller. reduced-motion'da
 * ve tamsayı olmayan/biçimli değerlerde (para, yüzde...) hiçbir şey yapmaz.
 * Desteklenen biçim: `1234` ya da TR binlik `1.234`, isteğe bağlı önek/sonek.
 */
const RE = /^([^\d]*)(\d{1,3}(?:\.\d{3})+|\d+)([^\d.,]*)$/;

export function CountUp({ value, duration = 700 }: { value: string | number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = String(value);

  useEffect(() => {
    const el = ref.current;
    const m = RE.exec(text);
    if (!el || !m) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const [, pre, digits, post] = m;
    const dotted = digits.includes(".");
    const target = Number(digits.replace(/\./g, ""));
    if (!Number.isFinite(target) || target < 10) return;
    const fmt = (n: number) => pre + (dotted ? Math.round(n).toLocaleString("tr-TR") : String(Math.round(n))) + post;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        let start: number | null = null;
        const step = (t: number) => {
          if (start === null) start = t;
          const p = Math.min(1, (t - start) / duration);
          el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(step);
          else el.textContent = text;
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      el.textContent = text;
    };
  }, [text, duration]);

  return <span ref={ref}>{text}</span>;
}
