import { describe, expect, it } from "vitest";
import { seoPages } from "./registry";
import { canonicalUrl } from "./rules";
import { staticSitemapEntries } from "./sitemap-rules";
import { SEO_THRESHOLDS } from "./thresholds";
import type { SeoSitemapSettings } from "./schema";

// YD8: arama sonucunda kesilmeyen açıklama + ana sayfa sitemap adresi canonical ile birebir aynı.
const BASE = "https://emlaksoft.com.tr";

describe("SEO kayıt defteri: açıklama uzunluğu", () => {
  it(`her sayfanın varsayılan açıklaması ≤ ${SEO_THRESHOLDS.suggestDescriptionMax} karakter (Google ~155'ten sonra keser)`, () => {
    const long = seoPages()
      .filter((p) => (p.description ?? "").length > SEO_THRESHOLDS.suggestDescriptionMax)
      .map((p) => `${p.path} (${p.description!.length})`);
    expect(long).toEqual([]);
  });

  it("/kayit açıklaması kısa ve deneme/kart bilgisini korur", () => {
    const d = seoPages().find((p) => p.path === "/kayit")!.description!;
    expect(d.length).toBeLessThanOrEqual(SEO_THRESHOLDS.suggestDescriptionMax);
    expect(d).toContain("ücretsiz");
    expect(d).toContain("kredi kartı gerekmez");
  });
});

describe("sitemap ana sayfa adresi canonical ile aynı", () => {
  const settings = { staticPages: true, tools: true } as SeoSitemapSettings;

  it("ana sayfa loc = canonicalUrl(base, '/') (sonda '/' yok; Next metadataBase ile çözülen canonical da böyle)", () => {
    const home = staticSitemapEntries(BASE, {}, settings).find((e) => e.url === BASE || e.url === `${BASE}/`);
    expect(home?.url).toBe(canonicalUrl(BASE, "/"));
    expect(home?.url).toBe(BASE);
  });

  it("sitemap'teki hiçbir statik adres sonda '/' taşımaz (canonical biçimi tek)", () => {
    for (const e of staticSitemapEntries(`${BASE}/`, {}, settings)) expect(e.url, e.url).not.toMatch(/\/$/);
  });

  it("override canonical'ı olan sayfada loc o canonical'dır", () => {
    const entries = staticSitemapEntries(BASE, { "/fiyatlar": { canonical: "/fiyatlar" } } as never, settings);
    expect(entries.find((e) => e.url.endsWith("/fiyatlar"))?.url).toBe(`${BASE}/fiyatlar`);
  });
});
