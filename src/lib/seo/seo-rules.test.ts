import { describe, expect, it } from "vitest";
import { DEFAULT_SEO_GLOBAL } from "./schema";
import { canonicalUrl, descriptionVerdict, pageChecklist, renderTitle, sameHost, titleVerdict } from "./rules";
import {
  SITEMAP_PROTOCOL_MAX_URLS,
  chunkEntries,
  filterSafeEntries,
  isSitemapSafePath,
  parseLocs,
  renderSitemapIndex,
  renderUrlset,
  staticSitemapEntries,
  tenantInSitemap,
  type SitemapEntry,
} from "./sitemap-rules";
import { DEFAULT_SITEMAP, mergeSitemap } from "./schema";
import { buildLlmsTxt, buildRobots, robotsToText } from "./robots-rules";
import { DEFAULT_ROBOTS, mergeRobots, RobotsSettingsSchema } from "./schema";

const BASE = "https://emlaksoft.vercel.app";

describe("başlık ve açıklama uzunluk kuralları", () => {
  it("60 karakter üstü başlık uyarı verir, boş başlık hata verir", () => {
    expect(titleVerdict("a".repeat(61)).verdict).toBe("warn");
    expect(titleVerdict("Fiyatlar | EmlakSoft").verdict).toBe("ok");
    expect(titleVerdict("").verdict).toBe("fail");
    expect(titleVerdict("Kısa").verdict).toBe("warn");
  });
  it("açıklama: yok=hata, 70-160=ok, 161+=uyarı", () => {
    expect(descriptionVerdict(null).verdict).toBe("fail");
    expect(descriptionVerdict("x".repeat(100)).verdict).toBe("ok");
    expect(descriptionVerdict("x".repeat(161)).verdict).toBe("warn");
    expect(descriptionVerdict("x".repeat(20)).verdict).toBe("warn");
  });
  it("renderTitle şablon uygular, boşta varsayılana döner", () => {
    expect(renderTitle("%s | EmlakSoft", "Fiyatlar", "Varsayılan")).toBe("Fiyatlar | EmlakSoft");
    expect(renderTitle("%s | EmlakSoft", "  ", "Varsayılan")).toBe("Varsayılan");
  });
});

describe("canonical üretimi", () => {
  it("göreli yolu mutlak yapar, sorgu ve parçayı atar, kökte sondaki / olmaz", () => {
    expect(canonicalUrl(BASE, "/fiyatlar")).toBe(`${BASE}/fiyatlar`);
    expect(canonicalUrl(`${BASE}/`, "/fiyatlar?plan=office#x")).toBe(`${BASE}/fiyatlar`);
    expect(canonicalUrl(BASE, "/")).toBe(BASE);
    expect(canonicalUrl(BASE, "https://baska.example/x?a=1")).toBe("https://baska.example/x");
  });
  it("sameHost www/apex farkını yakalar", () => {
    expect(sameHost("https://www.emlaksoft.com/a", "https://emlaksoft.com")).toBe(false);
    expect(sameHost("https://emlaksoft.com/a", "https://emlaksoft.com/b")).toBe(true);
  });
});

describe("kontrol listesi (sahte puan yok)", () => {
  const ok = {
    renderedTitle: "Fiyatlar | EmlakSoft",
    description: "x".repeat(100),
    canonical: "/fiyatlar",
    base: BASE,
    ogImage: "/opengraph-image",
    indexable: true,
    inSitemap: true,
    jsonLdErrors: [] as string[],
    h1Count: 1,
  };
  it("her şey doğruysa hepsi ok", () => {
    expect(pageChecklist(ok).every((i) => i.verdict === "ok")).toBe(true);
  });
  it("noindex + sitemap çelişkisi kaldı olur", () => {
    const r = pageChecklist({ ...ok, indexable: false, inSitemap: true });
    expect(r.find((i) => i.id === "robots-sitemap")?.verdict).toBe("fail");
  });
  it("çoklu h1, eksik canonical ve JSON-LD hatası yakalanır; h1 bilinmiyorsa uyarı", () => {
    const r = pageChecklist({ ...ok, h1Count: 2, canonical: null, jsonLdErrors: ["x eksik"] });
    expect(r.find((i) => i.id === "h1")?.verdict).toBe("fail");
    expect(r.find((i) => i.id === "canonical")?.verdict).toBe("fail");
    expect(r.find((i) => i.id === "jsonld")?.verdict).toBe("fail");
    expect(pageChecklist({ ...ok, h1Count: null }).find((i) => i.id === "h1")?.verdict).toBe("warn");
  });
});

