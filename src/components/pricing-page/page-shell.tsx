import Link from "next/link";
import type { ReactNode } from "react";

/**
 * /fiyatlar için sade üst bar ve alt bilgi (sunucu bileşeni, istemci JS yok).
 * Ana sayfanın başlığı sayfa-içi bağlantılar kullandığından burada kullanılmaz.
 */
export function PricingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface text-text">
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink-950 focus:shadow-[var(--shadow-md)]"
      >
        İçeriğe geç
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="EmlakSoft ana sayfa" className="font-display text-lg font-extrabold text-ink-950">
            EmlakSoft
          </Link>
          <nav aria-label="Fiyat sayfası" className="flex items-center gap-1 text-sm font-semibold">
            <Link href="/giris" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-ink-950 hover:bg-surface-2">
              Giriş
            </Link>
            <Link
              href="/demo"
              className="hidden min-h-11 items-center rounded-[var(--radius-control)] px-3 text-ink-950 hover:bg-surface-2 sm:inline-flex"
            >
              Demo talep et
            </Link>
          </nav>
        </div>
      </header>
      <main id="icerik">{children}</main>
      <footer className="border-t border-line bg-surface-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-text-muted sm:px-6">
          <p>© EmlakSoft</p>
          <nav aria-label="Alt bilgi" className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/" className="inline-flex min-h-11 items-center hover:text-ink-950 hover:underline">Ana sayfa</Link>
            <Link href="/gizlilik" className="inline-flex min-h-11 items-center hover:text-ink-950 hover:underline">Gizlilik</Link>
            <Link href="/kullanim-sartlari" className="inline-flex min-h-11 items-center hover:text-ink-950 hover:underline">Kullanım şartları</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-baslik`} className="mx-auto max-w-6xl scroll-mt-6 px-4 py-12 sm:px-6 sm:py-16">
      <h2 id={`${id}-baslik`} className="font-display text-2xl font-extrabold text-ink-950 sm:text-3xl">
        {title}
      </h2>
      {lead ? <p className="mt-2 max-w-2xl text-text-muted">{lead}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}
