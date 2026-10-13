import { describe, expect, it } from "vitest";
import {
  auditPageDeep,
  classifyOgImage,
  extractDeepFacts,
  extractFacts,
  findOrphans,
  ogImageFinding,
  type PageFacts,
} from "./audit-rules";
import { discoveryFindings, followableUrl, inboundLinks, nextFrontier, urlKey } from "./discovery";
import { checkSeoPublishable } from "./publish-gate";
import { ogTitleFromTitle, ruleSuggestion, shortenAtWord } from "./rule-suggest";
import { canAutoOptimize, isManualOnly, isOutOfScope, normalizeUrlForFingerprint } from "./scope";
import { DEFAULT_SITEMAP } from "./schema";
import { historyHeadAt, latestIso, renderUrlset, staticSitemapEntries } from "./sitemap-rules";
import { SEO_THRESHOLDS } from "./thresholds";
import { affectedUrls } from "./after-publish-hook";
import { indexNowEligible } from "./indexnow-events";

const ORIGIN = "https://emlaksoft.com.tr";
const URL1 = `${ORIGIN}/fiyatlar`;

const words = (n: number) => Array.from({ length: n }, (_, i) => `kelime${i}`).join(" ");
const page = (body: string, head = "<title>Fiyatlar | EmlakSoft</title><meta name=\"description\" content=\"Açıklama\">") =>
  `<!doctype html><html lang="tr"><head>${head}</head><body>${body}</body></html>`;

const deep = (html: string, timing: { rawBytes?: number; ttfbMs?: number | null } = {}, url = URL1) => extractDeepFacts(url, html, ORIGIN, timing);
const codes = (html: string, opts: { inSitemap?: boolean; timing?: { rawBytes?: number; ttfbMs?: number | null }; url?: string } = {}) => {
  const url = opts.url ?? URL1;
  const facts = extractFacts(url, 200, html);
  return auditPageDeep(facts, deep(html, opts.timing, url), { inSitemap: opts.inSitemap ?? true }).map((f) => f.code);
};
const rich = (extra = "") => page(`<h1>Fiyatlar</h1><h2>Paketler</h2><p>${words(300)}</p>${extra}`);

