"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { RadialGauge } from "@/components/ui/viz/radial-gauge";
import { AnimatedNumber } from "@/components/ui/animated-number";

/**
 * TV görsel parçaları: el yapımı, bağımlılıksız SVG grafikler (renkler CSS token'ı; sabit renk yok), madalya, hedef
 * halkası (tek grafik seti: RadialGauge) ve hafif konfeti tuvali. Yalnız transform/opacity animasyonu.
 */

export const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** Tam TL (kısaltma yok), döviz portföyünde kendi simgesi. */
export function money(n: number, currency = "TRY"): string {
  const cur = /^[A-Z]{3}$/.test(currency) ? currency : "TRY";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(Math.round(n));
}

/** Canlı sayı (değişince hane hane akar; hareket azaltmada düz metin). */
export function TvNumber({ value, money: isMoney }: { value: number; money?: boolean }) {
  return isMoney ? <AnimatedNumber value={value} kind="currency" /> : <AnimatedNumber value={value} />;
}

export function TvEmpty({ icon, text, hint }: { icon: ReactNode; text: string; hint?: string }) {
  return (
    <div className="tv-empty">
      <span className="tv-empty-icon" aria-hidden>
        {icon}
      </span>
      <p>{text}</p>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

/** Değişim rozeti: ↑ %12 / ↓ %8 / "yeni" (önceki dönem 0). */
export function Delta({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  if (previous <= 0) {
    return current > 0 ? (
      <span className="tv-delta" data-tone="up">
        yeni
      </span>
    ) : null;
  }
  const d = Math.round(((current - previous) / previous) * 100);
  const tone = d > 0 ? "up" : d < 0 ? "down" : "flat";
  return (
    <span className="tv-delta" data-tone={tone} title="Geçen ayın aynı günlerine göre">
      <svg viewBox="0 0 10 10" aria-hidden>
        {tone === "down" ? <path d="M5 8 1.5 3h7z" fill="currentColor" /> : tone === "up" ? <path d="M5 2 8.5 7h-7z" fill="currentColor" /> : <rect x="1.5" y="4" width="7" height="2" fill="currentColor" />}
      </svg>
      %{Math.abs(d)}
    </span>
  );
}

/** Mini çubuk dizisi (KPI kutusu). Son çubuk (bugün) vurgulu. */
export function MiniBars({ values, label }: { values: readonly number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 100 / Math.max(1, values.length);
  return (
    <svg className="tv-minibars" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * 38);
        return <rect key={i} x={i * w + w * 0.18} y={40 - h} width={w * 0.64} height={h} rx={w * 0.2} data-last={i === values.length - 1} />;
      })}
    </svg>
  );
}

