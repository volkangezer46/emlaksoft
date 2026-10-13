import { describe, expect, it } from "vitest";
import {
  absolutizeCssUrls,
  buildStaticHome,
  purgeCss,
  requiredTokens,
  resolveSuspenseBoundaries,
  stripNextRuntime,
} from "./transform";
import { STATIC_HOME_SOURCE_HEADER, wantsStaticHome } from "./request";

const headers = (h: Record<string, string> = {}) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const params = (q: string[] = []) => ({ has: (n: string) => q.includes(n) });

describe("statik ana sayfa — istek kararı", () => {
  const base = { method: "GET", pathname: "/", searchParams: params(), headers: headers(), env: { NODE_ENV: "production" } };
  it("yalnız üretimde, kök belge isteğinde", () => {
    expect(wantsStaticHome(base)).toBe(true);
    expect(wantsStaticHome({ ...base, env: { NODE_ENV: "development" } })).toBe(false);
    expect(wantsStaticHome({ ...base, pathname: "/fiyatlar" })).toBe(false);
    expect(wantsStaticHome({ ...base, method: "POST" })).toBe(false);
  });
  it("Next istemci gezinmesi, kaynak çekimi ve kapatma bayrağı normal sayfaya gider", () => {
    expect(wantsStaticHome({ ...base, headers: headers({ rsc: "1" }) })).toBe(false);
    expect(wantsStaticHome({ ...base, headers: headers({ "next-router-prefetch": "1" }) })).toBe(false);
    expect(wantsStaticHome({ ...base, searchParams: params(["_rsc"]) })).toBe(false);
    expect(wantsStaticHome({ ...base, headers: headers({ [STATIC_HOME_SOURCE_HEADER]: "1" }) })).toBe(false);
    expect(wantsStaticHome({ ...base, env: { NODE_ENV: "production", STATIC_HOME: "off" } })).toBe(false);
  });
});

describe("statik ana sayfa — HTML dönüşümü", () => {
  it("akış sınırını gizli parçanın içeriğiyle doldurur", () => {
    const html =
      '<main><div id="x"><!--$?--><template id="B:0"></template><p>yükleniyor</p><!--/$--></div></main>' +
      '<script>$RC("B:0","S:0")</script><div hidden id="S:0"><div class="kart"><div>iç</div></div></div></body>';
    const out = resolveSuspenseBoundaries(html);
    expect(out).toContain('<div id="x"><div class="kart"><div>iç</div></div></div>');
    expect(out).not.toContain('id="S:0"');
    expect(out).not.toContain("yükleniyor");
  });

  it("Next çalışma zamanını ayıklar, JSON-LD / speculationrules / sitenin küçük betiklerini korur", () => {
    const html = [
      '<head><link rel="stylesheet" href="/_next/static/chunks/a.css" data-precedence="next"/>',
      '<link rel="preload" as="script" href="/_next/static/chunks/x.js"/><link rel="preload" as="font" href="/f.woff2"/></head>',
      '<body><!--$--><p>metin<!-- -->2</p><!--/$-->',
      '<script src="/_next/static/chunks/x.js" async=""></script>',
      '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
      '<script>requestAnimationFrame(function(){$RT=performance.now()});</script>',
      '<script type="application/ld+json">{"a":1}</script><script type="speculationrules">{}</script>',
      "<script>try{localStorage}catch(e){}</script></body>",
    ].join("");
    const { html: out, stylesheets } = stripNextRuntime(html);
    expect(stylesheets).toEqual(["/_next/static/chunks/a.css"]);
    expect(out).not.toMatch(/_next\/static|__next_f|\$RT|<!--/);
    expect(out).toContain('as="font"');
    expect(out).toContain("application/ld+json");
    expect(out).toContain("speculationrules");
    expect(out).toContain("try{localStorage}");
    expect(out).toContain("<p>metin2</p>");
  });

  it("CSS: kullanılmayan sınıf kurallarını ve değişkenleri atar, kullanılanları ve korunan önekleri tutar", () => {
    const css = [
      ":root{--used:1px;--unused:2px;--chain:var(--used)}",
      ".a{margin:var(--chain)}.b{color:red}.md\\:flex{display:flex}",
      "@media (min-width:1px){.b{color:blue}.a{color:green}}",
      ".x:not(.yok){color:red}.mk-sheet{display:block}#kim{top:0}",
      "@keyframes k{0%{opacity:0}to{opacity:1}}@property --tw-a{syntax:'*';inherits:false}@property --tw-b{syntax:'*';inherits:false}",
      ".c{--tw-a:1;transform:var(--tw-a)}",
    ].join("");
    const out = purgeCss(css, '<div class="a md:flex x c" id="kim"></div>', { keepPrefixes: ["mk-sheet"] });
    expect(out).toContain(".a{");
    expect(out).toContain(".md\\:flex");
    expect(out).toContain(".x:not(.yok)");
    expect(out).toContain(".mk-sheet");
    expect(out).toContain("#kim");
    expect(out).toContain("@keyframes k");
    expect(out).toContain("--used:1px");
    expect(out).toContain("@property --tw-a");
    expect(out).not.toContain(".b{");
    expect(out).not.toContain("--unused");
    expect(out).not.toContain("--tw-b");
  });

  it("zorunlu belirteçler: :not/:where içi ve nitelik seçicileri zorunlu sayılmaz", () => {
    expect(requiredTokens(".a:where(.b) .c[data-x='.y']:not(.d)")).toEqual({ classes: ["a", "c"], ids: [] });
    expect(requiredTokens(".h-3\\.5")).toEqual({ classes: ["h-3.5"], ids: [] });
    expect(requiredTokens(".min-h-\\[58rem\\]")).toEqual({ classes: ["min-h-[58rem]"], ids: [] });
    expect(requiredTokens(".lg\\:min-h-\\[34rem\\]:hover[data-x]")).toEqual({ classes: ["lg:min-h-[34rem]"], ids: [] });
  });

  it("gömülen CSS'teki göreli adresler stil dosyasına göre mutlak olur", () => {
    const css = "@font-face{src:url(../media/inter.woff2) format('woff2')}.a{background:url(data:image/png;base64,AA)}.b{background:url('/x.png')}";
    const out = absolutizeCssUrls(css, "/_next/static/chunks/a.css");
    expect(out).toContain("url(/_next/static/media/inter.woff2)");
    expect(out).toContain("url(data:image/png;base64,AA)");
    expect(out).toContain("url('/x.png')");
  });

  it("tam dönüşüm: stil gömülür, gövde sonuna betik eklenir; beklenmeyen biçimde null", () => {
    const html = '<html><head><link rel="stylesheet" href="/_next/static/chunks/a.css"/></head><body><p class="a">x</p></body></html>';
    const out = buildStaticHome({ html, readStylesheet: () => ".a{color:red}.b{color:blue}", purge: {}, bodyEnd: "<script>1</script>" });
    expect(out).toBe('<html><head><style>.a{color:red}</style></head><body><p class="a">x</p><script>1</script></body></html>');
    expect(buildStaticHome({ html, readStylesheet: () => null, purge: {}, bodyEnd: "" })).toBeNull();
    expect(buildStaticHome({ html: "<html><body>stil yok</body></html>", readStylesheet: () => "", purge: {}, bodyEnd: "" })).toBeNull();
  });
});
