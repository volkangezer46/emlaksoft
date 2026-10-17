import { describe, expect, it } from "vitest";
import { SERP_PX, descriptionPixelVerdict, fitToPixels, textPixelWidth, titlePixelVerdict, titlePixels } from "./pixel-width";
import { expectedTypesFor, validateStructuredData } from "./structured-data";
import { combineCategories, containsPhrase, explainDrop, scorePage, scoreSite, scoreVitrin, toLite, type PageScoreContext } from "./score";
import type { PageSnapshot } from "./page-snapshot";
import { ruleSuggestion, shortenTitleCore } from "./rule-suggest";
import { brokenImageFinding, ownImageSources, redirectLinkFinding, resolveLocation } from "./link-rules";
import { extractSnapshotExtras } from "./page-snapshot";

const NOW = Date.parse("2026-10-17T00:00:00Z");

const snap = (over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: "https://emlaksoft.com.tr/fiyatlar",
  status: 200,
  inSitemap: true,
  noindex: false,
  title: "Fiyatlar: emlak ofisi yazılımı paketleri | EmlakSoft",
  description: "Emlak ofisiniz için aylık paketler: müşteri, portföy, anlaşma ve komisyon tek panelde. Ücretsiz deneyin, kredi kartı gerekmez.",
  canonical: "https://emlaksoft.com.tr/fiyatlar",
  h1: "Emlak ofisi yazılımı fiyatları",
  h1Count: 1,
  headingSkip: null,
  words: 900,
  imgs: 4,
  imgsNoAlt: 0,
  linksOut: 12,
  linksIn: 5,
  ldTypes: ["BreadcrumbList", "SoftwareApplication"],
  ldErrors: 0,
  ldWarnings: 0,
  ldParseErrors: 0,
  bytes: 60 * 1024,
  ttfbMs: 120,
  mixed: 0,
  dupTitle: false,
  dupDescription: false,
  robotsBlocked: false,
  ...over,
});
const ctx = (over: Partial<PageScoreContext> = {}): PageScoreContext => ({ nowMs: NOW, ...over });

