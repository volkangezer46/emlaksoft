"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import type { ComponentProps } from "react";
import { runWhenIdle } from "@/lib/idle";
import { VIEWPORT_PREFETCH_BUDGET } from "@/lib/client-cache-policy";
import { prefetchFullNow, takeIdleRowBudget, takeViewportBudget } from "@/lib/client-prefetch";

/** Görünür alana bu kadar KALA ısıtılır (satırlar çoğu zaman ilk ekranın altında başlar; B047). */
export const INTENT_ROOT_MARGIN = "400px 0px";
/** Sayfadaki ilk N farklı detay adresi görünür alanı beklemeden boşta TAM önceden yüklenir. */
export const IDLE_FIRST_ROWS = 2;

/**
 * IntentLink — niyet-tabanlı TAM önceden yüklemeli Link.
 *
 * 50 satırlık listede her satır linki görünür-alan prefetch'iyle 50 RSC isteği başlatır (sunucu + bant israfı).
 * Burada `prefetch={false}` ile Next'in otomatik görünür-alan prefetch'i kapatılır; yerine:
 *  - sayfadaki ilk 2 farklı detay adresi boşta TAM önceden yüklenir (liste ilk ekranın altında başlasa da: canlıda ilk
 *    satır 951-977 px'teydi, görünür-alan yüklemesi hiç tetiklenmiyordu),
 *  - ilk 4 detay bağlantısı görünür alana 400 px kala TAM önceden yüklenir (sayfa başına bütçe),
 *  - imleç satırın üstüne geldiğinde / odaklandığında / dokunulduğunda / basıldığında (pointerdown) O rota TAM yüklenir.
 * Aynı adres tekrar süresi içinde bir kez istenir (bkz. `@/lib/client-prefetch`; önbellek tazelenince sıfırlanır).
 */
export function IntentLink({
  href,
  onMouseEnter,
  onFocus,
  onTouchStart,
  onPointerDown,
  ...rest
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const router = useRouter();
  const observer = useRef<IntersectionObserver | null>(null);
  /** Bu bağlantı bir kez ısıtıldı mı (görünür-alan bütçesi boşa harcanmasın; asıl tekilleştirme `prefetchFullNow`'da). */
  const warmed = useRef(false);
  const warm = useCallback(() => {
    if (typeof href !== "string") return;
    warmed.current = true;
    prefetchFullNow(router, href);
  }, [href, router]);

  // İlk satırlar: görünür alanı beklemeden, ilk boyamadan sonra boşta.
  useEffect(() => {
    if (typeof href !== "string") return;
    if (!takeIdleRowBudget(window.location.pathname + window.location.search, href, IDLE_FIRST_ROWS)) return;
    return runWhenIdle(warm);
  }, [href, warm]);

  const ref = useCallback(
    (el: HTMLAnchorElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || typeof href !== "string" || typeof IntersectionObserver === "undefined") return;
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          if (warmed.current) return;
          if (!takeViewportBudget(window.location.pathname + window.location.search, VIEWPORT_PREFETCH_BUDGET)) return;
          warm();
        },
        { rootMargin: INTENT_ROOT_MARGIN },
      );
      io.observe(el);
      observer.current = io;
    },
    [href, warm],
  );
  return (
    <Link
      {...rest}
      ref={ref}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      onPointerDown={(e) => {
        if (e.button === 0) warm();
        onPointerDown?.(e);
      }}
    />
  );
}