describe("sitemap girdi kuralları", () => {
  const entries = staticSitemapEntries(BASE, {}, DEFAULT_SITEMAP);
  const paths = entries.map((e) => new URL(e.url).pathname);
  it("indekslenebilir statik sayfalar girer, /giris (noindex) girmez", () => {
    expect(paths).toContain("/");
    expect(paths).toContain("/fiyatlar");
    expect(paths).toContain("/araclar");
    expect(paths).toContain("/kvkk-aydinlatma");
    expect(paths).not.toContain("/giris");
  });
  it("statik girdilere sahte lastmod yazılmaz", () => {
    expect(entries.every((e) => e.lastModified === undefined)).toBe(true);
  });
  it("admin noindex yapınca ya da hariç tutunca sayfa sitemap'ten düşer; updatedAt lastmod olur", () => {
    const e1 = staticSitemapEntries(BASE, { "/demo": { robotsIndex: false } }, DEFAULT_SITEMAP).map((e) => new URL(e.url).pathname);
    expect(e1).not.toContain("/demo");
    const e2 = staticSitemapEntries(BASE, { "/kayit": { sitemapInclude: false } }, DEFAULT_SITEMAP).map((e) => new URL(e.url).pathname);
    expect(e2).not.toContain("/kayit");
    const e3 = staticSitemapEntries(BASE, { "/demo": { title: "x", updatedAt: "2026-10-01T10:00:00.000Z" } }, DEFAULT_SITEMAP);
    expect(e3.find((e) => e.url.endsWith("/demo"))?.lastModified).toBe("2026-10-01T10:00:00.000Z");
  });
  it("araçlar ve statik sayfa anahtarları kapatılabilir", () => {
    const off = staticSitemapEntries(BASE, {}, { ...DEFAULT_SITEMAP, tools: false, staticPages: false });
    expect(off).toHaveLength(0);
  });
  it("token'lı, oturumlu ve ödeme yüzeyleri güvenli değildir", () => {
    for (const p of ["/app/musteriler", "/admin", "/api/cron/x", "/malik-portali/abc", "/musteri-portali/abc", "/imza/t", "/odeme-link/t", "/anket/t", "/randevu-teyit/t", "/randevu-al/t", "/sunum/t", "/paylas/t", "/tavsiye/t", "/degerleme-raporu/t", "/acik-ev-kayit/t", "/lead/t", "/giris", "/vitrin/x/favoriler", "/fiyatlar?x=1"]) {
      expect(isSitemapSafePath(p), p).toBe(false);
    }
    for (const p of ["/", "/fiyatlar", "/vitrin/ofis", "/vitrin/ofis/123", "/danisman/ali", "/araclar/komisyon-hesaplama"]) {
      expect(isSitemapSafePath(p), p).toBe(true);
    }
  });
  it("son süzgeç güvensiz ve yinelenen adresleri atar", () => {
    const list: SitemapEntry[] = [
      { url: `${BASE}/fiyatlar` },
      { url: `${BASE}/fiyatlar` },
      { url: `${BASE}/malik-portali/abc` },
      { url: `${BASE}/giris` },
    ];
    expect(filterSafeEntries(list)).toEqual([{ url: `${BASE}/fiyatlar` }]);
  });
  it("vitrin ofisi varsayılan olarak yalnız opt-in listesindeyse girer", () => {
    expect(tenantInSitemap(DEFAULT_SITEMAP, "demo-ofis")).toBe(false);
    expect(tenantInSitemap({ ...DEFAULT_SITEMAP, optInTenantSlugs: ["demo-ofis"] }, "demo-ofis")).toBe(true);
    expect(tenantInSitemap({ ...DEFAULT_SITEMAP, onlyOptIn: false }, "baska")).toBe(true);
    expect(tenantInSitemap({ ...DEFAULT_SITEMAP, vitrinOffices: false, vitrinListings: false, onlyOptIn: false }, "baska")).toBe(false);
  });
  it("varsayılan ayar güvenli: onlyOptIn açık, parça sınırı 45.000", () => {
    const d = mergeSitemap(null);
    expect(d.onlyOptIn).toBe(true);
    expect(d.optInTenantSlugs).toEqual([]);
    expect(d.maxUrlsPerSitemap).toBeLessThanOrEqual(SITEMAP_PROTOCOL_MAX_URLS);
  });
});

