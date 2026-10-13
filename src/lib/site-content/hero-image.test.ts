import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Caveat: () => ({ className: "font-caveat", variable: "--font-hand", style: { fontFamily: "Caveat" } }),
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: function SiteHeader() { return null; } }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: function SiteFooter() { return null; } }));

import { HeroSection } from "@/components/marketing/hero/hero-section";
import { renderHome } from "@/app/_home/render-home";
import { PLANS } from "@/lib/billing/plans";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import { parseEfTariff } from "@/lib/ef-credits/config";
import { stripNextRuntime } from "@/lib/static-home/transform";
import { defaultSiteContent } from "./defaults";
import { isCmsPath, validateSiteContent, type SiteContent } from "./schema";

const MEDIA = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const withImage = (image: unknown): unknown => {
  const c = structuredClone(defaultSiteContent()) as unknown as { hero: Record<string, unknown> };
  c.hero.image = image;
  return c;
};
const errorsAt = (input: unknown, path: string, opts?: Parameters<typeof validateSiteContent>[1]) =>
  validateSiteContent(input, opts).issues.filter((i) => i.level === "error" && i.path.startsWith(path));

describe("şema: hero.image yalnız medya kimliği", () => {
  it("serbest URL içeren görsel reddedilir", () => {
    expect(errorsAt(withImage({ mediaId: "https://kotu.example/x.png" }), "hero.image").length).toBeGreaterThan(0);
    expect(errorsAt(withImage({ url: "https://kotu.example/x.png" }), "hero.image").length).toBeGreaterThan(0);
    expect(errorsAt(withImage({ mediaId: MEDIA, src: "/x.png" }), "hero.image").length).toBeGreaterThan(0);
    expect(errorsAt(withImage("/medya/x.png"), "hero.image").length).toBeGreaterThan(0);
  });

  it("olmayan mediaId doğrulamada hata verir; var olan geçer; görsel yoksa kütüphane sorulmaz", () => {
    expect(errorsAt(withImage({ mediaId: MEDIA }), "hero.image", { mediaIds: new Set() })[0]?.message).toMatch(/kütüphanesinde yok/);
    expect(errorsAt(withImage({ mediaId: MEDIA }), "hero.image", { mediaIds: new Set([MEDIA]) })).toEqual([]);
    expect(validateSiteContent(defaultSiteContent(), { mediaIds: new Set() }).issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("hero görselinde alt metin boş olamaz (alan verilmişse); verilmezse kütüphanedeki kullanılır", () => {
    expect(errorsAt(withImage({ mediaId: MEDIA, alt: "  " }), "hero.image.alt")[0]?.message).toMatch(/alt metin boş olamaz/i);
    expect(errorsAt(withImage({ mediaId: MEDIA, alt: "<script>" }), "hero.image.alt").length).toBe(1);
    expect(errorsAt(withImage({ mediaId: MEDIA, alt: "Ofis" }), "hero.image")).toEqual([]);
  });
});

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("hero görseli ve yerinde düzenleme işaretleri (golden)", () => {
  const base = defaultSiteContent().hero;

  it("görsel boşken HeroSection çıktısı birebir aynı (image/cms verilmeyen eski çağrıyla)", () => {
    const legacy = html(createElement(HeroSection, { trialDays: 30, plans: PLANS, content: base }));
    expect(html(createElement(HeroSection, { trialDays: 30, plans: PLANS, content: { ...base, image: undefined }, cms: false }))).toBe(legacy);
    expect(legacy).not.toContain("<picture");
    expect(legacy).toContain("mk-scene");
  });

  it("canlı ve statik HTML'de data-cms-path yok; önizleme HTML'inde var ve hepsi izin listesinde", () => {
    const live = html(createElement(HeroSection, { trialDays: 30, plans: PLANS, content: base }));
    expect(live).not.toContain("data-cms-path");
    expect(stripNextRuntime(`<!doctype html><html><head></head><body>${live}</body></html>`).html).not.toContain("data-cms-path");
    const preview = html(createElement(HeroSection, { trialDays: 30, plans: PLANS, content: base, cms: true }));
    const paths = [...preview.matchAll(/data-cms-path="([^"]+)"/g)].map((m) => m[1]!);
    expect(paths).toEqual(expect.arrayContaining(["hero.badge", "hero.title", "hero.lead", "hero.primary.label", "hero.secondary.label", "hero.checks.0.text"]));
    for (const p of paths) expect(isCmsPath(p), p).toBe(true);
  });

  it("image verilirse sahnenin yerine onun çıktısı gelir (yedek sahne argüman olarak verilir)", () => {
    const out = html(createElement(HeroSection, { trialDays: 30, content: base, image: (scene) => createElement("figure", { "data-test": "img" }, scene ? "yedek-var" : "yok") }));
    expect(out).toContain('<figure data-test="img">yedek-var</figure>');
    expect(out).not.toContain("mk-scene");
  });

  it("renderHome: canlı ağaçta data-cms-path yok, önizleme ağacında bölüm ve hero işaretleri var", () => {
    const pricing = { plans: PLANS, trialDays: 30, efLive: false, efState: "soon" } as unknown as PublicPricing;
    const efCatalog = { tariff: parseEfTariff(null), packs: [] };
    const content: SiteContent = defaultSiteContent();
    const flat = (node: unknown): string =>
      JSON.stringify(node, (_k, v) => (isValidElement(v) ? { t: typeof v.type === "string" ? v.type : "C", p: v.props } : typeof v === "function" ? undefined : v));
    expect(flat(renderHome({ content, pricing, efCatalog }))).not.toContain("data-cms-path");
    const draft = flat(renderHome({ content, pricing, efCatalog, preview: true }));
    expect(draft).toContain('"data-cms-path":"faq"');
    expect(draft).toContain('"cms":true');
    for (const m of draft.matchAll(/"data-cms-path":"([^"]+)"/g)) expect(isCmsPath(m[1]), m[1]).toBe(true);
  });
});
