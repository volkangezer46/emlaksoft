import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/billing/plans";
import { FAQS } from "@/components/marketing/faq";
import {
  breadcrumbLd,
  buildPageJsonLd,
  extractJsonLdBlocks,
  faqLd,
  organizationLd,
  serializeJsonLd,
  softwareApplicationLd,
  validateJsonLd,
  webSiteLd,
} from "./jsonld";
import { DEFAULT_SEO_GLOBAL, mergeGlobal, type SeoRedirectRule } from "./schema";
import { analyzeRedirects, buildRedirectMap, normalizeRedirectPath, resolveRedirect, validateNewRule } from "./redirects";

const BASE = "https://emlaksoft.vercel.app";
const plans = PLANS.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry }));

describe("JSON-LD üretimi", () => {
  it("ana sayfa grafiği geçerli: Organization, WebSite, SoftwareApplication, FAQPage", () => {
    const graph = buildPageJsonLd({
      global: DEFAULT_SEO_GLOBAL,
      base: BASE,
      path: "/",
      plans,
      faq: FAQS,
      kinds: ["Organization", "WebSite", "SoftwareApplication", "FAQPage"],
    });
    expect(graph).not.toBeNull();
    expect(validateJsonLd(graph)).toEqual([]);
    const types = ((graph as { "@graph": { "@type": string }[] })["@graph"]).map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "SoftwareApplication", "FAQPage"]);
  });
  it("SoftwareApplication teklifleri plans.ts'teki gerçek KDV hariç aylık fiyatlardır", () => {
    const node = softwareApplicationLd(DEFAULT_SEO_GLOBAL, BASE, plans) as { offers: { price: string; priceSpecification: { valueAddedTaxIncluded: boolean } }[] };
    expect(node.offers.map((o) => Number(o.price))).toEqual(PLANS.map((p) => p.monthlyTry));
    expect(node.offers.every((o) => o.priceSpecification.valueAddedTaxIncluded === false)).toBe(true);
  });
  it("FAQPage görünen SSS ile birebir (soru ve cevap sayısı ve metni)", () => {
    const node = faqLd(FAQS) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(node.mainEntity).toHaveLength(FAQS.length);
    FAQS.forEach((f, i) => {
      expect(node.mainEntity[i]?.name).toBe(f.q);
      expect(node.mainEntity[i]?.acceptedAnswer.text).toBe(f.a);
    });
    expect(faqLd([])).toBeNull();
  });
  it("Organization: boş iletişim/logo/sameAs hiç basılmaz; girilen doğrulanabilir bilgi basılır", () => {
    const empty = organizationLd(DEFAULT_SEO_GLOBAL, BASE);
    expect(empty).not.toHaveProperty("contactPoint");
    expect(empty).not.toHaveProperty("sameAs");
    expect(empty).not.toHaveProperty("logo");
    const full = organizationLd(mergeGlobal({ organization: { email: "destek@emlaksoft.com", logo: "/logo.png", sameAs: ["https://www.linkedin.com/company/emlaksoft"] } }), BASE);
    expect(full).toMatchObject({ logo: `${BASE}/logo.png`, sameAs: ["https://www.linkedin.com/company/emlaksoft"], contactPoint: { email: "destek@emlaksoft.com" } });
  });
  it("WebSite'a çalışan arama olmadığı için SearchAction eklenmez", () => {
    expect(JSON.stringify(webSiteLd(DEFAULT_SEO_GLOBAL, BASE))).not.toContain("SearchAction");
  });
  it("BreadcrumbList: ana sayfa yok, iç sayfa 2+ öğe ve mutlak adres", () => {
    expect(breadcrumbLd("/", BASE)).toBeNull();
    const b = breadcrumbLd("/araclar/komisyon-hesaplama", BASE) as { itemListElement: { name: string; item: string; position: number }[] };
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(b.itemListElement[0]?.item).toBe(BASE);
    expect(b.itemListElement[1]?.item).toBe(`${BASE}/araclar`);
  });
  it("çıktı '<' '>' '&' kaçışlıdır (script kırılması / XSS yok)", () => {
    const s = serializeJsonLd({ name: "</script><script>alert(1)</script> & x" });
    expect(s).not.toContain("<");
    expect(s).not.toContain(">");
    expect(s).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(s).name).toBe("</script><script>alert(1)</script> & x");
  });
});

