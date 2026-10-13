import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Statik ana sayfa adacıklarında `next/link` karşılığı: düz bağlantı (tam sayfa gezinme; önceden yükleme yok). */
export default function Link({
  href,
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; prefetch?: boolean | null; replace?: boolean; scroll?: boolean; children?: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
