import postcss, { type AtRule, type Rule } from "postcss";
import { deferHomeDom } from "./lazy-dom";

/**
 * Next'in ürettiği ana sayfa HTML'inden saf HTML üretir (SAF fonksiyonlar; G/Ç yok → birim testli).
 *  1. React akış sınırları (`<!--$?--><template id="B:n">…<!--/$-->` + `<div hidden id="S:n">`) yerine konur
 *     (Next'in `$RC` betikleri kaldırılacağı için).
 *  2. Next/React çalışma zamanı ayıklanır: dış betikler, RSC verisi (`self.__next_f`), akış betikleri, betik
 *     önceden yüklemeleri, React yorum işaretleri. Kalan: JSON-LD, speculationrules, sitenin kendi küçük betikleri.
 *  3. Dış stil dosyaları tek `<style>`'a gömülür; yalnız sayfada (ve adacıklarda) geçen sınıfların kuralları kalır.
 *  4. (İsteğe bağlı, `lazyDom`) ilk yükte gerekmeyen işaretleme `<template>`'e alınır (./lazy-dom.ts).
 */

const NEXT_INLINE_MARKERS = ["self.__next_f", "$RC", "$RB=", "$RT=", "$RS(", "$RX(", "__next_s"];

/** Bir açılış etiketinden sonra dengeli `</div>` kapanışının bittiği konumu döndürür (yoksa -1). */
function matchDivEnd(html: string, openEnd: number): number {
  const re = /<div\b[^>]*>|<\/div>/gi;
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** `<!--$?--><template id="B:n"></template>YEDEK<!--/$-->` → `<div hidden id="S:n">İÇERİK</div>` içeriği. */
export function resolveSuspenseBoundaries(html: string): string {
  let out = html;
  for (;;) {
    const m = /<!--\$\?--><template id="B:([0-9a-z]+)"><\/template>/i.exec(out);
    if (!m) return out;
    const id = m[1];
    const holeStart = m.index;
    const closeIdx = out.indexOf("<!--/$-->", holeStart + m[0].length);
    const seg = new RegExp(`<div hidden(?:="")? id="S:${id}">`).exec(out);
    if (closeIdx < 0 || !seg) return out; // beklenmeyen biçim: dokunma (çağıran yedek HTML'e düşer)
    const contentStart = seg.index + seg[0].length;
    const segEnd = matchDivEnd(out, contentStart);
    if (segEnd < 0) return out;
    const content = out.slice(contentStart, segEnd - "</div>".length);
    // Önce sondaki gizli parçayı sil, sonra deliği doldur (konumlar kaymasın diye sıra önemli).
    out = out.slice(0, seg.index) + out.slice(segEnd);
    out = out.slice(0, holeStart) + content + out.slice(closeIdx + "<!--/$-->".length);
  }
}

export type StripResult = { html: string; stylesheets: string[] };

/**
 * K4: sitenin kendi küçük dış betiği (ör. ölçüm işaretçisi `<script src="/statik/m-….js" defer data-static-keep>`) korunur.
 * Koşul: `data-static-keep` özniteliği VE aynı kökenli `/statik/` altında `.js` adresi (protokolsüz `//`, şema, `..`
 * ve sorgu dizesi reddedilir). Diğer tüm dış betikler (Next parçaları dahil) atılır.
 */
export function isKeptExternalScript(attrs: string): boolean {
  if (!/(?:^|\s)data-static-keep(?:\s|=|$)/i.test(attrs)) return false;
  const src = /\ssrc=(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  const url = src?.[1] ?? src?.[2];
  return typeof url === "string" && /^\/statik\/[\w-]+(?:\.[\w-]+)*\.js$/.test(url);
}

export function stripNextRuntime(html: string): StripResult {
  const stylesheets: string[] = [];
  let out = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs: string, body: string) => {
    if (/\ssrc=/i.test(attrs)) return isKeptExternalScript(attrs) && body.trim() === "" ? all : "";
    if (/type="(application\/ld\+json|speculationrules)"/i.test(attrs)) return all;
    if (NEXT_INLINE_MARKERS.some((k) => body.includes(k))) return "";
    return all;
  });
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if (/rel="(modulepreload|expect)"/i.test(tag)) return "";
    if (/rel="preload"/i.test(tag) && /as="(script|style)"/i.test(tag)) return "";
    if (/rel="stylesheet"/i.test(tag)) {
      const href = /href="([^"]+)"/i.exec(tag)?.[1];
      if (href) stylesheets.push(href.replace(/&amp;/g, "&"));
      return "";
    }
    return tag;
  });
  // React yorum işaretleri (<!--$-->, <!--/$-->, <!-- -->) ve artık şablonlar.
  out = out.replace(/<!--\/?\$[!?]?-->|<!-- -->/g, "").replace(/<template id="[BP]:[0-9a-z]+"><\/template>/gi, "");
  return { html: out, stylesheets };
}

