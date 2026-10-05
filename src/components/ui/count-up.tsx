"use client";

import { useEffect, useRef } from "react";

/**
 * CountUp — değer ilk görünümde bir kez yukarı sayar (tek sayaç; admin ve odometer
 * adları buna yönlenir). Sunucu çıktısı ve hidrasyon SONUÇ değerini basar (CLS/SEO/JS'siz
 * güvenli); animasyon yalnız ekrana girince DOM metnini günceller ve bitince biçimlenmiş
 * metni AYNEN geri koyar. reduced-motion'da hiçbir şey yapmaz.
 *
 * İki kullanım:
 *  - Hazır metin: `value="1.234"` / `"₺1.234"` / `"%12"` (TR binlik, önek/sonek korunur).
 *  - Sayı + biçim: `value={1234} format="money" | "percent" | "number"` (+ decimals, prefix, suffix).
 *    `money` = ₺ tam sayı, `percent` = "%12" (değer zaten yüzde puanı).
 * Süre varsayılanı 700 ms = motion.css `--motion-count`.
 */
export type CountUpFormat = "number" | "money" | "percent";

const RE = /^([^\d]*)(\d{1,3}(?:\.\d{3})+|\d+)([^\d.,]*)$/;

const moneyNf = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

function formatNumeric(n: number, format: CountUpFormat, decimals: number): string {
  if (format === "money") return moneyNf.format(Math.round(n));
  const body = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  return format === "percent" ? `%${body}` : body;
}

export function CountUp({
  value,
  format,
  money,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration,
  durationMs,
  className,
}: {
  value: string | number;
  format?: CountUpFormat;
  /** Eski admin adı: `format="money"` ile aynı. */
  money?: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  /** Eski admin adı: `duration` ile aynı. */
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const ms = duration ?? durationMs ?? 700;
  const fmtKind: CountUpFormat | undefined = money ? "money" : format;
  const numeric = typeof value === "number";
  const text = numeric ? prefix + formatNumeric(value, fmtKind ?? "number", decimals) + suffix : prefix + String(value) + suffix;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let target: number;
    let fmt: (n: number) => string;
    if (numeric) {
      target = value;
      fmt = (n) => prefix + formatNumeric(decimals > 0 ? n : Math.round(n), fmtKind ?? "number", decimals) + suffix;
    } else {
      const m = RE.exec(String(value));
      if (!m) return;
      const [, pre, digits, post] = m;
      const dotted = digits.includes(".");
      target = Number(digits.replace(/\./g, ""));
      fmt = (n) => prefix + pre + (dotted ? Math.round(n).toLocaleString("tr-TR") : String(Math.round(n))) + post + suffix;
    }
    if (!Number.isFinite(target) || Math.abs(target) < 10) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        let start: number | null = null;
        const step = (t: number) => {
          if (start === null) start = t;
          const p = Math.min(1, (t - start) / ms);
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
  }, [text, ms, numeric, value, fmtKind, decimals, prefix, suffix]);

  const cls = [fmtKind || decimals > 0 ? "numeric" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span ref={ref} className={cls || undefined}>
      {text}
    </span>
  );
}
