import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HERO_MQ, HERO_SWAP_SCRIPT, LAZY_STORE_ID, LAZY_SVG_ATTR, crawlKey, deferHomeDom, idSafeGroups, matchTagEnd } from "./lazy-dom";
import { buildStaticHome, stripNextRuntime } from "./transform";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const goldenLines = (rel: string) => read(rel).split("\n").filter((l) => l.trim() !== "");

/**
 * Golden çıktılarından (site-menu çerçevesi + ana sayfa bölümleri) bir ana sayfa gövdesi kurar. Golden'lar kendi
 * testlerinde kilitli olduğu için bu bileşim gerçek işaretlemeyi izler: bölüm büyürse ya da diyetin yakaladığı sınıflar
 * değişirse buradaki sayım testi kırılır.
 */
function composedHome(): string {
  const [footer, , header] = goldenLines("src/lib/site-menu/__golden__/frame-default.html");
  const sync = goldenLines("src/lib/site-content/__golden__/landing-sync-deneme-var.html").join("");
  const async = goldenLines("src/lib/site-content/__golden__/landing-async.html").join("");
  const html = `<html><head></head><body class="x"><div class="mk">${header}<main id="main-content">${sync}${async}</main>${footer}</div></body></html>`;
  return stripNextRuntime(html).html;
}

/** `<template>` içeriği belge ağacına girmez: tarayıcıdaki `document.body.querySelectorAll("*").length` ile aynı sayım. */
function countBodyElements(html: string): number {
  let s = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, "<$1$2></$1>");
  for (let i = s.indexOf("<template"); i >= 0; i = s.indexOf("<template", i + 1)) {
    const openEnd = s.indexOf(">", i) + 1;
    const end = matchTagEnd(s, "template", openEnd);
    s = s.slice(0, openEnd) + s.slice(end - "</template>".length);
  }
  return (s.match(/<[a-zA-Z][\w:-]*/g) ?? []).length - 1;
}