describe("genişletilmiş kurallar: her biri pozitif + negatif", () => {
  it("temiz sayfada ek bulgu yok", () => {
    expect(codes(rich(), { timing: { ttfbMs: 120 } })).toEqual([]);
  });
  it("img-missing-alt: alt özniteliği yoksa uyarı; alt=\"\" (süs) bulgu değil", () => {
    expect(codes(rich('<img src="/a.png">'))).toContain("img-missing-alt");
    expect(codes(rich('<img src="/a.png" alt=""><img src="/b.png" alt="Ofis">'))).not.toContain("img-missing-alt");
  });
  it("heading-skip: h2'den h4'e atlama; sıralı başlıklar temiz", () => {
    expect(codes(rich("<h4>Alt</h4>"))).toContain("heading-skip");
    expect(deep(rich("<h4>x</h4>")).headingSkip).toBe("h2→h4");
    expect(codes(rich("<h3>Alt</h3><h2>Yeni</h2>"))).not.toContain("heading-skip");
  });
  it("thin-content: sitemap'teki indekslenebilir sayfada <250 sözcük; sitemap dışı ya da noindex sayfada yok", () => {
    const thin = page(`<h1>Kısa</h1><p>${words(40)}</p>`);
    expect(codes(thin)).toContain("thin-content");
    expect(codes(thin, { inSitemap: false })).not.toContain("thin-content");
    expect(codes(page(`<h1>Kısa</h1><p>${words(40)}</p>`, '<title>x</title><meta name="robots" content="noindex">'))).not.toContain("thin-content");
    expect(codes(rich())).not.toContain("thin-content");
  });
  it("script/style içindeki metin sözcük sayılmaz", () => {
    expect(deep(page(`<script>${words(500)}</script><style>.a{}</style><p>bir iki</p>`)).wordCount).toBe(2);
  });
  it("slow-ttfb: eşik üstü uyarı; eşik altı ve ölçülmemiş temiz", () => {
    expect(codes(rich(), { timing: { ttfbMs: SEO_THRESHOLDS.slowTtfbMs + 1 } })).toContain("slow-ttfb");
    expect(codes(rich(), { timing: { ttfbMs: SEO_THRESHOLDS.slowTtfbMs } })).not.toContain("slow-ttfb");
    expect(codes(rich(), { timing: { ttfbMs: null } })).not.toContain("slow-ttfb");
  });
  it("html-too-large: ham >300 KB uyarı; altı temiz", () => {
    expect(codes(rich(), { timing: { rawBytes: SEO_THRESHOLDS.htmlTooLargeBytes + 1 } })).toContain("html-too-large");
    expect(codes(rich(), { timing: { rawBytes: 20_000 } })).not.toContain("html-too-large");
  });
  it("meta-not-in-head: title/description </head> sonrasında (akışlı metadata) bulgu; <head> içinde temiz", () => {
    const streamed = `<html><head><meta charset="utf-8"></head><body><h1>x</h1><p>${words(300)}</p><title>Geç</title><meta name="description" content="geç"></body></html>`;
    expect(codes(streamed)).toContain("meta-not-in-head");
    expect(codes(rich())).not.toContain("meta-not-in-head");
  });
  it("internal-link-nofollow: iç bağlantıda nofollow uyarı; dış bağlantıda nofollow serbest", () => {
    expect(codes(rich('<a href="/kayit" rel="nofollow">Kayıt</a>'))).toContain("internal-link-nofollow");
    expect(codes(rich('<a href="https://baska.example/x" rel="nofollow sponsored">Dış</a>'))).not.toContain("internal-link-nofollow");
  });
  it("mixed-content: https sayfada http kaynak kritik; https kaynak temiz", () => {
    expect(codes(rich('<img src="http://cdn.example/a.png" alt="a">'))).toContain("mixed-content");
    expect(codes(rich('<script src="http://cdn.example/a.js"></script>'))).toContain("mixed-content");
    expect(codes(rich('<img src="https://cdn.example/a.png" alt="a"><a href="http://eski.example">bağlantı</a>'))).not.toContain("mixed-content");
  });
  it("og-image: kendi kökenimizde erişilemiyorsa uyarı, erişilebilirse yok; dış görsel yalnız bilgi ve ÇEKİLMEZ", () => {
    expect(classifyOgImage(`${ORIGIN}/og.png`, URL1, ORIGIN)).toEqual({ kind: "own", url: `${ORIGIN}/og.png` });
    expect(classifyOgImage("/og.png", URL1, ORIGIN)).toEqual({ kind: "own", url: `${ORIGIN}/og.png` });
    expect(classifyOgImage("https://cdn.baska.example/og.png", URL1, ORIGIN)).toEqual({ kind: "external" });
    expect(classifyOgImage(null, URL1, ORIGIN)).toBeNull();
    expect(ogImageFinding(URL1, "own", 404)?.code).toBe("og-image-unreachable");
    expect(ogImageFinding(URL1, "own", 0)?.code).toBe("og-image-unreachable");
    expect(ogImageFinding(URL1, "own", 200)).toBeNull();
    const ext = ogImageFinding(URL1, "external", null);
    expect(ext?.severity).toBe("info");
    expect(ext?.message).toContain("Dış OG görseli (denetlenmedi)");
  });
  it("orphan-page: hiçbir sayfadan bağlantı almayan sitemap sayfası; bağlantı alan ve ana sayfa bulgu değil", () => {
    const inbound = new Map<string, Set<string>>([[urlKey(`${ORIGIN}/fiyatlar`), new Set([`${ORIGIN}/`])]]);
    const found = findOrphans([`${ORIGIN}`, `${ORIGIN}/fiyatlar`, `${ORIGIN}/gizlilik`], inbound, ORIGIN);
    expect(found.map((f) => f.url)).toEqual([`${ORIGIN}/gizlilik`]);
    // Yalnız kendine bağlantı veren sayfa da yetimdir.
    const self = new Map<string, Set<string>>([[urlKey(`${ORIGIN}/gizlilik`), new Set([`${ORIGIN}/gizlilik`])]]);
    expect(findOrphans([`${ORIGIN}/gizlilik`], self, ORIGIN)).toHaveLength(1);
  });
  it("2xx olmayan sayfada ek kural çalışmaz", () => {
    const f = extractFacts(URL1, 404, "");
    expect(auditPageDeep(f, deep(""), { inSitemap: true })).toEqual([]);
  });
});