/** CSS kaçışlarını çözer: `.md\:flex` → `md:flex`, `.\31 0` → `10`. */
function unescapeCss(s: string): string {
  return s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, "$1");
}

const IDENT = String.raw`(?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-])+`;

/** Seçicide ZORUNLU sınıf/kimlikler (`:not()`/`:where()`/`:is()`/`:has()` içi zorunlu sayılmaz). */
export function requiredTokens(selector: string): { classes: string[]; ids: string[] } {
  let s = selector;
  // İç içe fonksiyonel sözde sınıfları (en içten) temizle.
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/:(?:not|where|is|has|matches|-webkit-any|-moz-any)\((?:[^()]|\([^()]*\))*\)/g, "");
    if (next === s) break;
    s = next;
  }
  // Nitelik seçicileri (içlerinde nokta olabilir); kaçışlı köşeli parantez (`.min-h-\[58rem\]`) sınıf adının parçasıdır.
  s = s.replace(/(?<!\\)\[(?:\\.|[^\]\\])*\]/g, "");
  const classes = [...s.matchAll(new RegExp(String.raw`\.(${IDENT})`, "g"))].map((m) => unescapeCss(m[1]));
  const ids = [...s.matchAll(new RegExp(String.raw`#(${IDENT})`, "g"))].map((m) => unescapeCss(m[1]));
  return { classes, ids };
}

/** HTML'de geçen sınıf ve kimlik belirteçleri. */
export function collectHtmlTokens(html: string): { classes: Set<string>; ids: Set<string> } {
  const classes = new Set<string>();
  const ids = new Set<string>();
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c.replace(/&amp;/g, "&"));
  for (const m of html.matchAll(/\sid="([^"]*)"/g)) ids.add(m[1]);
  return { classes, ids };
}

export type PurgeOptions = {
  /** HTML'de olmayan ama çalışma anında eklenen/adacıkların çizdiği sınıflar. */
  extraClasses?: Iterable<string>;
  /** Bu öneklerle başlayan sınıfların kuralları hep kalır (ör. "mk-": pazarlama CSS'i, JS ile eklenen durumlar). */
  keepPrefixes?: readonly string[];
};

export function purgeCss(css: string, html: string, opts: PurgeOptions = {}): string {
  const { classes, ids } = collectHtmlTokens(html);
  for (const c of opts.extraClasses ?? []) classes.add(c);
  const prefixes = opts.keepPrefixes ?? [];
  const classOk = (c: string) => classes.has(c) || prefixes.some((p) => c.startsWith(p));
  const keep = (sel: string) => {
    const t = requiredTokens(sel);
    return t.classes.every(classOk) && t.ids.every((i) => ids.has(i) || prefixes.some((p) => i.startsWith(p)));
  };
  const root = postcss.parse(css);
  root.walkRules((rule: Rule) => {
    const parent = rule.parent as AtRule | undefined;
    if (parent?.type === "atrule" && /keyframes$/i.test(parent.name)) return;
    const selectors = rule.selectors.filter(keep);
    if (selectors.length === 0) rule.remove();
    else if (selectors.length !== rule.selectors.length) rule.selectors = selectors;
  });
  pruneUnusedCustomProperties(root, html, opts.extraClasses);
  // Boşalan @media/@supports/@layer/@container blokları.
  let removed = true;
  while (removed) {
    removed = false;
    root.walkAtRules((at: AtRule) => {
      if (at.nodes && at.nodes.length === 0 && !/^(font-face|property|page)$/i.test(at.name)) {
        at.remove();
        removed = true;
      }
    });
  }
  return root.toString();
}

