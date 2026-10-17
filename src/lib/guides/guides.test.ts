import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateJsonLd } from "@/lib/seo/jsonld";
import { STATIC_PUBLIC_PATHS } from "@/lib/site-menu/known-routes";
import { guidePageJsonLd } from "./jsonld";
import { escapeXml, renderGuideRss } from "./rss";
import { GUIDE_CATEGORIES, THIN_CONTENT_WORDS, emptyGuide, validateGuide, type GuideContent, type GuideIndexEntry } from "./schema";
import { guideHubSitemapEntries, guideSitemapEntries } from "./sitemap";
import { checkGuideSlug, toGuideSlug } from "./slug";
import type { PublishedGuide } from "./store";
import { guideExtraMetadata, guideHubMetadata, relatedGuides } from "./view";

const BASE = "https://emlaksoft.com.tr";
const words = (n: number) => Array.from({ length: n }, () => "söz").join(" ");

function sampleGuide(over: Partial<GuideContent> = {}): GuideContent {
  return {
    title: "Emlak komisyonu nasıl hesaplanır?",
    category: "finans-ve-vergi",
    seo: { title: "Emlak komisyonu hesaplama rehberi", description: "Komisyon, KDV ve tahsilat adım adım." },
    body: [
      { type: "p", text: `Giriş paragrafı **önemli** ${words(THIN_CONTENT_WORDS)}` },
      { type: "h2", text: "Oran nasıl belirlenir?" },
      { type: "p", text: "[Fiyatlar](/fiyatlar) sayfasına bakın." },
      { type: "faq", items: [{ q: "KDV dahil mi?", a: "**Hayır**, ayrıca eklenir." }] },
      { type: "toolEmbed", slug: "komisyon-hesaplama" },
    ],
    relatedTools: [],
    ...over,
  };
}

function sampleEntry(over: Partial<GuideIndexEntry> = {}): GuideIndexEntry {
  return {
    id: "aaaaaaaaaaaa",
    slug: "emlak-komisyonu-nasil-hesaplanir",
    title: "Emlak komisyonu nasıl hesaplanır?",
    category: "finans-ve-vergi",
    status: "yayinda",
    publishedAt: "2026-10-10T09:00:00.000Z",
    firstPublishedAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-10T09:00:00.000Z",
    updatedBy: "Test",
    ...over,
  };
}

describe("rehber yolu (slug)", () => {
  it("Türkçe karakter dönüşümü yapılır", () => {
    expect(toGuideSlug("Kira Artışı Nasıl Hesaplanır?")).toBe("kira-artisi-nasil-hesaplanir");
    expect(toGuideSlug("İşyeri Çalışma Ölçüsü Ğ Ü")).toBe("isyeri-calisma-olcusu-g-u");
    expect(checkGuideSlug("Şehir Dışı Tapu Masrafı")).toEqual({ ok: true, slug: "sehir-disi-tapu-masrafi" });
  });

  it.each(["admin", "api", "kayit", "giris", "app", "kategori", "rss", "Admin"])("rezerve yol reddedilir: %s", (s) => {
    expect(checkGuideSlug(s).ok).toBe(false);
  });

  it("boş, çok bölümlü ve alınmış yol reddedilir", () => {
    expect(checkGuideSlug("").ok).toBe(false);
    expect(checkGuideSlug("a/b").ok).toBe(false);
    expect(checkGuideSlug("???").ok).toBe(false);
    expect(checkGuideSlug("kira-getirisi", ["kira-getirisi"]).ok).toBe(false);
  });
});

