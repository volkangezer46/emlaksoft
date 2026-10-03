"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { ComponentProps } from "react";

/**
 * IntentLink — niyet-tabanlı prefetch'li Link.
 *
 * 50 satırlık listede her satır linki görünür-alan prefetch'iyle 50 RSC isteği
 * başlatır (sunucu + bant israfı). Burada `prefetch={false}` ile görünür-alan
 * prefetch'i kapatılır; imleç satırın üstüne geldiğinde / odaklandığında /
 * dokunulduğunda (tıklamadan ~100-300ms önce) yalnız O rota ısıtılır ve satır
 * başına bir kez tetiklenir. Tıklama anında iskelet zaten önbellekten gelir.
 * Üretim dışında Next prefetch'i zaten kapalıdır; çağrı zararsızdır.
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
  const warm = () => {
    if (done.current || typeof href !== "string") return;
    done.current = true;
    router.prefetch(href);
  };
  return (
    <Link
      {...rest}
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