describe("sitemap parçalama ve XML", () => {
  it("parça başına sınır uygulanır, protokol sınırı (50.000) aşılmaz", () => {
    const list = Array.from({ length: 120_001 }, (_, i) => ({ url: `${BASE}/vitrin/o/${i}` }));
    const chunks = chunkEntries(list, 45_000);
    expect(chunks.map((c) => c.length)).toEqual([45_000, 45_000, 30_001]);
    expect(chunkEntries(list, 99_999)[0]?.length).toBe(SITEMAP_PROTOCOL_MAX_URLS);
    expect(chunkEntries([], 45_000)).toEqual([[]]);
  });
  it("urlset XML kaçışlıdır; lastmod yalnız varsa yazılır", () => {
    const xml = renderUrlset([
      { url: `${BASE}/a?x=1&y=2`, changeFrequency: "weekly", priority: 0.5 },
      { url: `${BASE}/b`, lastModified: "2026-10-01T00:00:00.000Z" },
    ]);
    expect(xml).toContain("<loc>https://emlaksoft.vercel.app/a?x=1&amp;y=2</loc>");
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
    expect(xml).toContain("<priority>0.5</priority>");
    expect(parseLocs(xml)).toEqual([`${BASE}/a?x=1&y=2`, `${BASE}/b`]);
  });
  it("sitemap indeksi parça adreslerini listeler", () => {
    const xml = renderSitemapIndex([{ url: `${BASE}/sitemap/1.xml` }, { url: `${BASE}/sitemap/2.xml` }]);
    expect(xml).toContain("<sitemapindex");
    expect(parseLocs(xml)).toHaveLength(2);
  });
});

describe("robots.txt üretimi ve yapay zekâ anahtarları", () => {
  it("varsayılan: herkese izin, güvenlik yolları kapalı, crawl-delay yok, sitemap satırı var", () => {
    const text = robotsToText(buildRobots(BASE, DEFAULT_ROBOTS));
    expect(text).toContain("User-Agent: *");
    expect(text).toContain("Allow: /");
    for (const p of ["/app/", "/admin/", "/api/", "/malik-portali/", "/musteri-portali/", "/imza/", "/odeme-link/", "/anket/"]) {
      expect(text).toContain(`Disallow: ${p}`);
    }
    expect(text).not.toMatch(/crawl-delay/i);
    expect(text).toContain(`Sitemap: ${BASE}/sitemap.xml`);
    expect(text).not.toContain("GPTBot");
  });
  it("engellenen yapay zekâ tarayıcıları Disallow: / alır", () => {
    const text = robotsToText(buildRobots(BASE, mergeRobots({ blockedAiBots: ["GPTBot", "CCBot"] })));
    expect(text).toMatch(/User-Agent: GPTBot\nDisallow: \//);
    expect(text).toMatch(/User-Agent: CCBot\nDisallow: \//);
    expect(text).not.toContain("ClaudeBot");
  });
  it("ek Disallow eklenir; tüm siteyi kapatan kural şemada reddedilir", () => {
    expect(robotsToText(buildRobots(BASE, mergeRobots({ extraDisallow: ["/ozel/"] })))).toContain("Disallow: /ozel/");
    expect(RobotsSettingsSchema.safeParse({ extraDisallow: ["/"] }).success).toBe(false);
    expect(RobotsSettingsSchema.safeParse({ extraDisallow: ["ozel"] }).success).toBe(false);
  });
  it("llms.txt varsayılan kapalı; açılınca özet ya da özel içerik", () => {
    expect(buildLlmsTxt(DEFAULT_SEO_GLOBAL, DEFAULT_ROBOTS, BASE)).toBeNull();
    const auto = buildLlmsTxt(DEFAULT_SEO_GLOBAL, mergeRobots({ llmsTxtEnabled: true }), BASE);
    expect(auto).toContain("# EmlakSoft");
    expect(buildLlmsTxt(DEFAULT_SEO_GLOBAL, mergeRobots({ llmsTxtEnabled: true, llmsTxt: "Özel özet" }), BASE)).toBe("Özel özet\n");
  });
});