describe("rehber şeması", () => {
  it("geçerli yazı; ince içerik ve boş SEO uyarıdır (engellemez)", () => {
    expect(validateGuide(sampleGuide()).issues.filter((i) => i.level === "error")).toEqual([]);
    const thin = validateGuide(emptyGuide("Kısa", "ofis-yonetimi"));
    expect(thin.guide).not.toBeNull();
    expect(thin.issues.every((i) => i.level === "warn")).toBe(true);
    expect(thin.issues.some((i) => i.message.startsWith("İnce içerik"))).toBe(true);
  });

  it("SEO başlığı ≤60, açıklama ≤155; bilinmeyen kategori/alan reddedilir", () => {
    expect(validateGuide(sampleGuide({ seo: { title: "x".repeat(61), description: "" } })).guide).toBeNull();
    expect(validateGuide(sampleGuide({ seo: { title: "", description: "x".repeat(156) } })).guide).toBeNull();
    expect(validateGuide({ ...sampleGuide(), category: "blog" }).guide).toBeNull();
    expect(validateGuide({ ...sampleGuide(), html: "<p>" }).guide).toBeNull();
  });

  it("güvensiz bağlantı kaydı engeller; bilinmeyen iç yol yalnız uyarı, rehber yolu ek yolla bilinir", () => {
    const evil = validateGuide(sampleGuide({ body: [{ type: "p", text: "[x](javascript:alert(1))" }] }));
    expect(evil.issues.some((i) => i.level === "error" && i.path === "body.0.text")).toBe(true);
    const broken = validateGuide(sampleGuide({ body: [{ type: "p", text: "[x](/rehber/diger-yazi)" }] }));
    expect(broken.issues.some((i) => i.level === "warn" && i.message.startsWith("Kırık iç bağlantı"))).toBe(true);
    const known = validateGuide(sampleGuide({ body: [{ type: "p", text: "[x](/rehber/diger-yazi)" }] }), { extraPaths: ["/rehber/diger-yazi"] });
    expect(known.issues.some((i) => i.message.startsWith("Kırık iç bağlantı"))).toBe(false);
  });
});

describe("JSON-LD", () => {
  it("Article + BreadcrumbList (+ FAQPage) geçerli; yazar kurum adı EmlakSoft, tarihler yayın geçmişinden", () => {
    const ld = guidePageJsonLd({ base: BASE, entry: sampleEntry(), content: sampleGuide() });
    expect(validateJsonLd(ld)).toEqual([]);
    const graph = ld["@graph"] as Array<Record<string, unknown>>;
    const article = graph.find((n) => n["@type"] === "Article")!;
    expect(article).toMatchObject({
      headline: "Emlak komisyonu nasıl hesaplanır?",
      datePublished: "2026-10-01T09:00:00.000Z",
      dateModified: "2026-10-10T09:00:00.000Z",
      author: { "@type": "Organization", name: "EmlakSoft" },
    });
    const crumbs = graph.find((n) => n["@type"] === "BreadcrumbList")!;
    expect((crumbs.itemListElement as unknown[]).length).toBe(4);
    const faq = graph.find((n) => n["@type"] === "FAQPage")!;
    expect(JSON.stringify(faq)).toContain('"text":"Hayır, ayrıca eklenir."');
  });
});

