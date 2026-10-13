import Link from "next/link";
import { getSupportContact } from "@/lib/contact-info-server";
import { legalEntityFields } from "@/lib/legal-entity";
import type { LegalDocSlug } from "@/lib/legal-docs/core";
import { readPublishedLegalDoc } from "@/lib/legal-docs/store";
import { LegalMarkupBody } from "@/components/legal-markup";
import { Brand } from "@/components/brand/brand";
import { PublicMeasure } from "@/components/public-measure/public-measure";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";

const trDate = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(iso));

/**
 * Ortak premium yasal sayfa düzeni — mevzuat sayfaları (KVKK, mesafeli satış,
 * çerez, iade...) tek tutarlı kurumsal şablondan çıkar.
 *
 * SÜRÜMLÜ İÇERİK (AD12): `slug` verilirse yayındaki DB sürümü (/admin/ayarlar/yasal, `legal_documents`) koddaki
 * `children` yerine çizilir (başlık, giriş, son güncelleme = yayın tarihi). Yayında sürüm yoksa ya da tablo/DB
 * okunamazsa koddaki metin (v1) aynen kalır. Destek e-postası ayar defterinden okunur (deploy gerekmez).
 */
export async function LegalPage({
  title,
  intro,
  updated = "25 Temmuz 2026",
  slug,
  children,
}: {
  title: string;
  intro: string;
  updated?: string;
  slug?: LegalDocSlug;
  children: React.ReactNode;
}) {
  const [contact, doc] = await Promise.all([getSupportContact(), slug ? readPublishedLegalDoc(slug) : null]);
  const entity = doc && doc.body.includes("{{sirket_kimligi}}") ? await legalEntityFields() : [];
  const shownTitle = doc?.title || title;
  const shownIntro = doc?.intro || intro;
  const shownUpdated = doc?.publishedAt ? trDate(doc.publishedAt) : updated;
  return (
    <main id="main-content" className="min-h-screen bg-canvas">
      {/* Kurumsal başlık bandı */}
      <section className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-25" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-600/30 blur-[90px]" />
        <div className="relative mx-auto max-w-3xl px-6 pb-12 pt-10">
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-white/70 transition hover:text-white">
              <ArrowLeft className="h-4 w-4" /> Ana sayfa
            </Link>
            <Link href="/" aria-label="EmlakSoft ana sayfa" className="inline-flex min-h-11 items-center"><Brand variant="horizontal" tone="dark" height={34} alt="" /></Link>
          </div>
          <span className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-cyan-300">
            <FileText className="h-3.5 w-3.5" /> Yasal metin
          </span>
          <h1 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl">{shownTitle}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/65">{shownIntro}</p>
          <p className="mt-4 text-xs text-white/45">Son güncelleme: {shownUpdated}</p>
        </div>
      </section>

      {/* Gövde */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <article className="legal-body space-y-8" data-legal-version={doc ? doc.version : 1}>
          {doc ? <LegalMarkupBody body={doc.body} contact={contact} entity={entity} /> : children}
        </article>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600"><ShieldCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-bold text-ink-950">Sorunuz mu var?</p>
              <p className="text-xs text-text-muted">Yasal metinlerle ilgili tüm sorularınız için bize yazın.</p>
            </div>
          </div>
          <a href={contact.mailto} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
            {contact.email}
          </a>
        </div>

        <nav aria-label="Yasal sayfalar" className="mt-8 flex flex-wrap gap-x-5 text-xs text-text-muted">
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/kullanim-sartlari">Kullanım Şartları</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/gizlilik">Gizlilik Politikası</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/kvkk-aydinlatma">KVKK Aydınlatma</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/cerez-politikasi">Çerez Politikası</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/on-bilgilendirme">Ön Bilgilendirme Formu</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/iptal-iade">İptal &amp; İade</Link>
          <Link className="inline-flex min-h-11 items-center hover:text-brand-600" href="/davet-kosullari">Davet Koşulları</Link>
        </nav>
      </section>
      {/* Birinci taraf ölçüm etiketi (S6). Bu düzen yalnız herkese açık yasal sayfalarda kullanılır; statik sürümde de
          korunur (data-static-keep). */}
      <PublicMeasure />
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