/**
 * Kalan kurallarda (ve HTML'deki style="" / adacık kodunda) hiç `var(--x)` ile okunmayan özel özellik tanımlarını
 * ve `@property --x` kayıtlarını siler. Değişkenler birbirine başvurabildiği için sabitlenene dek tekrarlanır.
 */
function pruneUnusedCustomProperties(root: postcss.Root, html: string, extra?: Iterable<string>) {
  const extraText = extra ? [...extra].join(" ") : "";
  for (let pass = 0; pass < 6; pass++) {
    const used = new Set<string>();
    const scan = (text: string) => {
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]);
    };
    root.walkDecls((d) => scan(d.value));
    scan(html);
    // Adacık kodu değişkeni getPropertyValue("--x") ile de okuyabilir: orada geçen her --ad kullanılmış sayılır.
    for (const m of extraText.matchAll(/(--[\w-]+)/g)) used.add(m[1]);
    let changed = false;
    root.walkDecls((d) => {
      if (d.prop.startsWith("--") && !used.has(d.prop)) {
        d.remove();
        changed = true;
      }
    });
    root.walkAtRules("property", (at) => {
      if (!used.has(at.params.trim())) {
        at.remove();
        changed = true;
      }
    });
    root.walkRules((r) => {
      if (r.nodes.length === 0) r.remove();
    });
    if (!changed) return;
  }
}