describe("sitemap", () => {
  const thin = sampleGuide({ body: [{ type: "p", text: "kısa" }] });
  const guides: PublishedGuide[] = [
    { entry: sampleEntry(), content: sampleGuide() },
    { entry: sampleEntry({ id: "bbbbbbbbbbbb", slug: "taslak", status: "taslak", publishedAt: null }), content: sampleGuide() },
    { entry: sampleEntry({ id: "cccccccccccc", slug: "arsiv", status: "arsiv" }), content: sampleGuide() },
    { entry: sampleEntry({ id: "dddddddddddd", slug: "ince" }), content: thin },
  ];

  it("yalnız yayındaki (ve ince olmayan) yazılar; lastmod yayın zamanı", () => {
    expect(guideSitemapEntries(BASE, guides)).toEqual([
      { url: `${BASE}/rehber/emlak-komisyonu-nasil-hesaplanir`, lastModified: "2026-10-10T09:00:00.000Z", changeFrequency: "monthly", priority: 0.6 },
    ]);
  });

  it("liste ve kategori sayfaları yalnız indekslenebilir yazı varken girer; lastmod içindeki en yeni yazı", () => {
    expect(guideHubSitemapEntries(BASE, guides)).toEqual([
      { url: `${BASE}/rehber`, lastModified: "2026-10-10T09:00:00.000Z", changeFrequency: "weekly", priority: 0.6 },
      { url: `${BASE}/rehber/kategori/${sampleEntry().category}`, lastModified: "2026-10-10T09:00:00.000Z", changeFrequency: "weekly", priority: 0.5 },
    ]);
    expect(guideHubSitemapEntries(BASE, guides.slice(1))).toEqual([]);
  });

  it("S5: sitemap yükleyicisi rehber girdilerini ve vitrin dışlamalarını kullanır; /rehber bilinen herkese açık yol", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/seo/sitemap-data.ts"), "utf8");
    expect(src).toContain("listGuideSitemapEntries(base)");
    expect(src).toContain("loadIncludedOffices(admin, sm)");
    expect(readFileSync(join(process.cwd(), "src/lib/seo/included-offices.ts"), "utf8")).toContain("loadVitrinSitemapExclusions(admin)");
    expect(src).toContain("GUIDES_CACHE_TAG");
    expect(STATIC_PUBLIC_PATHS as readonly string[]).toContain("/rehber");
  });

  it("ince içerik noindex; yayında indekslenebilir yazı yokken /rehber noindex", () => {
    expect(guideExtraMetadata(BASE, "ince", thin).noindex).toBe(true);
    expect(guideExtraMetadata(BASE, "x", sampleGuide()).noindex).toBeUndefined();
    expect(guideHubMetadata(BASE, 0).noindex).toBe(true);
    expect(guideHubMetadata(BASE, 1).noindex).toBeUndefined();
  });
});

/** Küçük, bağımlılıksız XML iyi biçimlilik denetimi: etiket dengesi, öznitelik tırnakları, çıplak '&' ve '<' yok. */
function assertWellFormedXml(xml: string) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const body = xml.replace(/^<\?xml[^>]*\?>/, "");
  expect(body).not.toMatch(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[6]) throw new Error(`Çıplak '<' konum ${m.index}`);
    if (m[5] !== undefined) continue;
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) expect(stack.pop(), `kapanış </${name}>`).toBe(name);
    else stack.push(name!);
  }
  expect(stack).toEqual([]);
}

describe("RSS", () => {
  it("geçerli XML üretir ve kaçışlar doğrudur", () => {
    const nasty = sampleGuide({ title: `Tapu & harç <script>alert("x")</script> 'tırnak'`, seo: { title: "", description: "A & B < C > D \u0001" } });
    const xml = renderGuideRss(BASE, [
      { entry: sampleEntry(), content: nasty },
      { entry: sampleEntry({ id: "bbbbbbbbbbbb", slug: "taslak", status: "taslak", publishedAt: null }), content: sampleGuide() },
    ]);
    assertWellFormedXml(xml);
    expect(xml).toContain("<title>Tapu &amp; harç &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &apos;tırnak&apos;</title>");
    expect(xml).toContain("<description>A &amp; B &lt; C &gt; D </description>");
    expect(xml).not.toContain("<script");
    expect(xml).toContain("<pubDate>Sat, 10 Oct 2026 09:00:00 GMT</pubDate>");
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("yazı yokken de geçerli boş kanal", () => {
    const xml = renderGuideRss(BASE, []);
    assertWellFormedXml(xml);
    expect(xml).not.toContain("<item>");
  });
});

describe("ilgili yazılar", () => {
  it("önce aynı kategori, kendisi hariç, en çok 3", () => {
    const mk = (id: string, category: GuideIndexEntry["category"]) => ({ entry: { id, category } });
    const all = [mk("a", "ofis-yonetimi"), mk("b", "finans-ve-vergi"), mk("c", "ofis-yonetimi"), mk("d", "mevzuat-ve-kvkk"), mk("e", "ofis-yonetimi")];
    expect(relatedGuides(all, { id: "a", category: "ofis-yonetimi" }).map((g) => g.entry.id)).toEqual(["c", "e", "b"]);
    expect(GUIDE_CATEGORIES).toHaveLength(5);
  });
});
