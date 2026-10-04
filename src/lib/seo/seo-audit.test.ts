import { describe, expect, it } from "vitest";
import { auditPage, extractFacts, findDuplicates, isDisallowedByRobots, resolveInternalLink, shouldNotify, summarize, worsened } from "./audit-rules";

const ORIGIN = "https://emlaksoft.vercel.app";

const goodHtml = (over: { title?: string; desc?: string; extra?: string; robots?: string; h1?: string; canonical?: string } = {}) => `<!doctype html><html lang="tr"><head>
<title>${over.title ?? "Fiyatlar | EmlakSoft"}</title>
<meta name="description" content="${over.desc ?? "EmlakSoft paketleri, aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile özellik karşılaştırması."}">
<link rel="canonical" href="${over.canonical ?? `${ORIGIN}/fiyatlar`}">
${over.robots ? `<meta name="robots" content="${over.robots}">` : ""}
<meta property="og:title" content="EmlakSoft Fiyatlar"><meta property="og:image" content="${ORIGIN}/opengraph-image">
${over.extra ?? ""}
</head><body>${over.h1 ?? "<h1>Fiyatlar</h1>"}<a href="/demo">Demo</a><a href="mailto:a@b.c">m</a></body></html>`;

const facts = (html: string, url = `${ORIGIN}/fiyatlar`, status = 200) => extractFacts(url, status, html);
const codes = (html: string, inSitemap = true, url = `${ORIGIN}/fiyatlar`) => auditPage(facts(html, url), ORIGIN, { inSitemap }).map((f) => f.code);