describe("keşif taraması: YALNIZ aynı köken (G3)", () => {
  it("dış alan adı, özel ağ adresleri, farklı şema/port ve kimlik bilgili adres izlenmez", () => {
    for (const href of [
      "https://baska.example/x",
      "http://127.0.0.1/admin",
      "http://localhost:3000/",
      "http://10.0.0.5/ic",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://emlaksoft.com.tr/fiyatlar",
      "https://emlaksoft.com.tr:8443/fiyatlar",
      "https://www.emlaksoft.com.tr/fiyatlar",
      "https://kullanici:sifre@emlaksoft.com.tr/fiyatlar",
      "//baska.example/x",
      "javascript:alert(1)",
      "mailto:a@b.c",
    ]) {
      expect(followableUrl(href, URL1, ORIGIN), href).toBeNull();
    }
  });
  it("aynı köken: sorgu ve parça atılır; göreli adres çözülür", () => {
    expect(followableUrl("/araclar?utm=1#x", URL1, ORIGIN)).toBe(`${ORIGIN}/araclar`);
    expect(followableUrl("gizlilik", `${ORIGIN}/`, ORIGIN)).toBe(`${ORIGIN}/gizlilik`);
  });
  it("kapsam dışı yollar ve dosyalar izlenmez", () => {
    for (const p of ["/app/musteriler", "/admin", "/giris", "/kayit/tamamla", "/sifre-yenile", "/auth/callback", "/malik-portali/abc", "/logo.png", "/_next/static/a.js"]) {
      expect(followableUrl(p, URL1, ORIGIN), p).toBeNull();
    }
  });
  it("nextFrontier sayfa başı ve toplam bütçeye uyar, bilineni tekrar etmez", () => {
    const pages = [{ url: `${ORIGIN}/`, status: 200, links: ["/a", "/b", "/c", "/fiyatlar", "https://baska.example/z"] }];
    const known = new Set([urlKey(`${ORIGIN}/fiyatlar`)]);
    expect(nextFrontier(pages, known, ORIGIN, { perPage: 2, budget: 10 })).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`]);
    expect(nextFrontier(pages, known, ORIGIN, { perPage: 5, budget: 1 })).toEqual([`${ORIGIN}/a`]);
  });
  it("keşif bulguları: indekslenebilir sitemap dışı sayfa kritik; noindex/canonical başka sayfa ise yok", () => {
    const mk = (url: string, html: string): PageFacts => extractFacts(url, 200, html);
    const home = mk(`${ORIGIN}/`, page('<a href="/gizli-kampanya">k</a><a href="/noindex-sayfa">n</a>'));
    const hidden = mk(`${ORIGIN}/gizli-kampanya`, page("<h1>Kampanya</h1>"));
    const noidx = mk(`${ORIGIN}/noindex-sayfa`, page("<h1>x</h1>", '<title>x</title><meta name="robots" content="noindex">'));
    const canon = mk(`${ORIGIN}/kopya`, page("<h1>x</h1>", `<title>x</title><link rel="canonical" href="${ORIGIN}/fiyatlar">`));
    const pages = [home, hidden, noidx, canon];
    const found = discoveryFindings({ pages, sitemapKeys: new Set([urlKey(`${ORIGIN}/`)]), inbound: inboundLinks(pages, ORIGIN) });
    expect(found.filter((f) => f.code === "indexable-not-in-sitemap").map((f) => [f.url, f.severity])).toEqual([[`${ORIGIN}/gizli-kampanya`, "critical"]]);
    expect(found.filter((f) => f.code === "noindex-linked-from-index").map((f) => [f.url, f.severity])).toEqual([[`${ORIGIN}/noindex-sayfa`, "info"]]);
    const inSitemap = discoveryFindings({ pages: [hidden], sitemapKeys: new Set([urlKey(hidden.url)]), inbound: new Map() });
    expect(inSitemap).toEqual([]);
  });
});

describe("kapsam sözleşmesi (S0)", () => {
  it("üyelik/oturum ve panel yolları otomatik iyileştirilmez", () => {
    for (const p of ["/kayit", "/kayit/tamamla", "/giris", "/admin", "/app", "/app/musteriler", "/sifre-yenile", "/auth/callback", "/vitrin/demo", "/danisman/ali"]) {
      expect(canAutoOptimize(p), p).toBe(false);
      expect(isManualOnly(`${ORIGIN}${p}`), p).toBe(true);
    }
    for (const p of ["/", "/fiyatlar", "/araclar", "/gizlilik"]) expect(canAutoOptimize(p), p).toBe(true);
  });
  it("kapsam dışı: /kayit kapsam içidir (public) ama /kayit/tamamla değildir", () => {
    expect(isOutOfScope("/kayit")).toBe(false);
    expect(isOutOfScope("/kayit/tamamla")).toBe(true);
    expect(isOutOfScope("/sifre-yenile")).toBe(true);
  });
  it("parmak izi normalleştirme: Kokpit parmak izleriyle aynı (yalnız yol; köken, sorgu, parça ve sondaki / atılır)", () => {
    expect(normalizeUrlForFingerprint("https://EmlakSoft.com.tr/fiyatlar/?a=1#b")).toBe("/fiyatlar");
    expect(normalizeUrlForFingerprint("https://emlaksoft.com.tr/")).toBe("/");
  });
});

describe("gerçek lastmod sözleşmesi", () => {
  const BASE = ORIGIN;
  const byPath = (entries: ReturnType<typeof staticSitemapEntries>) => new Map(entries.map((e) => [new URL(e.url).pathname || "/", e]));
  it("yayın geçmişi yoksa <lastmod> YOK (sahte 'bugün' yazılmaz)", () => {
    const entries = staticSitemapEntries(BASE, {}, DEFAULT_SITEMAP, {});
    expect(entries.every((e) => e.lastModified === undefined)).toBe(true);
    expect(renderUrlset(entries)).not.toContain("<lastmod>");
  });
  it("geçmiş varsa değer son canlı girdinin `at` değeri; override daha yeniyse o", () => {
    const at = "2026-09-01T08:00:00.000Z";
    const m = byPath(staticSitemapEntries(BASE, {}, DEFAULT_SITEMAP, { "/": at, "/fiyatlar": at }));
    expect(m.get("/")?.lastModified).toBe(at);
    expect(m.get("/fiyatlar")?.lastModified).toBe(at);
    expect(m.get("/gizlilik")?.lastModified).toBeUndefined();
    const newer = "2026-10-01T10:00:00.000Z";
    const m2 = byPath(staticSitemapEntries(BASE, { "/fiyatlar": { title: "x", updatedAt: newer } }, DEFAULT_SITEMAP, { "/fiyatlar": at }));
    expect(m2.get("/fiyatlar")?.lastModified).toBe(newer);
  });
  it("historyHeadAt: en yeni başta; bozuk/boş geçmiş undefined", () => {
    expect(historyHeadAt(JSON.stringify([{ id: "a", at: "2026-09-02T00:00:00.000Z", label: "x", cfg: {} }, { id: "b", at: "2026-08-01T00:00:00.000Z" }]))).toBe("2026-09-02T00:00:00.000Z");
    expect(historyHeadAt(null)).toBeUndefined();
    expect(historyHeadAt("[]")).toBeUndefined();
    expect(historyHeadAt("{bozuk")).toBeUndefined();
    expect(historyHeadAt(JSON.stringify([{ at: "tarih değil" }]))).toBeUndefined();
    expect(latestIso(undefined, null, "")).toBeUndefined();
  });
});

describe("kural önerileri (AI'sız, deterministik)", () => {
  const kayit =
    "Ofisinizi birkaç dakikada kurun, 14 gün ücretsiz deneyin; kredi kartı gerekmez. İsterseniz örnek müşteri, portföy ve anlaşmalarla dolu başlayın, tek tuşla gerçek kullanıma geçin.";
  it("long-description sözcük sınırında ≤155 karaktere kısalır ve aynı girdi aynı çıktıyı verir", () => {
    const out = shortenAtWord(kayit);
    expect(out.length).toBeLessThanOrEqual(SEO_THRESHOLDS.suggestDescriptionMax);
    expect(kayit.startsWith(out.replace(/\.$/, ""))).toBe(true);
    expect(shortenAtWord(kayit)).toBe(out);
    expect(shortenAtWord("Kısa açıklama.")).toBe("Kısa açıklama.");
  });
  it("manualOnly bulguda öneri var ama eylem yok", () => {
    const manual = ruleSuggestion({ rule: "long-description", path: "/kayit", description: kayit, autoAction: false });
    expect(manual?.rule).toBe("long-description");
    expect(manual?.action).toBeUndefined();
    const auto = ruleSuggestion({ rule: "long-description", path: "/fiyatlar", description: kayit, autoAction: true });
    expect(auto?.action).toEqual({ kind: "seo_meta_draft", risk: "guvenli" });
  });
  it("missing-og-title başlıktan türetilir; marka tek kez", () => {
    expect(ogTitleFromTitle("Fiyatlar | EmlakSoft", "EmlakSoft")).toBe("Fiyatlar | EmlakSoft");
    expect(ogTitleFromTitle("Gizlilik Politikası", "EmlakSoft")).toBe("Gizlilik Politikası | EmlakSoft");
  });
  it("redirect_404 mevcut not-found-suggest sonucunu kullanır", () => {
    const p = ruleSuggestion({ rule: "redirect_404", path: "/fiyat", candidates: ["/fiyatlar", "/araclar"] });
    expect(p?.after).toBe("/fiyatlar");
    expect(ruleSuggestion({ rule: "redirect_404", path: "/tamamen-alakasiz-uzun-yol", candidates: ["/fiyatlar"] })).toBeNull();
  });
});

describe("yayın kapısı (checkSeoPublishable)", () => {
  it("temiz sayfa geçer", () => {
    const r = checkSeoPublishable({ html: rich('<a href="/fiyatlar">f</a>'), url: URL1, origin: ORIGIN, knownPaths: new Set(["/fiyatlar"]) });
    expect(r.ok).toBe(true);
  });
  it("başlıksız, çift H1, çözülmeyen iç bağlantı ve noindex+sitemap durdurur; uzunluk/alt metin yalnız uyarı", () => {
    const html = page(`<h1>a</h1><h1>b</h1><img src="/x.png"><a href="/yok-sayfa">y</a>`, `<title></title><meta name="description" content="${"a".repeat(200)}">`);
    const r = checkSeoPublishable({ html, url: URL1, origin: ORIGIN, knownPaths: new Set(["/fiyatlar"]), fields: { inSitemap: true, noindex: true } });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code).sort()).toEqual(["missing-title", "multiple-h1", "noindex-in-sitemap", "unresolved-link"]);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["long-description", "img-missing-alt"]));
  });
});

describe("IndexNow ve yayın sonrası adres seçimi", () => {
  const sitemapPaths = new Set(["/", "/fiyatlar", "/kayit", "/vitrin/demo"]);
  it("yalnız aynı köken + canAutoOptimize + indekslenebilir (sitemap'te) adresler gönderilir", () => {
    const out = indexNowEligible(
      [`${ORIGIN}/fiyatlar`, `${ORIGIN}/fiyatlar/`, `${ORIGIN}/kayit`, `${ORIGIN}/vitrin/demo`, `${ORIGIN}/gizlilik`, "https://baska.example/fiyatlar", `${ORIGIN}/app`, "/"],
      ORIGIN,
      sitemapPaths,
    );
    expect(out).toEqual([`${ORIGIN}/fiyatlar`, ORIGIN]);
  });
  it("affectedUrls kapsam dışı yolları atar", () => {
    expect(affectedUrls(["/", "/fiyatlar", "/app/x", "//baska", "/kayit/tamamla"], ORIGIN)).toEqual([ORIGIN, `${ORIGIN}/fiyatlar`]);
  });
});