describe("JSON-LD doğrulayıcı", () => {
  it("zorunlu alan eksikliklerini bulur", () => {
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "Organization" })).toEqual(expect.arrayContaining([expect.stringContaining("'name'"), expect.stringContaining("'url'")]));
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "x", applicationCategory: "B", operatingSystem: "Web" })).toEqual(
      expect.arrayContaining([expect.stringContaining("offers")]),
    );
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "s" }] })).toEqual(
      expect.arrayContaining([expect.stringContaining("acceptedAnswer")]),
    );
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ position: 1, name: "a", item: "x" }] })).toEqual(
      expect.arrayContaining([expect.stringContaining("en az 2")]),
    );
    expect(validateJsonLd({ "@type": "Organization", name: "a", url: "b" })).toEqual(expect.arrayContaining([expect.stringContaining("@context")]));
  });
  it("AggregateRating / Review sahte değerlendirme olarak HATA sayılır", () => {
    const withRating = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "x",
      applicationCategory: "B",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "10", priceCurrency: "TRY" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "100" },
    };
    const errs = validateJsonLd(withRating);
    expect(errs.some((e) => e.includes("aggregateRating"))).toBe(true);
    expect(validateJsonLd({ ...withRating, aggregateRating: undefined, review: [{ "@type": "Review" }] }).some((e) => e.includes("review"))).toBe(true);
  });
  it("HTML'den ld+json bloklarını ayrıştırır, bozuk bloğu sayar", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization"}</script><script type="application/ld+json">{bozuk</script>`;
    const r = extractJsonLdBlocks(html);
    expect(r.blocks).toHaveLength(1);
    expect(r.parseErrors).toBe(1);
  });
});

const rule = (id: string, from: string, to: string, enabled = true): SeoRedirectRule => ({ id: id.padEnd(6, "x"), from, to, status: 308, enabled });

describe("yönlendirme çözücü, döngü ve zincir tespiti", () => {
  it("yolu normalleştirir: sorgu, parça, sondaki /, büyük harf", () => {
    expect(normalizeRedirectPath("/Eski-Sayfa/?a=1#b")).toBe("/eski-sayfa");
    expect(normalizeRedirectPath("/")).toBe("/");
  });
  it("tek adımlı kuralı çözer; kapalı kural ve eşleşmeyen yol null", () => {
    const map = buildRedirectMap([rule("aaaaaa", "/eski", "/fiyatlar"), rule("bbbbbb", "/kapali", "/demo", false)]);
    expect(resolveRedirect(map, "/eski/")).toEqual({ to: "/fiyatlar", status: 308 });
    expect(resolveRedirect(map, "/kapali")).toBeNull();
    expect(resolveRedirect(map, "/yok")).toBeNull();
  });
  it("zinciri son hedefe indirger", () => {
    const map = buildRedirectMap([rule("aaaaaa", "/a", "/b"), rule("bbbbbb", "/b", "/c")]);
    expect(resolveRedirect(map, "/a")).toEqual({ to: "/c", status: 308 });
  });
  it("döngüde çözücü null döner (sonsuz yönlendirme yok)", () => {
    const map = buildRedirectMap([rule("aaaaaa", "/a", "/b"), rule("bbbbbb", "/b", "/a")]);
    expect(resolveRedirect(map, "/a")).toBeNull();
  });
  it("analiz: döngü, zincir, yinelenen kaynak, kendine yönlendirme, gölgelenen sayfa", () => {
    const loop = analyzeRedirects([rule("aaaaaa", "/a", "/b"), rule("bbbbbb", "/b", "/a")]);
    expect(loop.some((i) => i.kind === "loop")).toBe(true);
    const chain = analyzeRedirects([rule("aaaaaa", "/a", "/b"), rule("bbbbbb", "/b", "/c")]);
    expect(chain.some((i) => i.kind === "chain" && i.ruleId === "aaaaaa")).toBe(true);
    expect(analyzeRedirects([rule("aaaaaa", "/a", "/x"), rule("bbbbbb", "/a/", "/y")]).some((i) => i.kind === "duplicate")).toBe(true);
    expect(analyzeRedirects([rule("aaaaaa", "/a", "/a/")]).some((i) => i.kind === "self")).toBe(true);
    expect(analyzeRedirects([rule("aaaaaa", "/fiyatlar", "/demo")]).some((i) => i.kind === "shadowed")).toBe(true);
  });
  it("yeni kural doğrulaması: korumalı yol, mevcut sayfa, aynı kaynak, döngü reddedilir", () => {
    expect(validateNewRule([], rule("aaaaaa", "/app/musteriler", "/x"))).toMatch(/Korumalı/);
    expect(validateNewRule([], rule("aaaaaa", "/vitrin/ofis", "/x"))).toMatch(/Korumalı/);
    expect(validateNewRule([], rule("aaaaaa", "/fiyatlar", "/x"))).toMatch(/zaten bir sayfa/);
    expect(validateNewRule([rule("bbbbbb", "/eski", "/y")], rule("aaaaaa", "/eski", "/x"))).toMatch(/zaten bir kural/);
    expect(validateNewRule([rule("bbbbbb", "/b", "/a")], rule("aaaaaa", "/a", "/b"))).toMatch(/döngü/);
    expect(validateNewRule([], rule("aaaaaa", "/eski-sayfa", "/fiyatlar"))).toBeNull();
  });
  it("dış hedefli kural zinciri sonlandırır", () => {
    const map = buildRedirectMap([rule("aaaaaa", "/a", "https://example.com/x")]);
    expect(resolveRedirect(map, "/a")).toEqual({ to: "https://example.com/x", status: 308 });
  });
});