describe("Türkçe piksel genişliği", () => {
  it("dar ve geniş harf aynı karakter sayısında farklı genişlik verir", () => {
    expect(textPixelWidth("iiiiiiiiii", 20)).toBeLessThan(textPixelWidth("MMMMMMMMMM", 20) / 3);
    // Türkçe harfler temel harfle aynı ilerleme: ş=s, ğ=g, ı (noktasız) i'den geniş.
    expect(textPixelWidth("ş", 20)).toBe(textPixelWidth("s", 20));
    expect(textPixelWidth("ğ", 20)).toBe(textPixelWidth("g", 20));
    expect(textPixelWidth("ı", 20)).toBeGreaterThan(textPixelWidth("i", 20));
    expect(textPixelWidth("İstanbul", 20)).toBe(textPixelWidth("Istanbul", 20));
  });

  it("başlık ölçüsü: 60 karakterden kısa ama geniş harfli başlık kesilir, uzun ama dar başlık sığar", () => {
    const wide = "MÜŞTERİ YÖNETİMİ VE PORTFÖY TAKİBİ: EMLAK OFİSİ CRM"; // 51 karakter, büyük harf
    expect(wide.length).toBeLessThan(60);
    expect(titlePixelVerdict(wide).verdict).toBe("warn");
    const narrow = "il ilçe mahalle bilgileri ile ilan listesi tüm illerde ilk iş"; // 61 karakter, dar harfler
    expect(narrow.length).toBeGreaterThan(60);
    expect(titlePixels(narrow)).toBeLessThanOrEqual(SERP_PX.titleMax);
    expect(titlePixelVerdict(narrow).verdict).toBe("ok");
  });

  it("boş başlık ve açıklama başarısız, kısa açıklama uyarı", () => {
    expect(titlePixelVerdict("").verdict).toBe("fail");
    expect(descriptionPixelVerdict(null).verdict).toBe("fail");
    expect(descriptionPixelVerdict("Kısa açıklama").verdict).toBe("warn");
  });

  it("fitToPixels sözcük sınırında keser, sondaki bağlacı atar ve sınırı aşmaz", () => {
    const out = fitToPixels("Kadıköy satılık daire ilanları ve Moda mahallesi ile çevresi için güncel fiyatlar listesi", 300, 20);
    expect(textPixelWidth(out, 20)).toBeLessThanOrEqual(300);
    expect(out).not.toMatch(/\s(ve|ile)$/);
    expect("Kadıköy satılık daire ilanları ve Moda".startsWith(out.split(" ")[0]!)).toBe(true);
    expect(fitToPixels("Kısa", 300, 20)).toBe("Kısa");
  });

  it("uzun başlık önerisi şablon ekini korur ve sınıra sığar", () => {
    const core = "Emlak ofisleri için müşteri, portföy, anlaşma ve komisyon yönetimi yazılımı fiyatları";
    const after = shortenTitleCore(core, "%s | EmlakSoft");
    expect(after).not.toBeNull();
    expect(titlePixels(`${after} | EmlakSoft`)).toBeLessThanOrEqual(SERP_PX.titleMax);
    const p = ruleSuggestion({ rule: "long-title", path: "/fiyatlar", core, template: "%s | EmlakSoft", autoAction: true });
    expect(p?.field).toBe("title");
    expect(p?.action).toEqual({ kind: "seo_meta_draft", risk: "guvenli" });
    // Zaten sığan başlık için öneri yok.
    expect(ruleSuggestion({ rule: "long-title", path: "/x", core: "Fiyatlar", template: "%s | EmlakSoft", autoAction: true })).toBeNull();
    // Eksik açıklama: kayıtlı tanımdan; çok kısa tanımdan öneri üretilmez.
    expect(ruleSuggestion({ rule: "missing-description", path: "/x", fallback: "Kısa", autoAction: true })).toBeNull();
    expect(ruleSuggestion({ rule: "missing-description", path: "/x", fallback: "Emlak ofisinizin müşteri, portföy ve anlaşma süreçlerini tek panelde yönetin; ücretsiz deneyin.", autoAction: false })?.action).toBeUndefined();
  });
});

describe("yapılandırılmış veri doğrulayıcısı", () => {
  it("RealEstateListing: fiyat sayısal ve para birimi zorunlu; görsel/adres önerilir", () => {
    const bad = validateStructuredData({ "@context": "https://schema.org", "@type": "RealEstateListing", name: "3+1 daire", url: "https://x/v/a", offers: { "@type": "Offer", price: "₺5.000.000" } });
    expect(bad.errors.some((e) => e.includes("sayısal"))).toBe(true);
    expect(bad.errors.some((e) => e.includes("priceCurrency"))).toBe(true);
    expect(bad.warnings.some((w) => w.includes("image"))).toBe(true);
    const good = validateStructuredData({
      "@context": "https://schema.org",
      "@type": "RealEstateListing",
      name: "3+1 daire",
      url: "https://x/v/a",
      image: ["https://x/i.jpg"],
      datePosted: "2026-10-01",
      offers: { "@type": "Offer", price: 5000000, priceCurrency: "TRY", availability: "https://schema.org/InStock" },
      address: { "@type": "PostalAddress", addressLocality: "Kadıköy", addressCountry: "TR" },
    });
    expect(good.errors).toEqual([]);
    expect(good.warnings).toEqual([]);
    expect(good.types).toContain("Offer");
  });

  it("RealEstateAgent/LocalBusiness önerilen alanlar; Organization logo ve sameAs", () => {
    const r = validateStructuredData({ "@context": "https://schema.org", "@graph": [{ "@type": "RealEstateAgent", name: "Ofis" }, { "@type": "Organization", name: "EmlakSoft", url: "https://x" }] });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/telephone/);
    expect(r.warnings.join(" ")).toMatch(/sameAs/);
  });

  it("SearchAction hedefi yer tutucu taşımalı; ItemList boş olamaz; yasak puan verisi hata", () => {
    const r = validateStructuredData({ "@context": "https://schema.org", "@type": "WebSite", name: "x", url: "https://x", potentialAction: { "@type": "SearchAction", target: "https://x/ara" } });
    expect(r.errors.join(" ")).toMatch(/search_term_string/);
    expect(validateStructuredData({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: [] }).errors.join(" ")).toMatch(/boş/);
    expect(validateStructuredData({ "@context": "https://schema.org", "@type": "RealEstateAgent", name: "a", aggregateRating: { ratingValue: 5 } }).errors.join(" ")).toMatch(/yasak/);
  });

  it("sayfa türüne göre beklenen tür", () => {
    expect(expectedTypesFor("/")?.types).toContain("Organization");
    expect(expectedTypesFor("/vitrin/ofis")?.types).toContain("RealEstateAgent");
    expect(expectedTypesFor("/vitrin/ofis/kadikoy-3-1-satilik-daire-1a2b3c4d5e6f")?.types).toEqual(["RealEstateListing"]);
    expect(expectedTypesFor("/vitrin/ofis/degerleme")).toBeNull();
    expect(expectedTypesFor("/emlak/istanbul/kadikoy/satilik-daire")?.types).toContain("CollectionPage");
    expect(expectedTypesFor("/fiyatlar")?.types).toEqual(["BreadcrumbList"]);
  });
});

