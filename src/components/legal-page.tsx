import Link from "next/link";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";

/**
 * Ortak premium yasal sayfa düzeni — mevzuat sayfaları (KVKK, mesafeli satış,
 * çerez, iade...) tek tutarlı kurumsal şablondan çıkar.
 */
export function LegalPage({
  title,
  intro,
  updated = "25 Temmuz 2026",
  children,
}: {
  title: string;
  intro: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-canvas">
      {/* Kurumsal başlık bandı */}
      <section className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-25" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-600/30 blur-[90px]" />
        <div className="relative mx-auto max-w-3xl px-6 pb-12 pt-10">
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Ana sayfa
            </Link>
            <Link href="/" className="font-display text-lg font-extrabold text-white">EmlakSoft</Link>
          </div>
          <span className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-300">
            <FileText className="h-3.5 w-3.5" /> Yasal metin
          </span>
          <h1 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/65">{intro}</p>
          <p className="mt-4 text-xs text-white/45">Son güncelleme: {updated}</p>
        </div>
      </section>

      {/* Gövde */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <article className="legal-body space-y-8">{children}</article>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-line bg-surface p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600"><ShieldCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-bold text-ink-950">Sorunuz mu var?</p>
              <p className="text-xs text-text-muted">Yasal metinlerle ilgili tüm sorularınız için bize yazın.</p>
            </div>
          </div>
          <a href="mailto:destek@emlaksoft.app" className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
            destek@emlaksoft.app
          </a>
        </div>

        <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-muted">
          <Link className="hover:text-brand-600" href="/kullanim-sartlari">Kullanım Şartları</Link>
          <Link className="hover:text-brand-600" href="/gizlilik">Gizlilik Politikası</Link>
          <Link className="hover:text-brand-600" href="/kvkk-aydinlatma">KVKK Aydınlatma</Link>
          <Link className="hover:text-brand-600" href="/cerez-politikasi">Çerez Politikası</Link>
          <Link className="hover:text-brand-600" href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</Link>
          <Link className="hover:text-brand-600" href="/on-bilgilendirme">Ön Bilgilendirme Formu</Link>
          <Link className="hover:text-brand-600" href="/iptal-iade">İptal &amp; İade</Link>
        </nav>
      </section>
    </main>
  );
}

/** Numaralı bölüm başlığı + içerik */
export function LegalSection({ no, title, children }: { no?: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="flex items-baseline gap-2.5 font-display text-lg font-bold text-ink-950">
        {no ? <span className="text-sm font-extrabold text-brand-600">{no}</span> : null}
        {title}
      </h2>
      <div className="mt-2.5 space-y-3 text-sm leading-relaxed text-ink-800">{children}</div>
    </section>
  );
}
