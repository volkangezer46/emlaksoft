/**
 * Marka SVG doğrulayıcı. SVG aktif içerik taşıyabildiği için (script, olay öznitelikleri,
 * dış kaynak, foreignObject) yükleme KATI bir izin listesiyle doğrulanır: izin listesi dışı
 * her öğe/öznitelik dosyayı REDDEDER (sessizce temizlemez; yöneticiye nedeni söylenir).
 * Sunumda ayrıca <img> ile servis edilir ve yanıt CSP sandbox taşır (savunma derinliği).
 */

export type SvgValidation = { ok: true; svg: string } | { ok: false; error: string };

const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "symbol", "use",
  "title", "desc", "style", "text", "tspan", "pattern",
]);

const MAX_TAGS = 4000;

function decodeForCheck(value: string): string {
  // Karakter referansları ve boşluk/kontrol karakteriyle gizlemeyi engelle.
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10) || 32))
    .replace(/[\u0000- \u007f-\u009f]+/g, "")
    .toLowerCase();
}

function badUrlRefs(value: string): boolean {
  const flat = decodeForCheck(value);
  if (/javascript:|vbscript:|data:|expression\(|behavior:|-moz-binding|@import/.test(flat)) return true;
  const re = /url\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const target = m[1].replace(/^['"]|['"]$/g, "");
    if (!target.startsWith("#")) return true;
  }
  return false;
}

export function validateBrandSvg(input: string, maxBytes: number): SvgValidation {
  if (typeof input !== "string" || input.length === 0) return { ok: false, error: "SVG dosyası boş." };
  if (Buffer.byteLength(input, "utf8") > maxBytes) {
    return { ok: false, error: `SVG en fazla ${Math.round(maxBytes / 1024)} KB olabilir.` };
  }
  let text = input.replace(/^﻿/, "").trim();
  // XML bildirimi ve yorumlar atılır; DOCTYPE/ENTITY/CDATA/PI reddedilir.
  text = text.replace(/^<\?xml[^>]*\?>\s*/i, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  if (/<!doctype|<!entity|<!\[cdata\[|<\?/i.test(text)) {
    return { ok: false, error: "SVG içinde DOCTYPE, ENTITY, CDATA veya işlem yönergesi bulunamaz." };
  }
  if (!/^<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text)) {
    return { ok: false, error: "Dosya geçerli bir SVG değil (kök öğe <svg> olmalı)." };
  }

  const tagRe = /<\/?([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  let count = 0;
  let rootSeen = false;
  let hasViewBox = false;
  let consumed = 0;
  let m: RegExpExecArray | null;
  const styleBlocks: string[] = [];

  while ((m = tagRe.exec(text))) {
    // Etiketler arasındaki metin yalnız text/style/title/desc içinde olabilir; '<' ham kalıntısı yakalanır.
    const between = text.slice(consumed, m.index);
    if (between.includes("<")) return { ok: false, error: "SVG biçimi bozuk (kapanmamış öğe)." };
    consumed = m.index + m[0].length;

    count += 1;
    if (count > MAX_TAGS) return { ok: false, error: "SVG çok karmaşık." };
    const isClose = m[0].startsWith("</");
    const rawName = m[1];
    if (rawName.includes(":")) return { ok: false, error: `İzin verilmeyen öğe: <${rawName}>.` };
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return { ok: false, error: `SVG içinde izin verilmeyen öğe: <${rawName}>.` };
    if (isClose) continue;
    if (name === "svg" && !rootSeen) rootSeen = true;

    const attrRe = /([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    const attrs = m[2] ?? "";
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrs))) {
      const attr = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (attr.startsWith("on")) return { ok: false, error: `Olay özniteliği (${a[1]}) yasak.` };
      if (attr === "href" || attr === "xlink:href") {
        if (!value.trim().startsWith("#")) return { ok: false, error: "SVG dış kaynağa/veri URI'sine bağlanamaz (yalnız #iç-referans)." };
      } else if (attr.includes(":") && !["xmlns:xlink", "xml:space"].includes(attr)) {
        return { ok: false, error: `İzin verilmeyen öznitelik: ${a[1]}.` };
      }
      if (attr === "viewbox") hasViewBox = true;
      if (attr === "style" && /[<]/.test(value)) return { ok: false, error: "Geçersiz style değeri." };
      if (badUrlRefs(value)) return { ok: false, error: "SVG içinde dış kaynak, veri URI'si veya betik URL'si bulunamaz." };
    }

    if (name === "style") {
      const end = text.indexOf("</style", consumed);
      if (end === -1) return { ok: false, error: "SVG biçimi bozuk (<style> kapanmamış)." };
      styleBlocks.push(text.slice(consumed, end));
    }
  }
  if (text.slice(consumed).trim().length > 0 && /</.test(text.slice(consumed))) {
    return { ok: false, error: "SVG biçimi bozuk." };
  }
  for (const css of styleBlocks) {
    if (/</.test(css) || badUrlRefs(css)) return { ok: false, error: "SVG <style> içinde dış kaynak veya betik bulunamaz." };
  }
  if (!rootSeen) return { ok: false, error: "Dosya geçerli bir SVG değil." };
  if (!hasViewBox) return { ok: false, error: "SVG kök öğesinde viewBox bulunmalı (ölçeklenebilirlik için)." };

  // xmlns yoksa <img> olarak render olmaz; ekle.
  const out = /^<svg[^>]*\sxmlns\s*=/i.test(text)
    ? text
    : text.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return { ok: true, svg: out };
}