/** Gömülen CSS'te göreli `url(../media/x.woff2)` adresleri stil dosyasının konumuna göre mutlak yola çevrilir. */
export function absolutizeCssUrls(css: string, href: string): string {
  const base = new URL(href, "https://statik.invalid/");
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (all, q: string, u: string) => {
    if (/^(data:|https?:|\/|#)/i.test(u)) return all;
    const abs = new URL(u, base);
    return `url(${q}${abs.pathname}${abs.search}${abs.hash}${q})`;
  });
}

export type BuildStaticHomeInput = {
  html: string;
  /** href → CSS metni (bulunamayanlar için çağıran yedeğe düşer). */
  readStylesheet: (href: string) => string | null;
  purge: PurgeOptions;
  /** `</body>` öncesine eklenecek ham HTML (veri + çalışma zamanı betiği). */
  bodyEnd: string;
  /** DOM diyeti (mega panel / hero varyantı / ekran dışı SVG şablonları; ./lazy-dom.ts). Çalışma zamanı gerektirir. */
  lazyDom?: boolean;
};

/** Tam dönüşüm; beklenmeyen biçimde `null` döner (çağıran normal Next HTML'ini sunar). */
export function buildStaticHome(input: BuildStaticHomeInput): string | null {
  const resolved = resolveSuspenseBoundaries(input.html);
  if (/<template id="B:/.test(resolved) || /<div hidden(?:="")? id="S:/.test(resolved)) return null;
  const stripped = stripNextRuntime(resolved);
  const { stylesheets } = stripped;
  const html = input.lazyDom ? deferHomeDom(stripped.html).html : stripped.html;
  if (stylesheets.length === 0 || !html.includes("</head>") || !html.includes("</body>")) return null;
  const css: string[] = [];
  for (const href of stylesheets) {
    const text = input.readStylesheet(href);
    if (text == null) return null;
    css.push(absolutizeCssUrls(text, href));
  }
  const fonts = optionalFonts(purgeCss(css.join("\n"), html, input.purge));
  const doc = finalizeHead(keptScriptsToLoaders(html), fonts.urls);
  // İşlevli değiştirme: küçültülmüş JS/CSS'teki `$&`, `$'`, "$`" dizgeleri değiştirme kalıbı olarak yorumlanmasın.
  return doc.replace("</head>", () => `<style>${fonts.css}</style></head>`).replace("</body>", () => `${input.bodyEnd}</body>`);
}

/**
 * Web yazı tipleri: `font-display: optional` + `<link rel=preload>` (finalizeHead). Önyüklenen optional yazı tipi ilk
 * çizimden önce hazırsa kullanılır, değilse sayfa boyunca metrik ayarlı yedekte kalır — yazı tipi gelince satırlar
 * yeniden kırılmaz (Lighthouse CLS: masaüstü hero sahnesi 0,26 kayıyordu; ızgara dikey ortalı, başlık yüksekliği değişiyordu).
 */
export function optionalFonts(css: string): { css: string; urls: string[] } {
  const urls: string[] = [];
  const out = css.replace(/@font-face\s*\{[^}]*\}/g, (face) => {
    const url = /url\(\s*["']?(\/_next\/static\/media\/[\w.-]+\.woff2)["']?\s*\)/.exec(face)?.[1];
    if (url && !urls.includes(url)) urls.push(url);
    return face.replace(/font-display\s*:\s*swap/g, "font-display:optional");
  });
  return { css: out, urls };
}

/**
 * Baş bölümü sadeleştirme (Lighthouse "Ağ bağımlılık ağacı": belge → yüksek öncelikli ikinci halka kalmasın):
 *  - `<link rel=preconnect href="/">` atılır (aynı köke önbağlantı boşa; next/font yan ürünü),
 *  - `<link rel=manifest>` atılır (pazarlama sayfası kurulabilir uygulama değildir; PWA /app'te),
 *  - yazı tipleri `<meta charset>` hemen ardından önyüklenir (önyükleme isteği kritik zincire girmez).
 */
export function finalizeHead(html: string, fontUrls: readonly string[]): string {
  let out = html
    .replace(/<link\b[^>]*\brel="preconnect"[^>]*\bhref="\/"[^>]*>/gi, "")
    .replace(/<link\b[^>]*\brel="manifest"[^>]*>/gi, "");
  if (fontUrls.length === 0) return out;
  const preloads = fontUrls.map((u) => `<link rel="preload" href="${u}" as="font" type="font/woff2" crossorigin=""/>`).join("");
  const charset = /<meta\s+charSet="utf-8"\s*\/?>/i.exec(out);
  out = charset
    ? out.slice(0, charset.index + charset[0].length) + preloads + out.slice(charset.index + charset[0].length)
    : out.replace("</head>", () => `${preloads}</head>`);
  return out;
}

/**
 * Korunan dış betik (`<script src="/statik/…" data-static-keep>`) satır içi yükleyiciye dönüşür: statik sayfa CSP'si
 * hash + 'strict-dynamic' kullanır (./csp.ts); ayrıştırıcının eklediği nonce'suz dış betik orada çalışmaz, hash'li
 * satır içi betiğin eklediği betik çalışır. `src` ataması Trusted Types politikasıyla (yalnız /statik/*.js) yapılır.
 * `data-a` korunur (ölçüm betiği `document.currentScript.dataset.a` okur); DOM hazır olunca eklenir (defer eşdeğeri).
 */
export function keptScriptsToLoaders(html: string): string {
  return html.replace(/<script\b([^>]*)><\/script>/gi, (all, attrs: string) => {
    if (!isKeptExternalScript(attrs)) return all;
    const src = /\ssrc="([^"]+)"/i.exec(attrs)?.[1];
    if (!src) return all;
    const a = /\sdata-a="([01])"/i.exec(attrs)?.[1];
    const setA = a ? `s.setAttribute("data-a","${a}");` : "";
    return (
      `<script>(function(d){var u=${JSON.stringify(src)};function go(){var t=window.trustedTypes,` +
      `p=t&&t.createPolicy("mk-statik",{createScriptURL:function(x){if(/^\\/statik\\/[\\w.-]+\\.js$/.test(x))return x;throw new TypeError("statik")}}),` +
      `s=d.createElement("script");s.src=p?p.createScriptURL(u):u;s.async=!0;${setA}d.body.appendChild(s)}` +
      `d.readyState==="loading"?d.addEventListener("DOMContentLoaded",go):go()})(document)</script>`
    );
  });
}