describe("robot denetim kuralları (sahte HTML örnekleri)", () => {
  it("kusursuz sayfada bulgu yok", () => {
    expect(codes(goodHtml())).toEqual([]);
  });
  it("eksik title kritik", () => {
    const f = auditPage(facts(goodHtml().replace(/<title>[\s\S]*?<\/title>/, "")), ORIGIN, { inSitemap: true });
    expect(f.find((x) => x.code === "missing-title")?.severity).toBe("critical");
  });
  it("uzun başlık, eksik açıklama, eksik canonical, eksik OG görseli, h1 yok", () => {
    expect(codes(goodHtml({ title: "x".repeat(80) }))).toContain("long-title");
    expect(codes(goodHtml().replace(/<meta name="description"[^>]*>/, ""))).toContain("missing-description");
    expect(codes(goodHtml().replace(/<link rel="canonical"[^>]*>/, ""))).toContain("missing-canonical");
    expect(codes(goodHtml().replace(/<meta property="og:image"[^>]*>/, ""))).toContain("missing-og-image");
    expect(codes(goodHtml({ h1: "" }))).toContain("missing-h1");
    expect(codes(goodHtml({ h1: "<h1>a</h1><h1>b</h1>" }))).toContain("multiple-h1");
  });
  it("canonical göreli, farklı alan adı (www/apex) ve farklı adres", () => {
    expect(codes(goodHtml({ canonical: "/fiyatlar" }))).toContain("relative-canonical");
    const host = auditPage(facts(goodHtml({ canonical: "https://www.emlaksoft.vercel.app/fiyatlar" })), ORIGIN, { inSitemap: true });
    expect(host.find((x) => x.code === "canonical-host-mismatch")?.severity).toBe("critical");
    expect(codes(goodHtml({ canonical: `${ORIGIN}/demo` }))).toContain("canonical-mismatch");
  });
  it("noindex sayfa sitemap'teyse kritik çelişki; sitemap dışındaysa bulgu yok", () => {
    const html = goodHtml({ robots: "noindex, follow" });
    expect(auditPage(facts(html), ORIGIN, { inSitemap: true }).find((x) => x.code === "noindex-in-sitemap")?.severity).toBe("critical");
    expect(codes(html, false)).not.toContain("noindex-in-sitemap");
  });
  it("X-Robots-Tag noindex başlığı da yakalanır", () => {
    const f = extractFacts(`${ORIGIN}/fiyatlar`, 200, goodHtml(), { xRobotsTag: "noindex" });
    expect(f.noindex).toBe(true);
  });
  it("sitemap'te 404 kritik, yönlendirme uyarı", () => {
    const f404 = auditPage(facts("", `${ORIGIN}/yok`, 404), ORIGIN, { inSitemap: true });
    expect(f404.map((x) => [x.code, x.severity])).toEqual([["http-error", "critical"]]);
    const f308 = auditPage(facts("", `${ORIGIN}/eski`, 308), ORIGIN, { inSitemap: true });
    expect(f308.map((x) => [x.code, x.severity])).toEqual([["sitemap-redirect", "warning"]]);
  });
  it("JSON-LD: bozuk blok, eksik alan ve sahte AggregateRating yakalanır", () => {
    expect(codes(goodHtml({ extra: `<script type="application/ld+json">{bozuk</script>` }))).toContain("jsonld-parse");
    expect(codes(goodHtml({ extra: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>` }))).toContain("jsonld-fields");
    const forbidden = auditPage(
      facts(goodHtml({ extra: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"a","url":"b","aggregateRating":{"ratingValue":"5"}}</script>` })),
      ORIGIN,
      { inSitemap: true },
    );
    expect(forbidden.find((x) => x.code === "jsonld-forbidden")?.severity).toBe("critical");
  });
  it("script içindeki h1 metni sayılmaz", () => {
    expect(facts(goodHtml({ extra: `<script>var x = "<h1>sahte</h1>";</script>` })).h1Count).toBe(1);
  });
  it("yinelenen title ve description sayfalar arası yakalanır", () => {
    const a = facts(goodHtml(), `${ORIGIN}/a`);
    const b = facts(goodHtml(), `${ORIGIN}/b`);
    const c = facts(goodHtml({ title: "Başka | EmlakSoft", desc: "Başka açıklama" }), `${ORIGIN}/c`);
    const dup = findDuplicates([a, b, c]);
    expect(dup.filter((d) => d.code === "duplicate-title").map((d) => d.url).sort()).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`]);
    expect(dup.some((d) => d.code === "duplicate-description")).toBe(true);
    expect(dup.some((d) => d.url === `${ORIGIN}/c`)).toBe(false);
  });
});

describe("robots.txt tutarlılığı", () => {
  const txt = "User-Agent: *\nAllow: /\nDisallow: /app/\nDisallow: /vitrin/*/favoriler\nDisallow: /ozel$\n\nUser-Agent: GPTBot\nDisallow: /\n";
  it("* grubundaki kurallar uygulanır; yapay zekâ grubu diğerlerini etkilemez", () => {
    expect(isDisallowedByRobots(txt, "/app/musteriler")).toBe(true);
    expect(isDisallowedByRobots(txt, "/fiyatlar")).toBe(false);
    expect(isDisallowedByRobots(txt, "/vitrin/ofis/favoriler")).toBe(true);
    expect(isDisallowedByRobots(txt, "/ozel")).toBe(true);
    expect(isDisallowedByRobots(txt, "/ozel-sayfa")).toBe(false);
  });
  it("Allow daha uzun eşleşirse Disallow'u yener", () => {
    expect(isDisallowedByRobots("User-Agent: *\nDisallow: /a/\nAllow: /a/acik", "/a/acik")).toBe(false);
  });
});

describe("iç bağlantı seçimi ve özet", () => {
  it("yalnız aynı host, korumalı/dosya olmayan bağlantılar denetlenir (harici site YOK)", () => {
    expect(resolveInternalLink("/demo", `${ORIGIN}/`, ORIGIN)).toBe(`${ORIGIN}/demo`);
    expect(resolveInternalLink("fiyatlar?x=1#y", `${ORIGIN}/`, ORIGIN)).toBe(`${ORIGIN}/fiyatlar`);
    expect(resolveInternalLink("https://baska.example/x", `${ORIGIN}/`, ORIGIN)).toBeNull();
    expect(resolveInternalLink("/app/musteriler", `${ORIGIN}/`, ORIGIN)).toBeNull();
    expect(resolveInternalLink("/malik-portali/abc", `${ORIGIN}/`, ORIGIN)).toBeNull();
    expect(resolveInternalLink("/logo.png", `${ORIGIN}/`, ORIGIN)).toBeNull();
    expect(resolveInternalLink("mailto:a@b.c", `${ORIGIN}/`, ORIGIN)).toBeNull();
  });
  it("özet ve bildirim eşiği", () => {
    const s = summarize(
      [
        { code: "a", severity: "critical", url: "u", message: "m", fix: "f" },
        { code: "b", severity: "warning", url: "u", message: "m", fix: "f" },
      ],
      10,
      5,
    );
    expect(s).toEqual({ critical: 1, warning: 1, info: 0, pagesChecked: 10, linksChecked: 5 });
    expect(shouldNotify(s)).toBe(true);
    expect(shouldNotify({ ...s, critical: 0, warning: 9 })).toBe(false);
    expect(shouldNotify({ ...s, critical: 0, warning: 10 })).toBe(true);
  });
  it("günlük bildirim tekrarı yok: yalnız kötüleşme ya da yeni eşik aşımı bildirir", () => {
    const base = { critical: 0, warning: 0, info: 0, pagesChecked: 10, linksChecked: 0 };
    expect(worsened(null, { ...base, critical: 1 })).toBe(true);
    expect(worsened({ ...base, critical: 1 }, { ...base, critical: 1 })).toBe(false);
    expect(worsened({ ...base, critical: 1 }, { ...base, critical: 2 })).toBe(true);
    expect(worsened({ ...base, critical: 1 }, base)).toBe(false);
    expect(worsened(base, { ...base, critical: 1 })).toBe(true);
  });
});
