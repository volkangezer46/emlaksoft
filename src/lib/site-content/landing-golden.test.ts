import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLANS } from "@/lib/billing/plans";
import { defaultSiteContent } from "./defaults";

// next/font yükleyicisi yalnız Next derleyicisinde çalışır; golden render için sınıf adı yeterli.
vi.mock("next/font/google", () => ({
  Caveat: () => ({ className: "font-caveat", variable: "--font-hand", style: { fontFamily: "Caveat" } }),
}));

vi.mock("@/lib/billing/plan-definitions", async () => {
  const mod = await import("@/lib/billing/plans");
  return { getPublicPlanDefinitions: async () => mod.PLANS };
});

import { BentoGrid } from "@/components/marketing/bento/bento-grid";
import { Faq, buildHomeFaqs } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { HeroSection } from "@/components/marketing/hero/hero-section";
import { Highlights } from "@/components/marketing/highlights";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { ProductTour } from "@/components/marketing/product-tour/product-tour";
import { SecurityBand } from "@/components/marketing/security-band";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { ValueCards } from "@/components/marketing/value-cards";
import { Why } from "@/components/marketing/why";

async function html(el: ReactElement | Promise<ReactElement>): Promise<string> {
  return renderToStaticMarkup(await el);
}

describe("ana sayfa varsayılan çıktısı (bugünkü metin, birebir)", () => {
  for (const trialDays of [30, undefined]) {
    const tag = trialDays ? "deneme-var" : "deneme-yok";
    it(`senkron bölümler (${tag})`, async () => {
      // Eski çıktı karşılaştırması: sonradan eklenen EmlakFiyati hero satırı ve 3 yeni SSS çıkarılır (onlar ayrı testlerde).
      const base = defaultSiteContent();
      const faqs = buildHomeFaqs({ trialDays, plans: PLANS, content: base.faq.slice(0, 8) });
      const out = [
        await html(createElement(HeroSection, { trialDays, content: { ...base.hero, integrationBadge: "", integrationLine: "" } })),
        await html(createElement(ValueCards)),
        await html(createElement(TrustStrip, { trialDays })),
        await html(createElement(HowItWorks, { trialDays })),
        await html(createElement(SecurityBand)),
        await html(createElement(Faq, { items: faqs })),
        await html(createElement(FinalCta, { trialDays, plans: PLANS })),
      ].join("\n\n");
      await expect(out).toMatchFileSnapshot(`./__golden__/landing-sync-${tag}.html`);
    });
  }
  it("asenkron bölümler", async () => {
    const out = [await html(ProductTour()), await html(BentoGrid()), await html(Highlights()), await html(Why())].join("\n\n");
    await expect(out).toMatchFileSnapshot("./__golden__/landing-async.html");
  });
});
