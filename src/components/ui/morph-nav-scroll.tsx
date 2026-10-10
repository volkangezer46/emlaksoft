"use client";

import { useEffect, useRef } from "react";
import { centerScrollLeft } from "@/lib/morph-tabs";

/**
 * Yatay kaydırılan sekme şeridinde ETKİN sekmeyi görünür alana ortalar (mobilde sağa taşan şeritte kullanıcı
 * nerede olduğunu kaybetmesin). Şeridin (`ul`) çocuğu olarak çizilir; kendisi görünmez. Şerit sığıyorsa dokunmaz.
 */
export function MorphNavScrollActive({ activeId }: { activeId: string | null }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const strip = ref.current?.parentElement;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const active = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    strip.scrollTo({ left: centerScrollLeft(active.offsetLeft, active.offsetWidth, strip.clientWidth) });
  }, [activeId]);
  return <li ref={ref} hidden aria-hidden="true" />;
}