/** Çalışma zamanının yapacağını dize üzerinde yapar: tüm şablonları yerine koyar, SVG deposunu boşaltır, hero betiklerini siler. */
function restoreAll(html: string): string {
  let out = html.replaceAll(`<script>${HERO_SWAP_SCRIPT}</script>`, "");
  const storeRe = new RegExp(`<template id="${LAZY_STORE_ID}">([\\s\\S]*?)</template>(?=</body>)`);
  const store = storeRe.exec(out)?.[1] ?? "";
  out = out.replace(storeRe, "");
  const parts: string[] = [];
  for (let i = store.indexOf("<svg>"); i >= 0; ) {
    const end = matchTagEnd(store, "svg", i + 5);
    parts.push(store.slice(i + 5, end - "</svg>".length));
    i = store.indexOf("<svg>", end);
  }
  out = out.replace(new RegExp(`\\s${LAZY_SVG_ATTR}="(\\d+)"></svg>`, "g"), (_, n: string) => `>${parts[Number(n)]}</svg>`);
  return out.replace(/<template (?:data-mk-lazy="[a-z]+"|data-mq="[^"]+")>([\s\S]*?)<\/template>/g, "$1");
}

describe("statik ana sayfa — DOM diyeti (lazy-dom)", () => {
  it("hero medya sorguları marketing.css kırılımıyla birebir", () => {
    const css = read("src/app/marketing.css");
    expect(css).toMatch(/\.mk-ml, \.mk-hero-lead-m, \.mk-mscene, \.mk-login-m \{ display: none; \}/);
    const block = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(block).toMatch(/^@media \(max-width: 767px\) \{[\s\S]*?\.mk-scene \{ display: none; \}\s*\.mk-mscene \{ display: block; \}/);
    expect(HERO_MQ).toEqual({ mobile: "(max-width: 767px)", desktop: "not all and (max-width: 767px)" });
  });

  it("hiçbir şey kaybolmaz: tüm şablonlar yerine konunca çıktı kaynağın BİREBİR aynısı", () => {
    const src = composedHome();
    const { html, report } = deferHomeDom(src);
    expect(report.megaPanels).toEqual(["mega-urun", "mega-cozum", "mega-kaynak", "mega-fiyat"]);
    expect(report.megaKept).toEqual([]);
    expect(report.heroVariants).toBe(2);
    expect(report.footerAccordion).toBe(true);
    expect(report.tourFrames).toBe(6);
    expect(report.svgs).toBeGreaterThan(20);
    expect(html).not.toBe(src);
    expect(restoreAll(html)).toBe(src);
  });

  it("mega panel öğesi yerinde (id, inert, aria) kalır; yalnız içi şablondadır", () => {
    const { html } = deferHomeDom(composedHome());
    for (const id of ["urun", "cozum", "kaynak", "fiyat"]) {
      expect(html).toContain(`aria-controls="mega-${id}"`);
      expect(html).toMatch(new RegExp(`<div id="mega-${id}" role="group" aria-labelledby="mega-btn-${id}" class="mk-mega" inert="">\\s*<template data-mk-lazy="mega"><div class="mk-mega-in"`));
    }
  });

  it("hero: iki varyant şablonda, ardından medya sorgulu yerine koyma betiği", () => {
    const { html } = deferHomeDom(composedHome());
    expect(html).toMatch(new RegExp(`<div class="mk-mscene mk-demo"[^>]*><template data-mq="\\(max-width: 767px\\)">`));
    expect(html).toMatch(new RegExp(`<div class="mk-scene mk-demo"[^>]*><template data-mq="not all and \\(max-width: 767px\\)">`));
    expect(html.split(HERO_SWAP_SCRIPT).length - 1).toBe(2);
  });

  it("SEO koruması: yalnız panelde geçen bağlantı varsa panel şablona alınmaz", () => {
    const src = composedHome().replace('<div class="mk-mega-in"', '<div class="mk-mega-in"><a href="/yalniz-menude">Gizli sayfa</a>');
    const { html, report } = deferHomeDom(src);
    expect(report.megaKept).toEqual([{ id: "mega-urun", reason: "yalnız panelde geçen bağlantı: /yalniz-menude" }]);
    expect(report.megaPanels).toEqual(["mega-cozum", "mega-kaynak", "mega-fiyat"]);
    expect(html).toContain('class="mk-mega" inert=""><div class="mk-mega-in"><a href="/yalniz-menude">');
  });

  it("tarama anahtarı: köken, parça ve sondaki / atılır (aynı sayfaya giden parça bağlantısı sayfanın kendisidir)", () => {
    expect(crawlKey("/#tur")).toBe("/");
    expect(crawlKey("#sss")).toBe("/");
    expect(crawlKey("https://emlaksoft.com.tr/fiyatlar/#sss")).toBe("/fiyatlar");
    expect(crawlKey("/kayit?plan=office&amp;x=1")).toBe("/kayit?plan=office&x=1");
    expect(crawlKey("mailto:destek@emlaksoft.com.tr")).toBe("mailto:destek@emlaksoft.com.tr");
  });

  it("kimlik güvenliği: dışarıdan başvurulan tanım ve farklı yinelenen tanım yerinde kalır; birebir yinelenen eşdeğerdir", () => {
    const g1 = '<linearGradient id="a"><stop offset="0"></stop></linearGradient><rect fill="url(#a)"></rect>';
    const g2 = '<linearGradient id="a"><stop offset="0"></stop></linearGradient><rect fill="url(#a)"></rect>';
    const other = '<linearGradient id="a"><stop offset="1"></stop></linearGradient>';
    expect(idSafeGroups(`<svg>${g1}</svg><svg>${g2}</svg>`, [g1, g2])).toEqual([true, true]);
    expect(idSafeGroups(`<svg>${g1}</svg><svg>${other}</svg>`, [g1])).toEqual([false]);
    const outsideRef = '<svg><rect fill="url(#b)"></rect></svg>';
    const defB = '<linearGradient id="b"></linearGradient>';
    expect(idSafeGroups(`${outsideRef}<svg>${defB}</svg>`, [defB])).toEqual([false]);
    // Başka bir adaydaki kimliğe başvuran grup da yerinde kalır; tanımlayan grup, başvuran elenince yine güvensizdir.
    const refB = '<rect fill="url(#b)"></rect>';
    expect(idSafeGroups(`<svg>${defB}</svg><svg>${refB}</svg>`, [defB, refB])).toEqual([false, false]);
    // aria-controls → şablondaki kimlik: yerinde kalır.
    expect(idSafeGroups('<button aria-controls="p"></button><div><ul id="p"></ul></div>', ['<ul id="p"></ul>'])).toEqual([false]);
  });

  it("ertelenen SVG: öğe ve öznitelikleri yerinde, çocuklar depoda; açılır kaplar ve adacık kökleri hariç", () => {
    const sec = (inner: string) => `<section id="s" class="mk-section">${inner}</section>`;
    const art = '<svg class="mk-svg" viewBox="0 0 10 10" role="img" aria-label="Örnek"><rect width="1" height="1"></rect></svg>';
    const src =
      `<html><body>${sec(art)}${sec(`<details><summary>S</summary>${art}</details>`)}` +
      `${sec(`<div id="mk-price-hydrate" class="p">${art}</div><div data-island="seat-calculator">${art}</div>`)}</body></html>`;
    const { html, report } = deferHomeDom(src);
    expect(report.svgs).toBe(1);
    expect(html).toContain(`<svg class="mk-svg" viewBox="0 0 10 10" role="img" aria-label="Örnek" ${LAZY_SVG_ATTR}="0"></svg>`);
    expect(html).toContain(`<template id="${LAZY_STORE_ID}"><svg><rect width="1" height="1"></rect></svg></template></body>`);
    expect(html.split(art).length - 1).toBe(3);
    expect(restoreAll(html)).toBe(src);
  });

  it("beklenen öğeler yoksa (yasal sayfa) çıktı değişmez", () => {
    const legal = '<html><body><main><h1>Gizlilik</h1><p>Metin</p></main></body></html>';
    expect(deferHomeDom(legal).html).toBe(legal);
  });

  it("buildStaticHome: diyet yalnız lazyDom ile uygulanır", () => {
    const src = `<html><head><link rel="stylesheet" href="/_next/static/chunks/a.css"/></head><body>${composedHome().slice(composedHome().indexOf("<body") + 15)}`;
    const base = { html: src, readStylesheet: () => ".mk{color:red}", purge: {}, bodyEnd: "" };
    expect(buildStaticHome(base)).not.toContain("<template");
    const out = buildStaticHome({ ...base, lazyDom: true });
    expect(out).toContain('<template data-mk-lazy="mega">');
    expect(out).toContain(`<template id="${LAZY_STORE_ID}">`);
  });

  /**
   * Bütçe golden bileşimi üzerindedir (fiyat/değerleme/EmlakFiyati bölümleri golden'da yok). Ölçüm (2026-10-14, canlı
   * kaynak HTML): durağan 2940 → 1424; yük sonu (tur adacığı dahil) mobil 3959 → 1564, masaüstü 3959 → 1835.
   * Bileşimde (2026-10-14): durağan 2306 → 836, mobil yük sonu 976, masaüstü 1247.
   */
  it("öğe sayısı bütçesi (golden bileşimi): ilk yük DOM'u üçte birin altına iner", () => {
    const src = composedHome();
    const out = deferHomeDom(src).html;
    const before = countBodyElements(src);
    const after = countBodyElements(out);
    // Tarayıcıda hero betikleri (2) kendini siler ve görünen varyantın şablonu (1) içeriğiyle yer değiştirir.
    const variant = (cls: string) => {
      const t = out.indexOf("<template", out.indexOf(`<div class="${cls} mk-demo"`));
      const openEnd = out.indexOf(">", t) + 1;
      return countBodyElements(`<body>${out.slice(openEnd, matchTagEnd(out, "template", openEnd) - "</template>".length)}</body>`);
    };
    const mobile = after - 3 + variant("mk-mscene");
    const desktop = after - 3 + variant("mk-scene");
    expect(after / before).toBeLessThan(0.4);
    expect(after).toBeLessThanOrEqual(900);
    expect(mobile).toBeLessThanOrEqual(1050);
    expect(desktop).toBeLessThanOrEqual(1350);
  });

  it("çalışma zamanı aynı işaretçileri okur (dönüşüm ↔ runtime sözleşmesi)", () => {
    const rt = read("src/static-home/runtime.ts");
    expect(rt).toContain(`getElementById("${LAZY_STORE_ID}")`);
    expect(rt).toContain(`svg[${LAZY_SVG_ATTR}], template[data-mk-lazy='near']`);
    expect(rt).toContain(`"${LAZY_SVG_ATTR}"`);
    expect(rt).toContain("template[data-mk-lazy='tour']");
    expect(rt).toContain(':scope > template');
  });
});
