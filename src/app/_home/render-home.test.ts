import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Fragment, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Ağaç karşılaştırması: bileşenler çizilmez (sunucu/DB bağımlılıkları), yalnız üretilen öğe ağacı kıyaslanır.
vi.mock("@/components/site-header", () => ({ SiteHeader: function SiteHeader() { return null; } }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: function SiteFooter() { return null; } }));
vi.mock("next/font/google", () => ({
  Caveat: () => ({ className: "font-caveat", variable: "--font-hand", style: { fontFamily: "Caveat" } }),
}));

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSection } from "@/components/marketing/hero/hero-section";
import { ValueCards } from "@/components/marketing/value-cards";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { ProductTour } from "@/components/marketing/product-tour/product-tour";
import { BentoGrid } from "@/components/marketing/bento/bento-grid";
import { Why } from "@/components/marketing/why";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SecurityBand } from "@/components/marketing/security-band";
import { PricingSection } from "@/components/marketing/pricing-section";
import { Faq, buildHomeFaqs, faqForJsonLd } from "@/components/marketing/faq";
import { EmlakFiyatiSection } from "@/components/marketing/emlakfiyati-section";
import { Highlights } from "@/components/marketing/highlights";
import { ValuationSection } from "@/components/marketing/valuation-section";
import { FinalCta } from "@/components/marketing/final-cta";
import { LandingJsonLd } from "@/components/marketing/landing-jsonld";
import { MotionRoot } from "@/components/marketing/motion-root";
import { PLANS } from "@/lib/billing/plans";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import { parseEfTariff } from "@/lib/ef-credits/config";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { visibleSections, type SiteContent } from "@/lib/site-content/schema";
import { renderHome } from "./render-home";

const pricing = { plans: PLANS, trialDays: 30, efLive: false, efState: "soon" } as unknown as PublicPricing;
const efCatalog = { tariff: parseEfTariff(null), packs: [] };

/** React öğe ağacını karşılaştırılabilir düz yapıya çevirir (bileşen = adı; işlev prop'u = adı). */
function norm(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(norm);
  if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>;
    const type = typeof el.type === "string" ? el.type : el.type === Fragment ? "Fragment" : ((el.type as { name?: string }).name ?? "?");
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el.props)) props[k] = norm(v);
    return { type, key: el.key, props };
  }
  if (typeof node === "function") return `fn:${node.name}`;
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, norm(v)]));
  return node;
}

/** Asenkron sunucu bileşenleri createElement tiplerine uymaz; ağaç yalnız karşılaştırılır (çizilmez). */
const el = (type: unknown, props?: object | null, ...children: ReactNode[]) => createElement(type as never, props as never, ...children);

/**
 * ESKİ src/app/page.tsx gövdesinin birebir kopyası (çıkarma öncesi). renderHome aynı ağacı üretmeli: canlı ana sayfa
 * çıktısı değişmez (golden + statik ana sayfa bunun üstünde çalışır).
 */
function legacyHome(content: SiteContent, p: PublicPricing): ReactNode {
  const { trialDays, plans } = p;
  const faqs = buildHomeFaqs({ trialDays, plans, content: content.faq });
  const sections: Record<string, ReactNode> = {
    deger: el(ValueCards, { trialDays, plans, content: content.valueCards }),
    guven: el(TrustStrip, { trialDays, content: content.trust }),
    tur: el(ProductTour, { heading: content.sections.tur, items: content.tour }),
    ozellikler: el(BentoGrid, { heading: content.sections.ozellikler, content: content.bento }),
    degerleme: el(ValuationSection, { status: p.efLive ? "live" : "soon", state: p.efState, trialDays, plans, content: content.valuation }),
    emlakfiyati: el(EmlakFiyatiSection, { pricing: p, tariff: efCatalog.tariff, packs: efCatalog.packs, content: content.efSection }),
    diger: el(Highlights, { heading: content.sections.diger, content: content.highlights }),
    neden: el(Why, { heading: content.sections.neden, content: content.why }),
    nasil: el(HowItWorks, { trialDays, plans, steps: content.steps, heading: content.sections.nasil }),
    guvenlik: el(SecurityBand, { trialDays, plans, content: content.security, heading: content.sections.guvenlik }),
    fiyat: el(PricingSection, { pricing: p, heading: content.sections.fiyat }),
    sss: el(Faq, { items: faqs, heading: content.sections.sss }),
    son: el(FinalCta, { trialDays, plans, content: content.finalCta }),
  };
  const shown = visibleSections(content);
  return el(
    "div",
    { className: "mk" },
    null,
    el(LandingJsonLd, { faq: shown.includes("sss") ? faqForJsonLd(faqs) : [] }),
    el(MotionRoot),
    el(SiteHeader),
    el(
      "main",
      { id: "main-content" },
      el(HeroSection, { trialDays, plans, content: content.hero, efLive: p.efLive }),
      shown.map((id) => el(Fragment, { key: id }, sections[id])),
    ),
    el(SiteFooter, { smartCta: true, trialDays }),
  );
}

