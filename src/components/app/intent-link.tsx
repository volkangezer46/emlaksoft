"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import type { ComponentProps } from "react";
import { VIEWPORT_PREFETCH_BUDGET } from "@/lib/client-cache-policy";
import { prefetchFullNow, takeViewportBudget } from "@/lib/client-prefetch";

/**
 * IntentLink — niyet-tabanlı TAM önceden yüklemeli Link.
 *
 * 50 satırlık listede her satır linki görünür-alan prefetch'iyle 50 RSC isteği başlatır (sunucu + bant israfı).
 * Burada `prefetch={false}` ile Next'in otomatik görünür-alan prefetch'i kapatılır; yerine:
 *  - imleç satırın üstüne geldiğinde / odaklandığında / dokunulduğunda O rota TAM veriyle (full prefetch) yüklenir
 *    (tıklamadan ~100-300 ms önce; tıklamada ağ turu yok),
 *  - sayfadaki görünür ilk 5 detay bağlantısı görünür alana girince TAM önceden yüklenir (sayfa başına bütçe).
 * Aynı adres 30 sn içinde tekrar istenmez (bkz. `@/lib/client-prefetch`).
 */
export function IntentLink({
  href,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...rest
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const router = useRouter();
  const done = useRef(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const warm = useCallback(() => {
    if (done.current || typeof href !== "string") return;
    done.current = true;
    prefetchFullNow(router, href);
  }, [href, router]);
  const ref = useCallback(
    (el: HTMLAnchorElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || typeof href !== "string" || typeof IntersectionObserver === "undefined") return;
      const io = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (done.current) return;
        if (!takeViewportBudget(window.location.pathname + window.location.search, VIEWPORT_PREFETCH_BUDGET)) return;
        warm();
      });
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
    />
  );
}
