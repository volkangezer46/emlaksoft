"use client";

import { useCallback, type ComponentProps, type ElementType, type RefCallback } from "react";

/**
 * useAutoAnimate — liste öğesi eklenince/çıkınca/yer değiştirince yumuşak geçiş
 * (`@formkit/auto-animate`, WAAPI). `.list-stagger` yalnız İLK girişi kapsar; bu kanca
 * sonraki ekleme / çıkış / yeniden sıralamayı kapsar (ikisini aynı öğede kullanma).
 *
 * Kurallar:
 *  - Yalnız zaten istemci olan listelerde kullan (sunucu bileşenini bunun için istemciye çevirme).
 *  - Çocukların `key`leri kararlı olmalı (dizi indeksi değil); aksi halde yanlış satır canlanır.
 *  - Kütüphane DİNAMİK içe aktarılır: ilk yük paketine girmez, liste bağlanınca ayrı parça olarak iner.
 *  - Hareket azaltma tercihinde kütüphane hiç indirilmez; liste anında güncellenir.
 *  - Süre/easing motion.css token'larından okunur (--motion-base, --ease-out).
 *
 * Kullanım:
 *   const listRef = useAutoAnimate<HTMLUListElement>();
 *   <ul ref={listRef}>{items.map((it) => <li key={it.id}>…</li>)}</ul>
 * veya döngü içinde (kanca çağrılamayan yerde): <AutoAnimate as="div">…</AutoAnimate>
 */
export type AutoAnimateOptions = {
  /** ms; verilmezse --motion-base. */
  duration?: number;
  /** CSS easing; verilmezse --ease-out. */
  easing?: string;
};

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function tokenMs(name: string, fallback: number): number {
  const raw = token(name);
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : fallback;
}

export function useAutoAnimate<T extends HTMLElement = HTMLElement>(options?: AutoAnimateOptions): RefCallback<T> {
  const duration = options?.duration;
  const easing = options?.easing;
  return useCallback(
    (node: T | null) => {
      if (!node) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      let cancelled = false;
      let destroy: (() => void) | undefined;
      void import("@formkit/auto-animate")
        .then(({ default: autoAnimate }) => {
          if (cancelled || !node.isConnected) return;
          const controller = autoAnimate(node, {
            duration: duration ?? tokenMs("--motion-base", 220),
            easing: easing ?? (token("--ease-out") || "ease-out"),
          });
          destroy = () => {
            controller.disable();
            controller.destroy?.();
          };
        })
        .catch(() => {
          // Parça inemezse (çevrimdışı vb.) liste animasyonsuz çalışmaya devam eder.
        });
      return () => {
        cancelled = true;
        destroy?.();
      };
    },
    [duration, easing],
  );
}

/** Döngü içinde ya da kanca çağrılamayan yerde: çocukları otomatik canlandıran sarmalayıcı öğe. */
export function AutoAnimate<E extends "div" | "ul" | "ol" | "span" | "section" = "div">({
  as,
  options,
  ...props
}: { as?: E; options?: AutoAnimateOptions } & Omit<ComponentProps<E>, "ref">) {
  const ref = useAutoAnimate<HTMLElement>(options);
  const Tag = (as ?? "div") as ElementType;
  return <Tag ref={ref} {...props} />;
}