describe("renderHome: canlı ana sayfa ile birebir aynı ağaç", () => {
  it("varsayılan içerikte eski page.tsx gövdesiyle eşdeğer (yeni yorum bölümü varsayılan düzende gizli)", () => {
    const content = defaultSiteContent();
    expect(visibleSections(content)).not.toContain("testimonials");
    expect(norm(renderHome({ content, pricing, efCatalog }))).toEqual(norm(legacyHome(content, pricing)));
  });

  it("deneme günü bilinmezken ve bölüm sırası değişmişken de eşdeğer", () => {
    const content = structuredClone(defaultSiteContent());
    content.layout = [...content.layout].reverse().map((s, i) => ({ ...s, hidden: s.id === "testimonials" || i === 3 }));
    const p = { ...pricing, trialDays: undefined } as unknown as PublicPricing;
    expect(norm(renderHome({ content, pricing: p, efCatalog }))).toEqual(norm(legacyHome(content, p)));
  });

  it("önizleme: üstte TASLAK şeridi + yalnız yerinde düzenleme işaretleri; bölümler ve çerçeve aynı", () => {
    type Node = { type: string; key: string | null; props: Record<string, unknown> & { children: unknown } };
    const content = defaultSiteContent();
    const live = norm(renderHome({ content, pricing, efCatalog })) as { props: { children: unknown[] } };
    const draft = norm(renderHome({ content, pricing, efCatalog, preview: true })) as { props: { children: unknown[] } };
    expect(live.props.children[0]).toBeNull();
    expect(JSON.stringify(draft.props.children[0])).toContain("TASLAK ÖNİZLEME, yayında değil");
    // JSON-LD, MotionRoot, başlık ve altbilgi birebir aynı.
    for (const i of [1, 2, 3, 5]) expect(draft.props.children[i]).toEqual(live.props.children[i]);
    const [liveHero, liveSections] = (live.props.children[4] as Node).props.children as [Node, Node[]];
    const [draftHero, draftSections] = (draft.props.children[4] as Node).props.children as [Node, Node[]];
    // Hero: tek fark `cms: true` (metin düğümlerine data-cms-path).
    expect(draftHero.props).toEqual({ ...liveHero.props, cms: true });
    // Bölümler: aynı sırada, aynı içerik; önizlemede kutusuz (display: contents) data-cms-path sarmalayıcısında.
    expect(draftSections.map((s) => s.key)).toEqual(liveSections.map((s) => s.key));
    draftSections.forEach((s, i) => {
      expect(s.type).toBe("div");
      expect(s.props.style).toEqual({ display: "contents" });
      expect(typeof s.props["data-cms-path"]).toBe("string");
      expect(s.props.children).toEqual(liveSections[i]!.props.children);
    });
    expect(JSON.stringify(live)).not.toContain("data-cms-path");
  });

  it("page.tsx yalnız yayındaki içerikle renderHome çağırır (önizleme bayrağı yok, dinamik API yok)", () => {
    const page = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(page).toContain("getLiveSiteContent()");
    expect(page).toContain("renderHome({ content, pricing, efCatalog })");
    expect(page).not.toMatch(/preview|force-dynamic|searchParams|cookies\(|headers\(/);
  });
});
