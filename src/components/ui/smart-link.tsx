"use client";

import NextLink from "next/link";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useContext } from "react";
import type { ComponentProps } from "react";
import { prefetchFullNow } from "@/lib/client-prefetch";

/**
 * Uygulama içi varsayılan bağlantı. Görünür-alan prefetch'i kapalıdır: /app ve /admin rotaları dinamik
 * olduğu için her otomatik prefetch tam bir sunucu render'ıydı (ana ekranda 8 sn'de 51 istek). Yalnız
 * niyet (hover / odak / dokunma / pointerdown) olunca o rota TAM veriyle (full prefetch) ısıtılır; `pointerdown`
 * tıklamadan ~80-150 ms önce gelir (dokunmatikte hover yok), böylece önyüklenmemiş hedef de ağ turunun bir kısmını
 * tıklamadan önce bitirir. Aynı adres tekrar süresi içinde bir kez istenir (`@/lib/client-prefetch`; önbellek
 * tazelenince sıfırlanır). Menü merkezlerinin ucuz rota ağacı önyüklemesi yan menünün boşta kuyruğundadır
 * (`useIdlePrefetch(..., { tier: "hubs" })`). `prefetch` açıkça verilirse aynen geçer.
 */
export default function SmartLink({
  prefetch,
  href,
  onMouseEnter,
  onFocus,
  onTouchStart,
  onPointerDown,
  ...rest
}: ComponentProps<typeof NextLink>) {
  // useRouter() yönlendirici dışında (test/sunucu önizleme) fırlatır; bağlam yoksa ısıtma sessizce atlanır.
  const router = useContext(AppRouterContext);
  if (prefetch !== undefined) {
    return (
      <NextLink
        {...rest}
        href={href}
        prefetch={prefetch}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
        onTouchStart={onTouchStart}
        onPointerDown={onPointerDown}
      />
    );
  }
  const warm = () => {
    if (typeof href !== "string" || !href.startsWith("/")) return;
    prefetchFullNow(router, href);
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
      onPointerDown={(e) => {
        if (e.button === 0) warm();
        onPointerDown?.(e);
      }}
    />
  );
}
