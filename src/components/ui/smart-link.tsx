"use client";

import NextLink from "next/link";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useContext, useRef } from "react";
import type { ComponentProps } from "react";

/**
 * Uygulama içi varsayılan bağlantı. Görünür-alan prefetch'i kapalıdır: /app ve /admin rotaları dinamik
 * olduğu için her otomatik prefetch tam bir sunucu render'ıydı (ana ekranda 8 sn'de 51 istek). Yalnız
 * niyet (hover / odak / dokunma) olunca o rota bir kez ısıtılır. `prefetch` açıkça verilirse aynen geçer.
 */
export default function SmartLink({
  prefetch,
  href,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...rest
}: ComponentProps<typeof NextLink>) {
  // useRouter() yönlendirici dışında (test/sunucu önizleme) fırlatır; bağlam yoksa ısıtma sessizce atlanır.
  const router = useContext(AppRouterContext);
  const warmed = useRef(false);
  if (prefetch !== undefined) {
    return <NextLink {...rest} href={href} prefetch={prefetch} onMouseEnter={onMouseEnter} onFocus={onFocus} onTouchStart={onTouchStart} />;
  }
  const warm = () => {
    if (warmed.current || typeof href !== "string" || !href.startsWith("/")) return;
    warmed.current = true;
    router?.prefetch(href);
  };
  return (
    <NextLink
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
