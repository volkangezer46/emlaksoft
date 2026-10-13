"use client";

import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type TransitionEvent } from "react";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { EASE_OUT, MOTION_MS, STAGGER_MAX } from "./tokens";

/**
 * Görünürlükte giriş (bir kez). İLERLEMECİ GELİŞTİRME:
 *  - Sunucu çıktısı ve hidrasyon içeriği GÖRÜNÜR basar (JS'siz, LCP/SEO güvenli; CLS yok).
 *  - Hidrasyondan sonra öğe ekranın ALTINDAysa "kurulur" (görünmezken saklanır, kullanıcı
 *    görmez) ve kaydırınca yumuşakça belirir. Zaten ekrandaysa hiçbir şey oynamaz.
 *  - Hareket azaltma tercihinde gözlemci hiç kurulmaz.
 * Yalnız opacity + transform (8 px). Süre `--motion-slow`, eğri `--ease-out`.
 *
 * Kütüphanesiz: IntersectionObserver + satır içi CSS geçişi (eski motion/react `m.div` sürümüyle aynı değerler:
 * gizli = opacity 0 + translateY(8px) anında; görünür = 320 ms cubic-bezier(0.22, 1, 0.36, 1), `delay` ms gecikme;
 * Stagger'da 40 ms aralık, ilk 12 öğe). Geçiş bitince satır içi `transition` kalkar (son kare = sunucu çıktısı).
 */
type Phase = "idle" | "armed" | "shown" | "done";

function useRevealPhase(ref: RefObject<HTMLElement | null>, disabled: boolean): [Phase, (p: Phase) => void] {
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
  return [phase, setPhase];
}

const EASE = `cubic-bezier(${EASE_OUT.join(", ")})`;
/** Sunucu çıktısı ve son kare (motion/react `initial={false}` çıktısıyla aynı). */
const VISIBLE: CSSProperties = { opacity: 1, transform: "none" };
const HIDDEN: CSSProperties = { opacity: 0, transform: "translateY(8px)" };

function enterStyle(delayMs: number): CSSProperties {
  const d = `${MOTION_MS.slow}ms ${EASE} ${delayMs}ms`;
  return { opacity: 1, transform: "none", transition: `opacity ${d}, transform ${d}` };
}

/** Geçiş bitince (opacity, öğenin kendisi) satır içi geçişi kaldır. */
function onEnterEnd(setPhase: (p: Phase) => void) {
  return (e: TransitionEvent<HTMLElement>) => {
    if (e.target === e.currentTarget && e.propertyName === "opacity") setPhase("done");
  };
}

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
  const [phase, setPhase] = useRevealPhase(ref, reduce);
  const style = phase === "armed" ? HIDDEN : phase === "shown" ? enterStyle(delay) : VISIBLE;
  return (
    <div ref={ref} className={className} style={style} onTransitionEnd={phase === "shown" ? onEnterEnd(setPhase) : undefined}>
      {children}
    </div>
  );
}

/**
 * Stagger — çocuklar sırayla belirir (40 ms aralık, ilk 12 öğe; gerisi beklemeden).
 * Her doğrudan çocuk bir sarmalayıcı `div`e alınır; ızgara düzeni için `className`
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
  const [phase, setPhase] = useRevealPhase(ref, reduce);
  const items = Children.toArray(children);
  const last = Math.min(items.length, STAGGER_MAX) - 1;
  return (
    <div ref={ref} className={className}>
      {items.map((child, i) => {
        // İlk 12 öğe kademelenir; sonrakiler hiç gizlenmez (eski sürümde de varyantsızdı).
        if (i >= STAGGER_MAX) {
          return (
            <div key={i} className={itemClassName}>
              {child}
            </div>
          );
        }
        const style = phase === "armed" ? HIDDEN : phase === "shown" ? enterStyle(i * MOTION_MS.stagger) : VISIBLE;
        return (
          <div key={i} className={itemClassName} style={style} onTransitionEnd={phase === "shown" && i === last ? onEnterEnd(setPhase) : undefined}>
            {child}
          </div>
        );
      })}
    </div>
  );
}
