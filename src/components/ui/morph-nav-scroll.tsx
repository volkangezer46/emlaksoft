"use client";

import { useEffect, useRef } from "react";
import { centerScrollLeft } from "@/lib/morph-tabs";

/**
 * Yatay kaydırılan sekme şeridinde ETKİN sekmeyi görünür alana ortalar (mobilde sağa taşan şeritte kullanıcı
 * nerede olduğunu kaybetmesin) ve kenarlarda "devamı var" ipucu gölgesi için `data-more-left` / `data-more-right`
 * işaretlerini günceller (CSS: `.strip-fade`, shared-ui.css). Kaydırılan öğenin çocuğu olarak çizilir; kendisi
 * görünmez. `levels`: kaydırma kapsayıcısı kaç üst düzeydedir (varsayılan 1 = doğrudan ebeveyn). Şerit sığıyorsa dokunmaz.
 */
export function MorphNavScrollActive({ activeId, levels = 1 }: { activeId: string | null; levels?: 1 | 2 }) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let strip: HTMLElement | null | undefined = ref.current?.parentElement;
    if (levels === 2) strip = strip?.parentElement;
    if (!strip) return;
    const el = strip;
    const sync = () => {
      el.toggleAttribute("data-more-left", el.scrollLeft > 2);
      el.toggleAttribute("data-more-right", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      ro?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [levels]);

  useEffect(() => {
    let strip: HTMLElement | null | undefined = ref.current?.parentElement;
    if (levels === 2) strip = strip?.parentElement;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const active = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const left = active.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    strip.scrollTo({ left: centerScrollLeft(left, active.offsetWidth, strip.clientWidth) });
    strip.toggleAttribute("data-more-left", strip.scrollLeft > 2);
    strip.toggleAttribute("data-more-right", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
  }, [activeId, levels]);

  return <li ref={ref} hidden aria-hidden="true" />;
}
