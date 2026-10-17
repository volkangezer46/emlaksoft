import { describe, expect, it } from "vitest";
import { isInternalHref, parseInline, parseZekaMarkdown, zekaPlainText } from "./markdown";

/** Güvenli markdown: HTML yok (yalnız düz metin düğümleri), bağlantı yalnız site içi yola. */

describe("Zeka güvenli markdown", () => {
  it("kalın, kod ve site içi bağlantı", () => {
    expect(parseInline("Bu ay **₺12.500.000** ciro; [listeyi aç](/app/anlasmalar?asama=won) ya da `Ctrl K`.")).toEqual([
      { t: "text", v: "Bu ay " },
      { t: "bold", v: [{ t: "text", v: "₺12.500.000" }] },
      { t: "text", v: " ciro; " },
      { t: "link", href: "/app/anlasmalar?asama=won", v: "listeyi aç" },
      { t: "text", v: " ya da " },
      { t: "code", v: "Ctrl K" },
      { t: "text", v: "." },
    ]);
  });

  it("dış, şemalı ve protokolsüz bağlantılar düz metne iner", () => {
    for (const href of ["https://kotu.example", "javascript:alert(1)", "//kotu.example/x", "/\\kotu", "data:text/html,x", "/a b", "/x:alert(1)"]) {
      expect(isInternalHref(href), href).toBe(false);
      expect(parseInline(`[tıkla](${href})`).some((n) => n.t === "link"), href).toBe(false);
    }
    expect(parseInline("[tıkla](javascript:void)")).toEqual([{ t: "text", v: "tıkla" }]);
    expect(isInternalHref("/app/musteriler/yeni?ad=Ali#ust")).toBe(true);
  });

  it("ham HTML hiçbir zaman öğe olmaz: etiketler düz metin kalır", () => {
    const blocks = parseZekaMarkdown('<script>alert(1)</script>\n<img src=x onerror="alert(1)">');
    expect(blocks).toEqual([
      {
        t: "p",
        v: [{ t: "text", v: "<script>alert(1)</script>" }, { t: "br" }, { t: "text", v: '<img src=x onerror="alert(1)">' }],
      },
    ]);
    const kinds = new Set(JSON.stringify(blocks).match(/"t":"(\w+)"/g));
    expect([...kinds].every((k) => /"(p|text|br)"/.test(k))).toBe(true);
  });

  it("madde ve sıralı listeler, paragraflar ve tek satır sonu", () => {
    expect(parseZekaMarkdown("Özet:\n- **3** randevu\n- 2 görev\n\n1. Formu açın\n2) Kaydedin\nSon satır\nikinci")).toEqual([
      { t: "p", v: [{ t: "text", v: "Özet:" }] },
      { t: "ul", items: [[{ t: "bold", v: [{ t: "text", v: "3" }] }, { t: "text", v: " randevu" }], [{ t: "text", v: "2 görev" }]] },
      { t: "ol", start: 1, items: [[{ t: "text", v: "Formu açın" }], [{ t: "text", v: "Kaydedin" }]] },
      { t: "p", v: [{ t: "text", v: "Son satır" }, { t: "br" }, { t: "text", v: "ikinci" }] },
    ]);
  });

  it("başlık işaretleri düz metne iner; kopyalama metni işaretsizdir", () => {
    expect(parseZekaMarkdown("## Başlık")).toEqual([{ t: "p", v: [{ t: "text", v: "Başlık" }] }]);
    expect(zekaPlainText("**7** kira — [aç](/app/kiralama) `x`")).toBe("7 kira — aç x");
  });
});
