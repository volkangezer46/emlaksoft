import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "@/app/marketing.css";
import "@/app/marketing-sections.css";

/** /araclar için ortak üst menü + alt bilgi (ana sayfayla aynı SiteHeader/SiteFooter). Her zaman açık tema. */
export function ToolsShell({ children }: { children: ReactNode }) {
  return (
    <div className="mk bg-surface text-text">
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink-950 focus:shadow-[var(--shadow-md)]"
      >
        İçeriğe geç
      </a>
      <SiteHeader />
      <main id="icerik">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Sayfa sonu CTA: kaynak parametresi yalnız bağlantıdır (yakalama ayrı pakettedir). */
export function ToolsCta({ slug }: { slug: string }) {
  return (
    <section aria-labelledby="arac-cta" className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
      <div className="rounded-[var(--radius-panel)] border border-line bg-surface-2 p-6 text-center sm:p-10">
        <h2 id="arac-cta" className="font-display text-2xl font-extrabold text-ink-950 sm:text-3xl">
          Bunların hepsi Emlaksoft&apos;ta otomatik
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-text-muted">
          Komisyon, masraf ve ödeme takibi müşteri, portföy ve anlaşma kayıtlarınızla birlikte tek panelde hesaplanır. 14 gün ücretsiz deneyin; kredi kartı gerekmez.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={`/kayit?kaynak=arac-${slug}`}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            14 gün ücretsiz başla <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
          </Link>
          <Link
            href="/demo"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line-strong px-5 text-sm font-semibold text-ink-950 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Canlı demo talep et
          </Link>
        </div>
      </div>
    </section>
  );
}
