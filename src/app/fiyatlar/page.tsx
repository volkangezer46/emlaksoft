import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileSignature, ShieldAlert, Sparkles } from "lucide-react";
import { Pricing } from "@/components/pricing";
import { PLANS } from "@/lib/billing/plans";
import { buildFaq, lostCommissionPlanName, yearlyDiscountPercent } from "@/lib/pricing-page-model";
import { ComparisonTable } from "@/components/pricing-page/comparison-table";
import { PricingShell, Section } from "@/components/pricing-page/page-shell";
import { RoiCalculator } from "@/components/pricing-page/roi-calculator";

export const metadata: Metadata = {
  title: "Fiyatlar",
  description:
    "EmlakSoft paketleri, aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile özellik karşılaştırması. 14 gün ücretsiz deneme, kredi kartı gerekmez.",
  alternates: { canonical: "/fiyatlar" },
  openGraph: {
    title: "EmlakSoft Fiyatlar",
    description: "Açık fiyatlar, paket limitleri ve karşılaştırma tablosu. 14 gün ücretsiz deneme, kredi kartı gerekmez.",
    url: "/fiyatlar",
    type: "website",
  },
};

export default function FiyatlarPage() {
  const faq = buildFaq();
  const discount = yearlyDiscountPercent();
  const lost = lostCommissionPlanName();
  const roiPlans = PLANS.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry, seats: p.limits.seats }));
  const defaultPlanId = (PLANS.find((p) => p.popular) ?? PLANS[0]!).id;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <PricingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <div className="bg-[image:var(--grad-ink)]">
        <div className="theme-dark mx-auto max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <p className="text-sm font-bold uppercase tracking-[0.08em] text-mint-400">Fiyatlar</p>
          <h1 className="mx-auto mt-3 max-w-3xl font-display text-3xl font-extrabold text-white sm:text-5xl">
            Açık fiyat, paket paket net kapsam
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-white/80 sm:text-lg">
            Deneme boyunca tüm özellikler açık, kredi kartı gerekmez. Tutarlar KDV hariçtir; yıllık ödemede %{discount} indirim uygulanır.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={`/kayit?plan=${defaultPlanId}`}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-white px-5 text-sm font-semibold text-[#071a38] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              14 gün ücretsiz başla <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-white/40 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Canlı demo talep et
            </Link>
          </div>
        </div>
      </div>

      <section aria-label="Paketler" className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6">
        <Pricing />
      </section>

      <section aria-label="Bilmeniz gerekenler" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-3">
          <Note icon={<Sparkles aria-hidden className="h-5 w-5" />} title="Deneme boyunca her şey açık">
            14 gün ücretsiz deneme; tüm paketlerin özellikleri açıktır ve kredi kartı gerekmez.
          </Note>
          <Note icon={<FileSignature aria-hidden className="h-5 w-5" />} title="SMS onaylı dijital imza">
            Sözleşmeler SMS onayıyla imzalanır. Bu, nitelikli elektronik imza (e-imza) değildir.
          </Note>
          <Note icon={<ShieldAlert aria-hidden className="h-5 w-5" />} title="Kayıp-kaçak komisyon motoru">
            Yalnızca {lost} ve üzeri paketlerde açıktır.
          </Note>
        </ul>
      </section>

      <Section id="karsilastirma" title="Paketleri yan yana karşılaştırın" lead="Tablo, uygulamadaki gerçek paket kuralları ve sayfa kilitlerinden üretilir.">
        <ComparisonTable />
      </Section>

      <Section
        id="kacan-komisyon"
        title="Kaçan komisyonunuzu kendi sayılarınızla hesaplayın"
        lead="Girdiler sizindir; sektör ortalaması kullanılmaz. Alanlar bilerek boş bırakıldı."
      >
        <RoiCalculator plans={roiPlans} defaultPlanId={defaultPlanId} />
      </Section>

      <Section id="sss" title="Fiyatlarla ilgili sık sorulanlar">
        <div className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {faq.map((f) => (
            <details key={f.q} className="group px-5 py-1">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden className="text-xl leading-none text-brand-700 transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
              </summary>
              <p className="pb-4 text-text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-8 text-center sm:p-12">
          <div className="theme-dark">
            <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">Ofisinizle denemeye başlayın</h2>
            <p className="mx-auto mt-2 max-w-xl text-white/80">14 gün ücretsiz, kredi kartı gerekmez.</p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={`/kayit?plan=${defaultPlanId}`}
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-white px-5 text-sm font-semibold text-[#071a38] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Ücretsiz başla <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="/demo"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-white/40 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Demo talep et
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PricingShell>
  );
}

function Note({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface-2 p-4">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700">{icon}</span>
      <div>
        <h2 className="text-sm font-bold text-ink-950">{title}</h2>
        <p className="mt-1 text-sm text-text-muted">{children}</p>
      </div>
    </li>
  );
}
