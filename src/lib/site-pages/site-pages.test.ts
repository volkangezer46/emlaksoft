import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_SEO_GLOBAL } from "@/lib/seo/schema";
import { resolvePageMetadata } from "@/lib/seo/metadata";
import { buildRedirectMap, withLegacyRedirects } from "@/lib/seo/redirects";
import { filterSafeEntries } from "@/lib/seo/sitemap-rules";
import { SitePageBlocks } from "./blocks";
import { sitePageExtraMetadata, sitePageFaq, sitePageSitemapEntries } from "./metadata";
import { resolveCatchAll } from "./resolve";
import { validateSitePage } from "./schema";
import { RESERVED_ROUTE_DIRS, SLUG_RE, checkSlug } from "./slug";
import { PAGE_TEMPLATES } from "./templates";
import type { SitePageContent } from "./schema-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const validateSitePageForTest = (input: unknown, extraPaths: string[] = []) => validateSitePage(input, { extraPaths });
const hasErrorsIn = (r: { issues: Array<{ level: string }> }) => r.issues.some((i) => i.level === "error");

const page = (over: Partial<SitePageContent> = {}): SitePageContent => ({
  title: "Hakkımızda",
  blocks: [{ type: "hero", eyebrow: "", title: "Biz kimiz", lead: "Emlak ofisleri için yazılım.", primary: { label: "Deneyin", href: "/kayit" } }],
  seo: { title: "Hakkımızda", description: "EmlakSoft ekibi ve çalışma biçimi hakkında bilgi.", index: true, inSitemap: true },
  ...over,
});

