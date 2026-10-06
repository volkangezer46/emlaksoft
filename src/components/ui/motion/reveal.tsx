"use client";

import { Children, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { MotionProvider } from "./motion-provider";
import { EASE_OUT, MOTION_MS, STAGGER_MAX, seconds } from "./tokens";

/**
 * Görünürlükte giriş (bir kez). İLERLEMECİ GELİŞTİRME:
 *  - Sunucu çıktısı ve hidrasyon içeriği GÖRÜNÜR basar (JS'siz, LCP/SEO güvenli; CLS yok).
 *  - Hidrasyondan sonra öğe ekranın ALTINDAysa "kurulur" (görünmezken saklanır, kullanıcı
 *    görmez) ve kaydırınca yumuşakça belirir. Zaten ekrandaysa hiçbir şey oynamaz.
 *  - Hareket azaltma tercihinde gözlemci hiç kurulmaz.
 * Yalnız opacity + transform (8 px). Süre `--motion-slow`.
 */
type Phase = "idle" | "armed" | "shown";

function useRevealPhase(ref: RefObject<HTMLElement | null>, disabled: boolean): Phase {
  const [phase, setPhase] = useState<Phase>("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled || typeof IntersectionObserver === "undefined") return;
    let first = true;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (first) {
          first = false;
          if (hit) io.disconnect();
          else setPhase("armed");
          return;
        }
        if (hit) {
          setPhase("shown");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, disabled]);
  return phase;
}

const enter = { duration: seconds(MOTION_MS.slow), ease: EASE_OUT };
const instant = { duration: 0 };

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** ms; en çok 240 önerilir. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const phase = useRevealPhase(ref, reduce);
  const hidden = phase === "armed";
  return (
    <MotionProvider>
      <m.div
        ref={ref}
        className={className}
        initial={false}
        animate={hidden ? { opacity: 0, y: 8 } : { opacity: 1, y: 0 }}
        transition={hidden ? instant : { ...enter, delay: seconds(delay) }}
      >
        {children}
      </m.div>
    </MotionProvider>
  );
}

const itemVariants = {
  hidden: { opacity: 0, y: 8, transition: instant },
  shown: { opacity: 1, y: 0, transition: enter },
};

/**
 * Stagger — çocuklar sırayla belirir (40 ms aralık, ilk 12 öğe; gerisi beklemeden).
 * Her doğrudan çocuk bir `m.div` sarmalayıcısına alınır; ızgara düzeni için `className`
 * ızgara sınıflarını taşır, `itemClassName` her hücreye verilir (ör. "min-w-0 h-full").
 */
export function Stagger({
  children,
  className,
  itemClassName,
}: {
  children: ReactNode;
  className?: string;
  itemClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const phase = useRevealPhase(ref, reduce);
  const items = Children.toArray(children);
  return (
    <MotionProvider>
      <m.div
        ref={ref}
        className={className}
        initial={false}
        animate={phase === "armed" ? "hidden" : "shown"}
        variants={{ hidden: {}, shown: { transition: { staggerChildren: seconds(MOTION_MS.stagger) } } }}
      >
        {items.map((child, i) => (
          <m.div key={i} className={itemClassName} variants={i < STAGGER_MAX ? itemVariants : undefined}>
            {child}
          </m.div>
        ))}
      </m.div>
    </MotionProvider>
  );
}
