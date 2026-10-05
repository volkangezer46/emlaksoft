import type { ReactNode } from "react";
import Link from "next/link";
import { Em } from "./section-heading";

/** Ana sayfa bölüm bağlantısı `/#nasil` sayfa içinde `#nasil` olarak çizilir (bugünkü davranış). */
export function homeHref(href: string): string {
  return href.startsWith("/#") ? href.slice(1) : href;
}

/**
 * Düzenlenebilir içerikteki bağlantı: site yolu -> Link, http(s) -> yeni sekme + noopener, mailto/tel -> düz bağlantı.
 * Adresler yayın öncesi `checkHref` ile doğrulanmıştır (javascript: vb. kaydedilemez); burada ikinci güvence olarak
 * tanınmayan biçimler "#" olur.
 */
export function ContentLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const h = href.trim();
  if (h.startsWith("/#")) return <a href={homeHref(h)} className={className}>{children}</a>;
  if (h.startsWith("/") && !h.startsWith("//")) return <Link href={h} className={className}>{children}</Link>;
  if (/^https?:\/\//i.test(h)) return <a href={h} className={className} target="_blank" rel="noopener noreferrer">{children}</a>;
  if (/^(mailto|tel):/i.test(h)) return <a href={h} className={className}>{children}</a>;
  return <a href="#" className={className}>{children}</a>;
}

/** Başlık: `başlık <Em>vurgu</Em> son` (boş parçalar atlanır). */
export function RichTitle({ title, em, tail }: { title: string; em: string; tail: string }) {
  return (
    <>
      {title ? `${title} ` : null}
      {em ? <Em>{em}</Em> : null}
      {tail ? ` ${tail}` : null}
    </>
  );
}

/** Satır sonu içeren düz metin: satırlar <br /> ile ayrılır (başka biçim yok). */
export function Lines({ text }: { text: string }) {
  if (!text.includes("\n")) return <>{text}</>;
  const parts = text.split(/\r?\n/);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}
