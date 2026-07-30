"use client";

import { useRef, type ReactNode } from "react";

/**
 * Kürsör-takipli 3D eğim kartı — premium "spatial" his. İşaretçi kart üzerinde
 * gezdikçe rotateX/rotateY uygulanır ve konumu takip eden bir ışık (glare) parlar.
 * Saf CSS-değişkeni yazımı (React state yok → yeniden render yok, 60fps).
 * prefers-reduced-motion açıkken globals.css eğimi tamamen kapatır (erişilebilirlik).
 */
export function Tilt3D({
  children,
  className = "",
  max = 7,
  glare = 0.16,
  perspective = 1100,
}: {
  children: ReactNode;
  className?: string;
  /** Maksimum eğim açısı (derece). */
  max?: number;
  /** Glare parlaklığı (0 = kapalı). */
  glare?: number;
  perspective?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const r = el.getBoundingClientRect();
      const px = (clientX - r.left) / r.width; // 0..1
      const py = (clientY - r.top) / r.height; // 0..1
      const ry = (px - 0.5) * max * 2;
      const rx = -(py - 0.5) * max * 2;
      el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      if (glare > 0) {
        el.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
        el.style.setProperty("--gi", String(glare));
        el.style.setProperty("--go", "1");
      }
    });
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--go", "0");
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{ ["--tilt-persp" as string]: `${perspective}px` }}
      className={`tilt3d relative ${className}`}
    >
      {children}
      {glare > 0 ? <span className="tilt3d__glare" aria-hidden="true" /> : null}
    </div>
  );
}
