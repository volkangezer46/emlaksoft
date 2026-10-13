import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { publishedTools } from "@/lib/tools/registry";
import { RICH_LIMITS, TOOL_EMBED_SLUGS, plainTextOf, readingMinutes, tocOf, type RichBlock } from "./core";
import { checkRichHref } from "./href";
import { parseInline, type InlineNode } from "./parse-inline";
import { RichText } from "./render";
import { richBodySchema, validateRichBody } from "./schema";

/**
 * Zengin metin güvenliği: ayrıştırıcı ham HTML üretmez, güvensiz adres bağlantıya dönüşmez, renderer çıktısında ham
 * HTML yoktur (her metin kaçışlı) ve şema bilinmeyen blok/sınır aşımını reddeder.
 */

const html = (blocks: RichBlock[]) => renderToStaticMarkup(createElement(RichText, { blocks }));
const links = (nodes: InlineNode[]): InlineNode[] => nodes.flatMap((n) => (n.t === "link" ? [n] : n.t === "text" ? [] : links(n.c)));

describe("checkRichHref", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "//evil.com",
    "//evil.com/x",
    "evil.com",
    "/x\"onmouseover=\"alert(1)",
    "https://user:pw@evil.com",
    "",
  ])("reddeder: %s", (href) => {
    expect(checkRichHref(href).ok).toBe(false);
  });

  it("site yolu, https, mailto, tel ve başlık bağlantısı geçer; dış bağlantı işaretlenir", () => {
    expect(checkRichHref("/fiyatlar")).toMatchObject({ ok: true, kind: "internal", external: false, broken: false });
    expect(checkRichHref("https://www.tkgm.gov.tr/")).toMatchObject({ ok: true, kind: "external", external: true });
    expect(checkRichHref("mailto:destek@emlaksoft.com.tr")).toMatchObject({ ok: true, kind: "mailto", external: false });
    expect(checkRichHref("tel:+905551112233")).toMatchObject({ ok: true, kind: "tel" });
    expect(checkRichHref("#komisyon-orani")).toMatchObject({ ok: true, kind: "anchor" });
  });

  it("bilinmeyen site yolu kırık iç bağlantı uyarısıdır (known-routes); ek yollar bilinir sayılır", () => {
    expect(checkRichHref("/olmayan-sayfa")).toMatchObject({ ok: true, broken: true });
    expect(checkRichHref("/rehber/kira-artisi", ["/rehber/kira-artisi"])).toMatchObject({ ok: true, broken: false });
  });
});

describe("parseInline (XSS)", () => {
  it("[x](javascript:alert(1)) bağlantıya dönüşmez, hata verir ve metin kalır", () => {
    const r = parseInline("önce [x](javascript:alert(1)) sonra");
    expect(links(r.nodes)).toEqual([]);
    expect(r.issues.some((i) => i.level === "error")).toBe(true);
    const out = html([{ type: "p", text: "önce [x](javascript:alert(1)) sonra" }]);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a");
  });

  it("[x](//evil.com) reddedilir", () => {
    const r = parseInline("[x](//evil.com)");
    expect(links(r.nodes)).toEqual([]);
    expect(r.issues[0]?.level).toBe("error");
    expect(html([{ type: "p", text: "[x](//evil.com)" }])).not.toContain("evil.com\"");
  });

  it("adresteki dengeli parantez bağlantının parçasıdır; kaçışlı \\) da desteklenir", () => {
    const r = parseInline("[Tapu](https://tr.wikipedia.org/wiki/Tapu_(hukuk)) sonra");
    expect(links(r.nodes)).toMatchObject([{ href: "https://tr.wikipedia.org/wiki/Tapu_(hukuk)" }]);
    expect(r.nodes[r.nodes.length - 1]).toEqual({ t: "text", v: " sonra" });
    const e = parseInline("[x](https://ornek.com/a\\)b)");
    expect(links(e.nodes)).toMatchObject([{ href: "https://ornek.com/a)b" }]);
  });

  it("<script> içeren metin kaçışlanır; ham etiket çıkmaz", () => {
    const out = html([{ type: "p", text: "<script>alert(1)</script> ve **kalın**" }]);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("<strong>kalın</strong>");
  });

  it("**<img onerror>** kalın içinde kaçışlanır; img öğesi oluşmaz", () => {
    const out = html([{ type: "p", text: "**<img src=x onerror=alert(1)>**" }]);
    expect(out).toContain("<strong>&lt;img src=x onerror=alert(1)&gt;</strong>");
    expect(out).not.toMatch(/<img/i);
  });

  it("tüm blok türlerinde renderer çıktısında ham HTML yok", () => {
    const evil = "<b onclick=x>y</b>";
    const out = html([
      { type: "h2", text: evil },
      { type: "h3", text: evil },
      { type: "ul", items: [evil] },
      { type: "ol", items: [evil] },
      { type: "quote", text: evil, cite: evil },
      { type: "callout", tone: "uyari", title: evil, text: evil },
      { type: "table", caption: evil, head: [evil], rows: [[evil]] },
      { type: "faq", items: [{ q: evil, a: evil }] },
    ]);
    expect(out).not.toMatch(/<b[\s>]/);
    expect(out).not.toContain("onclick=x>");
    expect(out.split("&lt;b onclick=x&gt;").length - 1).toBeGreaterThanOrEqual(10);
  });

  it("geçerli biçim: kalın, italik, iç ve dış bağlantı (dış: noopener nofollow)", () => {
    const out = html([{ type: "p", text: "**K** *i* [iç](/fiyatlar) [dış](https://www.tkgm.gov.tr/) \\*kaçış\\*" }]);
    expect(out).toContain("<strong>K</strong>");
    expect(out).toContain("<em>i</em>");
    expect(out).toMatch(/<a href="\/fiyatlar"[^>]*>iç<\/a>/);
    expect(out).toMatch(/<a href="https:\/\/www\.tkgm\.gov\.tr\/" rel="noopener nofollow"[^>]*>dış<\/a>/);
    expect(out).toContain("*kaçış*");
  });

  it("kapanmayan işaret düz metin kalır; iç içe kalın/italik/bağlantı çalışır", () => {
    expect(parseInline("**açık kaldı").nodes).toEqual([{ t: "text", v: "**açık kaldı" }]);
    expect(parseInline("[metin](").nodes).toEqual([{ t: "text", v: "[metin](" }]);
    const r = parseInline("**kalın *italik* [bağ](/araclar)**");
    expect(r.nodes[0]).toMatchObject({ t: "strong" });
    expect(links(r.nodes)).toHaveLength(1);
  });
});

