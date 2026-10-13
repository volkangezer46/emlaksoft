import Link from "next/link";
import { ArrowRight, FileSignature, ShieldAlert, Sparkles } from "lucide-react";
import { Pricing } from "@/components/pricing";
import { SeoJsonLd } from "@/components/seo/seo-json-ld";
import type { PlanDef } from "@/lib/billing/plans";
import type { PublicOffer } from "@/lib/billing/public-pricing";
import { extraSeatTexts } from "@/lib/billing/seat-calculator-model";
import { ComparisonTable } from "@/components/pricing-page/comparison-table";
import { PricingShell, Section } from "@/components/pricing-page/page-shell";
import { RoiCalculator } from "@/components/pricing-page/roi-calculator";
import { EfPackTiersTable, EfPlanCreditsTable, EF_PACKS_APP_HREF } from "@/components/marketing/emlakfiyati-section";
import type { getEfCatalog } from "@/lib/ef-credits/credit-reader";
import { SeatCalculatorLazy } from "@/components/pricing-page/seat-calculator-lazy";
import type { PricingCopy } from "./copy";

/**
 * /fiyatlar görünümü (sunucu bileşeni). Herkese açık sayfa ve personel önizlemesi (/admin/site/sayfalar/fiyatlar/onizleme)
 * AYNI bileşeni kullanır. Metinler `copy`'den (yayın yoksa bugünkü varsayılan), fiyat/limit/kapsam yalnız paket
 * tanımlarından gelir. Değişkenli metinler parça listesidir: eski JSX ile aynı metin düğümleri (HTML birebir).
 */

export type PricingViewData = {
  plans: PlanDef[];
  trialDays?: number;
  offers: Record<string, PublicOffer>;
  founders: { name: string; remaining: number; quota: number } | null;
  efValuationCost: number;
  efLive: boolean;
  efCatalog: Awaited<ReturnType<typeof getEfCatalog>>;
};

/** Tek parçalı metin düz dizgi olarak basılır (eski `{değer}` ile aynı düğüm); çok parçalı metin parça listesi. */
const parts = (p: string[]) => (p.length === 1 ? p[0] : p);

export function PricingPageView({ data, copy, jsonLd = true }: { data: PricingViewData; copy: PricingCopy; jsonLd?: boolean }) {
  const { plans, trialDays, offers, founders, efValuationCost, efLive, efCatalog } = data;
  const faq = copy.faq;
  // ROI hesaplayıcı etkin fiyatı (kampanya dahil) seat-pricing motorundan alır.
  const roiPlans = plans;
  const defaultPlanId = (roiPlans.find((p) => p.popular) ?? roiPlans[0] ?? plans[0]!).id;

  return (
    <PricingShell>
      {jsonLd ? <SeoJsonLd path="/fiyatlar" faq={faq} /> : null}

      <div className="bg-[image:var(--grad-ink)]">
        <div className="theme-dark mx-auto max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <p className="text-sm font-bold uppercase tracking-[0.08em] text-mint-400">{copy.hero.eyebrow}</p>
          <h1 className="mx-auto mt-3 max-w-3xl font-display text-3xl font-extrabold text-white sm:text-5xl">
            {copy.hero.title}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-white/80 sm:text-lg">
            {parts(copy.hero.lead)}
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={`/kayit?plan=${defaultPlanId}`}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-white px-5 text-sm font-semibold text-[#071a38] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {parts(copy.ctaPrimaryLabel)} <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="#karsilastirma"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-white/40 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {copy.compareLabel}
            </Link>
          </div>
        </div>
      </div>

      <h2 className="sr-only">Paketler ve ekip hesaplayıcı</h2>
      <section aria-label="Ekibinize göre paket hesaplayıcı" className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
        <SeatCalculatorLazy plans={plans} offers={offers} trialDays={trialDays} />
      </section>

      <section aria-label="Paketler" className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6">
        <Pricing plans={plans} trialDays={trialDays} offers={offers} founders={founders} extraSeats={extraSeatTexts(plans)} efValuationCost={efValuationCost} efLive={efLive} />
      </section>

      <section aria-label="Bilmeniz gerekenler" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-3">
          <Note icon={<Sparkles aria-hidden className="h-5 w-5" />} title={copy.notes[0]!.title}>
            {parts(copy.notes[0]!.text)}
          </Note>
          <Note icon={<FileSignature aria-hidden className="h-5 w-5" />} title={copy.notes[1]!.title}>
            {parts(copy.notes[1]!.text)}
          </Note>
          <Note icon={<ShieldAlert aria-hidden className="h-5 w-5" />} title={copy.notes[2]!.title}>
            {parts(copy.notes[2]!.text)}
          </Note>
        </ul>
      </section>

      <Section id="karsilastirma" title={copy.sections.compare.title} lead={copy.sections.compare.lead}>
        <ComparisonTable plans={plans} efValuationCost={efValuationCost} efLive={efLive} />
      </Section>
      <Section id="analiz" title={copy.sections.analiz.title} lead={efLive ? copy.efText.leadLive : copy.efText.leadPlanned}>
        <EfPlanCreditsTable plans={plans} tariff={efCatalog.tariff} live={efLive} />
        <p className="mt-2 text-xs text-text-muted">{copy.efText.creditsNote}</p>
        <div className="mt-6">
          <EfPackTiersTable packs={efCatalog.packs} tariff={efCatalog.tariff} live={efLive} />
          <p className="mt-2 text-xs text-text-muted">{copy.efText.packsNote}</p>
          {efLive ? (
            <p className="mt-2 text-sm">
              <Link href={EF_PACKS_APP_HREF} className="font-semibold text-brand-700 hover:underline">Ofis panelinde analiz bakiyesi satın al</Link>
              <span className="text-text-muted"> · Hesabınız yoksa önce <Link href="/kayit" className="font-semibold text-brand-700 hover:underline">denemeyi başlatın</Link>.</span>
            </p>
          ) : null}
        </div>
      </Section>

      <Section id="kacan-komisyon" title={copy.sections.roi.title} lead={copy.sections.roi.lead}>
        <RoiCalculator plans={roiPlans} offers={offers} defaultPlanId={defaultPlanId} />
      </Section>

      <Section id="sss" title={copy.sections.faq.title}>
        <div className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {faq.map((f) => (
            <details key={f.q} className="motion-details group px-5 py-1">
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
            <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">{copy.sections.final.title}</h2>
            <p className="mx-auto mt-2 max-w-xl text-white/80">{parts(copy.sections.final.text)}</p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={`/kayit?plan=${defaultPlanId}`}
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-white px-5 text-sm font-semibold text-[#071a38] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {`${copy.sections.final.primaryLabel} `}<ArrowRight aria-hidden className="ml-2 h-4 w-4" />
              </Link>
              <Link
                href="#karsilastirma"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-white/40 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {copy.compareLabel}
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