describe("SEO optimizasyon puanı", () => {
  it("iyi sayfa yüksek puan alır; kategoriler 0-100", () => {
    const s = scorePage(snap(), ctx({ lastmod: "2026-09-20T00:00:00Z" }));
    expect(s.total).toBeGreaterThanOrEqual(90);
    for (const v of Object.values(s.categories)) if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    expect(s.perfEstimated).toBe(true); // PSI yok: tahmin
    expect(s.checks.find((c) => c.id === "ttfb")?.estimated).toBe(true);
  });

  it("2xx olmayan sayfa 0 puan, yalnız teknik kategori", () => {
    const s = scorePage(snap({ status: 404 }), ctx());
    expect(s.total).toBe(0);
    expect(s.categories.sayfaIci).toBeNull();
  });

  it("veri yoksa kategori uygulanamaz ve ağırlık dağıtılır (sahte puan yok)", () => {
    const s = scorePage(snap({ ttfbMs: null, bytes: 0 }), ctx());
    expect(s.categories.performans).toBeNull();
    expect(s.categories.tazelik).toBeNull();
    expect(combineCategories({ teknik: 100, sayfaIci: 50, yapisal: null, performans: null, tazelik: null })).toBe(75);
  });

  it("PSI puanı varsa tahmin yerine o kullanılır", () => {
    const s = scorePage(snap(), ctx({ perf: { score: 42, source: "psi" } }));
    expect(s.categories.performans).toBe(42);
    expect(s.perfEstimated).toBe(false);
  });

  it("Search Console sorgusu başlıkta yoksa kontrol düşer; Türkçe ek esnekliği", () => {
    expect(containsPhrase("Kadıköy'deki satılık daireler", "kadıköy satılık daire")).toBe(true);
    expect(containsPhrase("İstanbul emlak", "istanbul emlak")).toBe(true);
    const s = scorePage(snap({ title: "Paketler | EmlakSoft" }), ctx({ topQuery: "emlak yazılımı fiyatları" }));
    expect(s.checks.find((c) => c.id === "kw-title")?.ratio).toBe(0);
    const ok = scorePage(snap(), ctx({ topQuery: "emlak ofisi yazılımı" }));
    expect(ok.checks.find((c) => c.id === "kw-title")?.ratio).toBe(1);
  });

  it("noindex ama sitemap'te: tutarsızlık; robots engeli; yinelenen başlık", () => {
    const s = scorePage(snap({ noindex: true, robotsBlocked: true, dupTitle: true }), ctx());
    const fail = s.checks.filter((c) => c.ratio === 0).map((c) => c.id);
    expect(fail).toEqual(expect.arrayContaining(["index-sitemap", "robots", "dup-title"]));
  });

  it("site puanı ana sayfayı ağır sayar ve site geneli kritik bulgu ceza verir", () => {
    const home = scorePage(snap({ url: "https://emlaksoft.com.tr/", title: "x" }), ctx());
    const good = scorePage(snap(), ctx());
    const site = scoreSite(
      [
        { score: home, snap: { inSitemap: true, noindex: false } },
        { score: good, snap: { inSitemap: true, noindex: false } },
      ],
      [],
    )!;
    expect(site.total).toBeLessThan(Math.round((home.total + good.total) / 2));
    const penalized = scoreSite([{ score: good, snap: { inSitemap: true, noindex: false } }], ["sitemap-unreachable", "robots-unreachable"])!;
    expect(penalized.penalty).toBe(20);
    expect(penalized.total).toBe(Math.max(0, good.total - 20));
    expect(scoreSite([], [])).toBeNull();
  });

  it("neden düştü: yeni başarısız kontroller ve sıralama", () => {
    const before = toLite(scorePage(snap(), ctx()));
    const afterPage = toLite(scorePage(snap({ h1Count: 0, description: null }), ctx()));
    const drop = explainDrop([before], [afterPage]);
    expect(drop).toHaveLength(1);
    expect(drop[0]!.newlyFailed).toEqual(expect.arrayContaining(["h1", "desc-px"]));
    expect(explainDrop([before], [before])).toEqual([]);
  });

  it("vitrin puanı: onaysız ofis düşük; vitrin kapalı ofiste puan yok", () => {
    const base = { optin: true, vitrinEnabled: true, neverIndex: false, liveListings: 20, withPhotos: 20, withDescription: 20, hasPhone: true, hasAddress: true, hasLogo: true, pageScores: [90] };
    expect(scoreVitrin(base).total).toBeGreaterThanOrEqual(95);
    expect(scoreVitrin({ ...base, optin: false }).total).toBeLessThan(80);
    expect(scoreVitrin({ ...base, vitrinEnabled: false }).total).toBeNull();
    expect(scoreVitrin({ ...base, liveListings: 0, withPhotos: 0, withDescription: 0 }).checks.find((c) => c.label === "Fotoğraflı ilan oranı")?.ok).toBe(false);
  });
});

