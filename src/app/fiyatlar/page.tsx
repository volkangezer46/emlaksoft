import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import { pricingCopy } from "@/lib/pricing-page/copy";
import { copyContextOf, loadPricingViewData } from "@/lib/pricing-page/data";
import { defaultPricingPage } from "@/lib/pricing-page/defaults";
import { getLivePricingPage } from "@/lib/pricing-page/store";
import { PricingPageView } from "@/lib/pricing-page/view";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/fiyatlar");
}

/**
 * /fiyatlar. Fiyat, limit ve paket kapsamı plan editöründen (plans.ts tanımları + /admin/billing/planlar) gelir;
 * sayfa METİNLERİ /admin/site/sayfalar/fiyatlar'dan yayınlanır. Hiç yayın yokken bugünkü metinler (defaults.ts) ve
 * kod içi SSS (buildFaq) kullanılır: çıktı eskisiyle birebir aynıdır. Görünüm: src/lib/pricing-page/view.tsx.
 */
export default async function FiyatlarPage() {
  const [data, live] = await Promise.all([loadPricingViewData(), getLivePricingPage()]);
  const copy = pricingCopy(live ?? defaultPricingPage(), copyContextOf(data), { faqFromCode: !live });
  return <PricingPageView data={data} copy={copy} measurePath="/fiyatlar" />;
}