/** Büyük alan + çubuk grafiği: alan = yeni talep, çubuk = kazanılan anlaşma (aynı 14 gün). */
export function AreaBars({
  area,
  bars,
  labels,
  areaLabel,
  barLabel,
}: {
  area: readonly number[];
  bars: readonly number[];
  labels: readonly string[];
  areaLabel: string;
  barLabel: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const W = 1000;
  const H = 300;
  const pad = 14;
  const n = Math.max(area.length, bars.length, 2);
  const maxA = Math.max(1, ...area);
  const maxB = Math.max(1, ...bars);
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const yA = (v: number) => H - 8 - (v / maxA) * (H - 48);
  const pts = area.map((v, i) => [x(i), yA(v)] as const);
  // Yumuşak eğri (kardinal → bezier).
  const curve = pts.reduce((d, [px, py], i) => {
    if (i === 0) return `M${px},${py}`;
    const [x0, y0] = pts[i - 1];
    const cx = (x0 + px) / 2;
    return `${d} C${cx},${y0} ${cx},${py} ${px},${py}`;
  }, "");
  const bw = ((W - pad * 2) / n) * 0.3;
  return (
    <div className="tv-area-wrap">
    <svg className="tv-area" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${areaLabel} ve ${barLabel}, son ${n} gün`}>
      <defs>
        <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tv-gold)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--tv-gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} x2={W - pad} y1={40 + g * (H - 48)} y2={40 + g * (H - 48)} className="tv-grid-line" />
      ))}
      {bars.map((v, i) => {
        const h = (v / maxB) * (H - 110);
        return v > 0 ? <rect key={i} className="tv-area-bar" x={x(i) - bw / 2} y={H - 8 - h} width={bw} height={h} rx={5} /> : null;
      })}
      {pts.length > 1 ? (
        <>
          <path d={`${curve} L${x(pts.length - 1)},${H - 8} L${x(0)},${H - 8} Z`} fill={`url(#a${id})`} className="tv-area-fill" />
          <path d={curve} className="tv-area-line" fill="none" />
        </>
      ) : null}
    </svg>
      {/* Gün etiketleri HTML'de: SVG "none" ölçeğinde yazı gerilmesin. */}
      <div className="tv-area-labels" aria-hidden>
        {labels.map((l, i) => (
          <span key={i} style={{ left: `${(pad / W) * 100 + (i / (n - 1)) * (100 - (2 * pad * 100) / W)}%` }}>
            {i % 2 === (labels.length - 1) % 2 ? l : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Hedef halkası (tek grafik seti: RadialGauge). */
export function TvRing({ pct, label, size = 120, stroke = 10, children }: { pct: number; label: string; size?: number; stroke?: number; children?: ReactNode }) {
  return (
    <div className="tv-ring">
      <RadialGauge value={Math.max(0, Math.min(100, pct))} max={100} size={size} stroke={stroke} color="var(--tv-gold)" trackColor="var(--tv-line)" format="percent" ariaLabel={label} fluid live>
        {children}
      </RadialGauge>
    </div>
  );
}

/** Podyum madalyası (SVG; emoji yok). 1 altın, 2 gümüş, 3 bronz — renkler token. */
export function Medal({ rank }: { rank: 1 | 2 | 3 }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tone = rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze";
  return (
    <svg className="tv-medal" viewBox="0 0 64 80" role="img" aria-label={`${rank}. sıra`}>
      <defs>
        <linearGradient id={`m${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`var(--tv-${tone}-hi)`} />
          <stop offset="100%" stopColor={`var(--tv-${tone}-lo)`} />
        </linearGradient>
      </defs>
      <path d="M18 2h12l6 22H24z" className="tv-medal-ribbon" />
      <path d="M46 2H34l-6 22h12z" className="tv-medal-ribbon tv-medal-ribbon-b" />
      <circle cx="32" cy="50" r="24" fill={`url(#m${id})`} />
      <circle cx="32" cy="50" r="18" fill="none" className="tv-medal-inner" />
      <text x="32" y="58" textAnchor="middle" className="tv-medal-num">
        {rank}
      </text>
    </svg>
  );
}

/** Gün serisi (alev) simgesi. */
export function Flame() {
  return (
    <svg className="tv-flame" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-9.5z" fill="currentColor" />
    </svg>
  );
}

/**
 * Konfeti: tek tuval, ~120 parçacık, 4 sn, sonra kendini temizler. `prefers-reduced-motion`'da hiç çizilmez (çağıran
 * bileşeni hiç bağlamaz). Renkler kök token'larından okunur.
 */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const css = getComputedStyle(canvas);
    const colors = ["--tv-gold", "--tv-gold-hi", "--tv-accent", "--tv-good", "--tv-ink"].map((v) => css.getPropertyValue(v).trim() || "gold");
    const W = canvas.width;
    const H = canvas.height;
    const parts = Array.from({ length: 120 }, (_, i) => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * W * 0.012,
      vy: -(Math.random() * H * 0.018 + H * 0.006),
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      s: (Math.random() * 8 + 6) * dpr,
      c: colors[i % colors.length],
    }));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const el = t - t0;
      ctx.clearRect(0, 0, W, H);
      const fade = el > 3000 ? Math.max(0, 1 - (el - 3000) / 1000) : 1;
      ctx.globalAlpha = fade;
      for (const p of parts) {
        p.vy += H * 0.00045;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (el < 4000) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="tv-confetti" aria-hidden />;
}