describe("tarama ek kuralları", () => {
  it("yönlendirme zinciri ve döngü", () => {
    expect(redirectLinkFinding("https://x/a", ["https://x/b"], false)).toBeNull();
    expect(redirectLinkFinding("https://x/a", ["https://x/b", "https://x/c"], false)?.code).toBe("internal-link-redirect");
    expect(redirectLinkFinding("https://x/a", ["https://x/b", "https://x/c", "https://x/d"], false)?.code).toBe("redirect-chain");
    expect(redirectLinkFinding("https://x/a", ["https://x/b", "https://x/c", "https://x/b"], true)?.severity).toBe("critical");
    expect(resolveLocation("/yeni", "https://x/eski", "https://x")).toBe("https://x/yeni");
    expect(resolveLocation("https://baska.com/y", "https://x/eski", "https://x")).toBeNull();
  });

  it("görsel kaynakları: kendi kökeni, _next/image açılır, dış ve data atlanır", () => {
    const html = `<img src="/api/property-media/1"><img src="/_next/image?url=%2Flogo.png&w=64"><img src="https://cdn.dis.com/a.jpg"><img src="data:image/png;base64,xx"><script><img src="/gizli"></script>`;
    expect(ownImageSources(html, "https://x/p", "https://x")).toEqual(["https://x/api/property-media/1", "https://x/logo.png"]);
    expect(brokenImageFinding("https://x/p", "https://x/a.png", 200)).toBeNull();
    expect(brokenImageFinding("https://x/p", "https://x/a.png", 404)?.code).toBe("broken-image");
  });

  it("anlık görüntü ekleri: h1 metni, görsel sayısı, JSON-LD türleri", () => {
    const e = extractSnapshotExtras(`<h1>Kadıköy <b>satılık</b> daire</h1><img src="a"><img src="b"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"x","url":"https://x"}</script>`);
    expect(e.h1Text).toBe("Kadıköy satılık daire");
    expect(e.imgTotal).toBe(2);
    expect(e.ldTypes).toEqual(["Organization"]);
    expect(e.ldWarnings).toBeGreaterThan(0);
  });
});