describe("şema", () => {
  it("bilinmeyen blok türü ve fazladan alan (html) reddedilir", () => {
    expect(richBodySchema.safeParse([{ type: "html", html: "<b>x</b>" }]).success).toBe(false);
    expect(richBodySchema.safeParse([{ type: "image", src: "/x.png" }]).success).toBe(false);
    expect(richBodySchema.safeParse([{ type: "p", text: "x", html: "<b>" }]).success).toBe(false);
    expect(validateRichBody([{ type: "script" }]).issues[0]?.message).toBe("Bilinmeyen blok türü.");
  });

  it("sınır aşımı reddedilir: 200 blok, 2.000 karakter, 8 sütun, satır/sütun uyumu", () => {
    const p = (text: string): RichBlock => ({ type: "p", text });
    expect(richBodySchema.safeParse(Array.from({ length: RICH_LIMITS.maxBlocks }, () => p("a"))).success).toBe(true);
    expect(richBodySchema.safeParse(Array.from({ length: RICH_LIMITS.maxBlocks + 1 }, () => p("a"))).success).toBe(false);
    expect(richBodySchema.safeParse([p("a".repeat(2000))]).success).toBe(true);
    expect(richBodySchema.safeParse([p("a".repeat(2001))]).success).toBe(false);
    const cols = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);
    expect(richBodySchema.safeParse([{ type: "table", head: cols(8), rows: [cols(8)] }]).success).toBe(true);
    expect(richBodySchema.safeParse([{ type: "table", head: cols(9), rows: [] }]).success).toBe(false);
    expect(richBodySchema.safeParse([{ type: "table", head: cols(2), rows: [cols(3)] }]).success).toBe(false);
  });

  it("toolEmbed yalnız mevcut 4 aracı kabul eder (kayıtla eşit)", () => {
    expect([...TOOL_EMBED_SLUGS].sort()).toEqual(publishedTools().map((t) => t.slug).sort());
    expect(richBodySchema.safeParse([{ type: "toolEmbed", slug: "kira-artis-hesaplama" }]).success).toBe(false);
    expect(html([{ type: "toolEmbed", slug: "komisyon-hesaplama" }])).toContain('href="/araclar/komisyon-hesaplama"');
  });

  it("validateRichBody: güvensiz bağlantı hata, kırık iç bağlantı ve HTML etiketi uyarı (yol işaretli)", () => {
    const { issues } = validateRichBody([
      { type: "p", text: "[x](javascript:alert(1))" },
      { type: "ul", items: ["[y](/olmayan)"] },
      { type: "h2", text: "<b>başlık</b>" },
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "error", path: "body.0.text" }),
        expect.objectContaining({ level: "warn", path: "body.1.items.0" }),
        expect.objectContaining({ level: "warn", path: "body.2.text" }),
      ]),
    );
  });
});

describe("yardımcılar", () => {
  it("içindekiler h2'lerden; kimlikler renderer'la aynı ve tekil", () => {
    const blocks: RichBlock[] = [
      { type: "h2", text: "Komisyon oranı" },
      { type: "p", text: "metin" },
      { type: "h2", text: "Komisyon oranı" },
      { type: "h3", text: "Ayrıntı" },
    ];
    const toc = tocOf(blocks);
    expect(toc).toEqual([
      { id: "komisyon-orani", text: "Komisyon oranı" },
      { id: "komisyon-orani-2", text: "Komisyon oranı" },
    ]);
    const out = html(blocks);
    for (const t of toc) expect(out).toContain(`id="${t.id}"`);
  });

  it("düz metin biçimi atar, okuma süresi en az 1 dakika", () => {
    expect(plainTextOf([{ type: "p", text: "**a** [b](/fiyatlar) *c*" }])).toBe("a b c");
    expect(readingMinutes([])).toBe(1);
    expect(readingMinutes([{ type: "p", text: "kelime ".repeat(1000) }])).toBe(5);
  });
});

describe("sözleşme", () => {
  it("rich-text kaynaklarında dangerouslySetInnerHTML ve istemci kodu yok", () => {
    const dir = join(process.cwd(), "src/lib/rich-text");
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && statSync(join(dir, f)).isFile());
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML\s*=/);
      expect(src, f).not.toContain('"use client"');
      expect(src, f).not.toMatch(/\binnerHTML\b/);
    }
  });
});
