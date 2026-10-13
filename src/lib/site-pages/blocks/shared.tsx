import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { isExternalHref } from "@/lib/site-menu/schema-core";
import type { PageLink } from "../schema-core";

/**
 * Blok bileşenlerinin ortak parçaları (sunucu bileşeni; istemci paketine girmez).
 * Düğme sınıfları /fiyatlar ile aynı tasarım tokenlarını kullanır; dış bağlantı yeni sekmede, rel=noopener ile açılır.
 */

const BASE = "inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2";

const TONES = {
  onDarkPrimary: `${BASE} bg-white text-[#071a38] hover:bg-white/90 focus-visible:outline-white`,
  onDarkSecondary: `${BASE} border border-white/40 text-white hover:bg-white/10 focus-visible:outline-white`,
  primary: `${BASE} bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600`,
  secondary: `${BASE} border border-line bg-surface text-ink-950 hover:border-brand-400 focus-visible:outline-brand-600`,
} as const;

export function BlockLink({ link, tone, arrow = false }: { link: PageLink; tone: keyof typeof TONES; arrow?: boolean }) {
  const inner = (
    <>
      {link.label}
      {arrow ? <ArrowRight aria-hidden className="ml-2 h-4 w-4" /> : null}
    </>
  );
  if (isExternalHref(link.href)) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={TONES[tone]}>
        {inner}
      </a>
    );
  }
  if (/^(mailto|tel):/i.test(link.href)) {
    return (
      <a href={link.href} className={TONES[tone]}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={link.href} className={TONES[tone]}>
      {inner}
    </Link>
  );
}

export function Container({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return <div className={`mx-auto ${narrow ? "max-w-3xl" : "max-w-6xl"} px-4 sm:px-6`}>{children}</div>;
}
