"use client";

import { useCallback, useEffect, useRef } from "react";
import { now } from "@/lib/clock";

/**
 * Dokunma örtüsü (B032): mobil menü çekmecesi ve "+ Yeni" sayfası Radix Dialog gövdesidir; ilk bağlanışı (Portal,
 * odak tuzağı, kaydırma kilidi, menü ağacı) 4x CPU'da 212-720 ms sürüyordu ve bu sürede ekranda hiçbir şey olmuyordu.
 * Çözüm: önceden çizilmiş, `hidden` duran HAFİF bir örtü (karartma + panel silüeti) `pointerdown` ANINDA, React render'ı
 * olmadan (yalnız DOM özniteliği) görünür olur; Radix gövdesi tıklamadan sonra bağlanır ve bağlandığı karede örtü
 * kalkar (`onShown`). Örtü açıkken `<html data-tap-veil>`: Radix örtüsünün giriş animasyonu kapalıdır (motion.css),
 * böylece karartma iki kez belirmez; işaret diyalog kapanınca kalkar.
 */
export const TAP_VEIL_ATTR = "data-tap-veil";
/** Örtü bu süre içinde gerçek gövdeye devredilmezse (tıklama gelmedi / iptal) kendiliğinden kalkar. */
export const TAP_VEIL_TIMEOUT_MS = 1500;
/** Örtü bu kadar ms'den yeniyse ağır bağlama boyamadan sonraya bırakılır (pointerdown ile tık aynı karede gelebilir). */
const SAME_FRAME_MS = 32;
/** Çekmece kırılımı (Tailwind `lg` altı): masaüstünde örtü yok. */
const SMALL_SCREEN_QUERY = "(max-width: 1023.98px)";

export function clearTapVeilAttr(): void {
  if (typeof document !== "undefined") document.documentElement.removeAttribute(TAP_VEIL_ATTR);
}

/**
 * `ref`: örtü kabı (`hidden` başlar). `show`: pointerdown'da çağrılır. `hide`: gövde bağlandı / iptal.
 * `afterPaint(run)`: örtü henüz boyanmadıysa `run` bir sonraki boyamadan sonra çalışır (örtü ekrana önce gelsin).
 * `isOpen`: diyalog açık mı (zaman aşımında işaret yalnız diyalog açılmadıysa kalkar).
 */
export function useTapVeil(isOpen: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const shownAt = useRef<number | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(isOpen);
  useEffect(() => {
    openRef.current = isOpen;
  }, [isOpen]);

  const hide = useCallback(() => {
    if (safety.current) clearTimeout(safety.current);
    safety.current = null;
    shownAt.current = null;
    if (ref.current) ref.current.hidden = true;
  }, []);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el || openRef.current || !window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
    el.hidden = false;
    document.documentElement.setAttribute(TAP_VEIL_ATTR, "");
    shownAt.current = now();
    if (safety.current) clearTimeout(safety.current);
    safety.current = setTimeout(() => {
      hide();
      if (!openRef.current) clearTapVeilAttr();
    }, TAP_VEIL_TIMEOUT_MS);
  }, [hide]);

  const afterPaint = useCallback((run: () => void) => {
    const at = shownAt.current;
    if (at === null || now() - at > SAME_FRAME_MS) {
      run();
      return;
    }
    requestAnimationFrame(() => setTimeout(run, 0));
  }, []);

  useEffect(() => () => {
    if (safety.current) clearTimeout(safety.current);
  }, []);

  return { ref, show, hide, afterPaint };
}
