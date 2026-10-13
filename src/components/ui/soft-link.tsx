"use client";

import { useRouter } from "next/navigation";
import { startTransition, type ComponentProps, type MouseEvent } from "react";

/**
 * Kök hata / 404 sınırları için `next/link` yerine hafif bağlantı: aynı `<a href>` işaretlemesi, sol tıkta istemci
 * gezinmesi (`router.push`, `next/link` gibi değiştirici tuş / yeni sekme / indirme / dış adres tarayıcıya kalır),
 * niyet (hover / dokunma) anında önceden yükleme. NEDEN: kök `error.tsx` ve `not-found.tsx` her rotanın ilk yük
 * paketine girer ve her biri `next/link`in kendi kopyasını taşıyordu (~3 KB gzip × 2); `next/navigation` zaten
 * çekirdek pakettedir.
 */
export function SoftLink({ href, onClick, onMouseEnter, onTouchStart, ...rest }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  const router = useRouter();
  const local = href.startsWith("/") && !href.startsWith("//");
  const warm = () => {
    if (local) router.prefetch(href);
  };
  const navigate = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || !local) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.currentTarget.getAttribute("target");
    if ((target && target !== "_self") || e.currentTarget.hasAttribute("download")) return;
    e.preventDefault();
    startTransition(() => router.push(href));
  };
  return (
    <a
      {...rest}
      href={href}
      onClick={navigate}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
    />
  );
}