describe("slug güvenliği", () => {
  it.each([
    ["admin", false],
    ["admin/x", false],
    ["giris", false],
    ["vitrin", false],
    ["vitrin/ofis", false],
    ["api", false],
    ["app", false],
    ["kayit", false],
    ["onizleme", false],
    ["sifre-unuttum", false],
    ["static", false],
    ["media", false],
    ["fiyatlar", false],
    ["Hakkimizda", false],
    ["hakkımızda", false],
    ["..", false],
    ["../etc", false],
    ["a/../b", false],
    ["a//b", false],
    ["-a", false],
    ["a-", false],
    ["a/b/c/d", false],
    ["a".repeat(81), false],
    ["", false],
    ["hakkimizda", true],
    ["iletisim", true],
    ["about", true],
    ["kampanya/istanbul", true],
    ["emlak-ofisi-yazilimi/istanbul/kadikoy", true],
  ])("%s -> %s", (slug, ok) => {
    expect(checkSlug(slug).ok, slug).toBe(ok);
  });

  it("benzersizlik: başka sayfanın yolu reddedilir", () => {
    expect(checkSlug("hakkimizda", ["hakkimizda"]).ok).toBe(false);
    expect(checkSlug("hakkimizda", ["iletisim"]).ok).toBe(true);
  });

  it("rota dizini sözleşmesi: src/app altındaki her üst düzey rota dizini ayrılmış listededir ve reddedilir", () => {
    const dirs = readdirSync(join(root, "src/app")).filter((n) => !/^[[(_@]/.test(n) && statSync(join(root, "src/app", n)).isDirectory());
    expect(dirs.length).toBeGreaterThan(30);
    const missing = dirs.filter((d) => !(RESERVED_ROUTE_DIRS as readonly string[]).includes(d));
    expect(missing, `slug.ts RESERVED_ROUTE_DIRS listesine ekleyin: ${missing.join(", ")}`).toEqual([]);
    for (const d of RESERVED_ROUTE_DIRS) if (SLUG_RE.test(d)) expect(checkSlug(d).ok, d).toBe(false);
  });
});

describe("blok şeması", () => {
  it("javascript:/data: bağlantısı reddedilir; var olmayan iç yol reddedilir; diğer özel sayfa yolu kabul edilir", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.example", "/yok-boyle-sayfa"]) {
      const p = page({ blocks: [{ type: "cta", title: "X", text: "", primary: { label: "Git", href } }] });
      expect(hasErrorsIn(validateSitePageForTest(p)), href).toBe(true);
    }
    const ok = page({ blocks: [{ type: "cta", title: "X", text: "", primary: { label: "Git", href: "/iletisim" } }] });
    expect(hasErrorsIn(validateSitePageForTest(ok, ["/iletisim"]))).toBe(false);
  });

  it("bilinmeyen alan, bilinmeyen blok türü ve bilinmeyen simge reddedilir", () => {
    expect(hasErrorsIn(validateSitePageForTest({ ...page(), html: "<b>x</b>" }))).toBe(true);
    expect(hasErrorsIn(validateSitePageForTest(page({ blocks: [{ type: "html", body: "<b>" } as never] })))).toBe(true);
    expect(hasErrorsIn(validateSitePageForTest(page({ blocks: [{ type: "features", heading: "", items: [{ icon: "Bomb", title: "a", text: "" }] }] })))).toBe(true);
  });

  it("HTML karakterleri düz metin kalır (işlenmez, kaçışlı basılır); satır sonu paragraf olur", () => {
    const evil = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    const p = page({ blocks: [{ type: "text", heading: evil, paragraphs: [`ilk satır\n${evil}`], bullets: [evil] }] });
    const r = validateSitePageForTest(p);
    expect(hasErrorsIn(r)).toBe(false);
    expect(r.issues.some((i) => i.level === "warn" && /HTML/.test(i.message))).toBe(true);
    const html = renderToStaticMarkup(createElement(SitePageBlocks, { content: p, contact: { email: "", phone: "", address: "" } }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<p>ilk satır</p>");
    // Giriş bloğu yoksa sayfa adı h1 olur (tek ana başlık).
    expect(html).toContain("<h1");
  });

  it("riskli kelime uyarıdır, kaydı engellemez", () => {
    const r = validateSitePageForTest(page({ blocks: [{ type: "text", paragraphs: ["Türkiye'nin en iyi sistemi, %100 garanti"], bullets: [] }] }));
    expect(hasErrorsIn(r)).toBe(false);
    expect(r.issues.some((i) => i.level === "warn" && /Riskli/.test(i.message))).toBe(true);
  });

  it("şablonlar örnek blok ve metinle dolu gelir ve hatasız doğrulanır", () => {
    for (const t of PAGE_TEMPLATES) {
      const r = validateSitePageForTest(t.content);
      expect(r.issues.filter((i) => i.level === "error"), t.id).toEqual([]);
      expect(t.content.blocks.length, t.id).toBeGreaterThan(0);
      expect(checkSlug(t.slug).ok, t.slug).toBe(true);
    }
  });

  it("iletişim bloğu yalnız kurum bilgisinde girilmiş alanı gösterir (uydurma yok)", () => {
    const p = page({ blocks: [{ type: "contact", heading: "Bize ulaşın", showEmail: true, showPhone: true, showAddress: true }] });
    const none = renderToStaticMarkup(createElement(SitePageBlocks, { content: p, contact: { email: "", phone: "", address: "" } }));
    expect(none).not.toContain("Bize ulaşın");
    const some = renderToStaticMarkup(createElement(SitePageBlocks, { content: p, contact: { email: "destek@ornek.com", phone: "", address: "" } }));
    expect(some).toContain("mailto:destek@ornek.com");
    expect(some).not.toContain("tel:");
  });
});

describe("[...slug] sırası: yönlendirme > yayınlı sayfa > 404", () => {
  const rule = { id: "r1", from: "/hakkimizda", to: "/fiyatlar", status: 308 as const, enabled: true, note: "" };
  it("aynı yolda yönlendirme varsa yönlendirme kazanır", () => {
    const map = buildRedirectMap(withLegacyRedirects([rule]));
    expect(resolveCatchAll("/hakkimizda", map, { hakkimizda: "abcdef123456" })).toEqual({ kind: "redirect", to: "/fiyatlar", status: 308 });
  });
  it("yayınlı sayfa çizilir; arşivlenen (haritada olmayan) sayfa 404 döner", () => {
    const map = buildRedirectMap(withLegacyRedirects([]));
    expect(resolveCatchAll("/hakkimizda", map, { hakkimizda: "abcdef123456" })).toEqual({ kind: "page", id: "abcdef123456", slug: "hakkimizda" });
    expect(resolveCatchAll("/kampanya/istanbul", map, { "kampanya/istanbul": "0123456789ab" }).kind).toBe("page");
    expect(resolveCatchAll("/hakkimizda", map, {})).toEqual({ kind: "notfound" });
    expect(resolveCatchAll("/constructor", map, {})).toEqual({ kind: "notfound" });
    // Yerleşik yönlendirme (/demo) değişmeden çalışır.
    expect(resolveCatchAll("/demo", map, { demo: "abcdef123456" }).kind).toBe("redirect");
  });
  it("sayfa dosyası kararı resolveCatchAll'a bırakır ve önbellekli haritadan okur", () => {
    const src = read("src/app/[...slug]/page.tsx");
    expect(src).toContain("resolveCatchAll(path, map, slugMap)");
    expect(src).toContain("getPublishedSlugMap");
    expect(src).toContain("notFound()");
    const store = read("src/lib/site-pages/store.ts");
    expect(store).toMatch(/tags: \[SITE_PAGES_CACHE_TAG\], revalidate: 300/);
  });
});

describe("metadata ve sitemap", () => {
  it("canonical = site tabanı + yol; index=false ise noindex; başlık şablonu uygulanır", () => {
    const extra = sitePageExtraMetadata("https://emlaksoft.com.tr", "hakkimizda", page());
    expect(extra.canonical).toBe("https://emlaksoft.com.tr/hakkimizda");
    const md = resolvePageMetadata("/hakkimizda", DEFAULT_SEO_GLOBAL, {}, extra);
    expect(md.title).toBe("Hakkımızda");
    expect(md.robots).toBeUndefined();
    expect(md.alternates?.canonical).toBe("https://emlaksoft.com.tr/hakkimizda");
    const hidden = page({ seo: { ...page().seo, index: false } });
    const md2 = resolvePageMetadata("/x", DEFAULT_SEO_GLOBAL, {}, sitePageExtraMetadata("https://emlaksoft.com.tr", "x", hidden));
    expect(md2.robots).toEqual({ index: false, follow: true });
  });

  it("SEO başlığı/açıklaması boşsa ilk girişten önerilir", () => {
    const p = page({ seo: { title: "", description: "", index: true, inSitemap: true } });
    const extra = sitePageExtraMetadata("https://emlaksoft.com.tr", "x", p);
    expect(extra.title).toBe("Biz kimiz");
    expect(extra.description).toBe("Emlak ofisleri için yazılım.");
  });

  it("sitemap yayınlı ve index'li sayfayı içerir; noindex ya da sitemap dışı olanı içermez", () => {
    const base = "https://emlaksoft.com.tr";
    const entries = filterSafeEntries(
      sitePageSitemapEntries(base, [
        { slug: "hakkimizda", updatedAt: "2026-10-13T08:00:00.000Z", content: page() },
        { slug: "gizli", updatedAt: "2026-10-13T08:00:00.000Z", content: page({ seo: { ...page().seo, index: false } }) },
        { slug: "disarida", updatedAt: "2026-10-13T08:00:00.000Z", content: page({ seo: { ...page().seo, inSitemap: false } }) },
      ]),
    );
    expect(entries.map((e) => e.url)).toEqual([`${base}/hakkimizda`]);
    expect(entries[0]!.lastModified).toBe("2026-10-13T08:00:00.000Z");
    // SP2: yayınlı sayfalar listPublishedSitePages'ten gelir; lastmod sayfanın kendi yayın geçmişinden (sitepage.<id>.history).
    const data = read("src/lib/seo/sitemap-data.ts");
    expect(data).toContain("listPublishedSitePages()");
    expect(data).toContain("sitePageSitemapEntries(base, withPublishTime)");
    expect(data).toMatch(/historyHeadAt\(histories\[`sitepage\.\$\{p\.id\}\.history`\]\)/);
  });

  it("FAQPage verisi sayfadaki görünen SSS bloklarından gelir", () => {
    const p = page({ blocks: [{ type: "faq", items: [{ q: "Soru?", a: "Cevap." }] }] });
    expect(sitePageFaq(p)).toEqual([{ q: "Soru?", a: "Cevap." }]);
  });

  it("registry: seoPages imzası değişmedi; saf kayıt defteri sunucu deposunu (site-pages/store) içe aktarmaz", () => {
    const src = read("src/lib/seo/registry.ts");
    expect(src).toContain("export function seoPages(): SeoPageDef[]");
    // registry istemci bileşenlerine de girer (robots-rules → SEO formu); depo service_role istemcisini çeker.
    expect(src).not.toContain("site-pages/store");
  });
});
