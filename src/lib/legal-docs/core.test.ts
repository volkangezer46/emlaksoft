import { describe, expect, it } from "vitest";
import { convertLegalHtml, diffLines, diffStats, groupSections, isSafeHref, legalHtmlToMarkup, lintLegalMarkup, parseInline, parseLegalMarkup, pendingReconsents, type ReconsentDocRow } from "./core";

describe("yasal işaretleme", () => {
  it("başlık, paragraf, madde ve şirket kimliği simgesi", () => {
    const blocks = parseLegalMarkup("## 1. Taraflar\nSağlayıcı **EmlakSoft**\ndevam.\n\n{{sirket_kimligi}}\n\n- bir\n- iki\n  devam\n\n## Ek\nmetin");
    expect(blocks.map((b) => b.t)).toEqual(["heading", "para", "entity", "list", "heading", "para"]);
    expect(blocks[0]).toEqual({ t: "heading", no: "1.", title: "Taraflar" });
    const list = blocks[3] as { t: "list"; items: unknown[][] };
    expect(list.items).toHaveLength(2);
    expect(groupSections(blocks).map((s) => s.title)).toEqual(["Taraflar", "Ek"]);
  });

  it("güvensiz bağlantı düz metin olur; güvenli olanlar bağlantı", () => {
    expect(parseInline("[a](javascript:alert(1))")[0]).toMatchObject({ t: "text" });
    expect(parseInline("[Fiyat](/fiyatlar) ve {{destek_eposta}}")).toEqual([
      { t: "link", href: "/fiyatlar", v: "Fiyat" },
      { t: "text", v: " ve " },
      { t: "token", name: "destek_eposta" },
    ]);
    expect(isSafeHref("//kotu.site")).toBe(false);
    expect(isSafeHref("/\\evil.com")).toBe(false);
    expect(isSafeHref("/a\\b")).toBe(false);
    expect(isSafeHref("https://www.resmigazete.gov.tr")).toBe(true);
  });

  it("biçim denetimi: başlıksız metin, HTML ve kötü bağlantı uyarılır", () => {
    expect(lintLegalMarkup("düz metin")).toHaveLength(1);
    expect(lintLegalMarkup("## 1. A\n<script>x</script>").some((i) => i.includes("HTML"))).toBe(true);
    expect(lintLegalMarkup("## 1. A\n[x](ftp://a)").some((i) => i.includes("ftp://a"))).toBe(true);
    expect(lintLegalMarkup("## 1. A\nmetin")).toEqual([]);
  });

  it("satır farkı: eklenen ve çıkarılan satırlar", () => {
    const d = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(d).toEqual([
      { op: "same", text: "a" },
      { op: "del", text: "b" },
      { op: "add", text: "B" },
      { op: "same", text: "c" },
      { op: "add", text: "d" },
    ]);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
  });

  it("yayındaki sayfa HTML'i işaretlemeye çevrilir (şirket listesi simgeye, destek e-postası simgeye)", () => {
    const html = `<main><h1>X</h1><article class="legal-body space-y-8" data-legal-version="1"><section><h2 class="a"><span class="b">1.</span>Taraflar</h2><div><p><b>Sağlayıcı:</b> EmlakSoft — iletişim: <a class="c" href="mailto:x@y.z">x@y.z</a>.</p><ul class="list-disc" data-legal-entity=""></ul><p>Bkz. <a href="/fiyatlar">fiyatlandırma</a> &amp; koşullar.</p></div></section><section><h2><span>2.</span>Konu</h2><div><ul><li>bir</li><li><b>iki</b></li></ul></div></section></article></main>`;
    expect(legalHtmlToMarkup(html)).toBe(
      "## 1. Taraflar\n\n**Sağlayıcı:** EmlakSoft — iletişim: {{destek_eposta}}.\n\n{{sirket_kimligi}}\n\nBkz. [fiyatlandırma](/fiyatlar) & koşullar.\n\n## 2. Konu\n\n- bir\n- **iki**",
    );
    expect(legalHtmlToMarkup("<p>yok</p>")).toBeNull();
  });

  it("çerez tablosu tabloya çevrilir; yalnız mobil ipucu (aria-hidden) atlanır; sessiz kayıp yok", () => {
    const html = `<article class="legal-body"><section><h2><span>2.</span>Kullandığımız çerezler</h2><div><p class="mb-2 text-xs sm:hidden" aria-hidden="true">Tabloyu görmek için yana kaydırın →</p><div tabindex="0" role="region"><table class="w-full"><thead><tr><th>Tür</th><th>Amaç</th><th>Süre</th></tr></thead><tbody><tr><td>Zorunlu (oturum)</td><td>Giriş oturumu</td><td>Oturum / yenilemeli</td></tr><tr><td>Tercih</td><td>Tema</td><td>12 aya kadar</td></tr></tbody></table></div></div></section></article>`;
    const r = convertLegalHtml(html);
    expect(r.dropped).toEqual([]);
    expect(r.markup).toBe(
      "## 2. Kullandığımız çerezler\n\n| Tür | Amaç | Süre |\n| --- | --- | --- |\n| Zorunlu (oturum) | Giriş oturumu | Oturum / yenilemeli |\n| Tercih | Tema | 12 aya kadar |",
    );
    const blocks = parseLegalMarkup(r.markup!);
    const table = blocks.find((b) => b.t === "table");
    expect(table && table.t === "table" ? [table.head.length, table.rows.length] : null).toEqual([3, 2]);
    expect(lintLegalMarkup(r.markup!)).toEqual([]);
  });

  it("işaretlemeye çevrilemeyen görünür metin 'dropped' olarak raporlanır", () => {
    const r = convertLegalHtml(`<article class="legal-body"><section><h2>A</h2><div><p>x</p><div>Kayıp kutu metni</div></div></section></article>`);
    expect(r.dropped).toEqual(["Kayıp kutu metni"]);
  });

  it("tablo sütun sayısı tutarsızsa biçim denetimi uyarır", () => {
    expect(lintLegalMarkup("## 1. A\n\n| a | b |\n| --- | --- |\n| 1 |").some((i) => i.includes("sütun"))).toBe(true);
  });
});

describe("yeniden onay", () => {
  const doc = (over: Partial<ReconsentDocRow> = {}): ReconsentDocRow => ({
    slug: "kullanim-sartlari",
    version: 3,
    title: "Kullanım Şartları",
    requiredVersion: 2,
    requiredPublishedAt: "2026-10-01T10:00:00Z",
    ...over,
  });

  it("eski kullanıcı onaylamadıysa bekler; yayındaki sürüm için onay istenir", () => {
    expect(pendingReconsents([doc()], [], "2026-01-01T00:00:00Z")).toEqual([{ slug: "kullanim-sartlari", version: 3, title: "Kullanım Şartları" }]);
  });

  it("gerekli sürüm ya da yenisi onaylıysa beklemez; eski sürüm onayı yetmez", () => {
    expect(pendingReconsents([doc()], [{ document: "kullanim-sartlari", version: 2 }], "2026-01-01T00:00:00Z")).toEqual([]);
    expect(pendingReconsents([doc()], [{ document: "kullanim-sartlari", version: 3 }], "2026-01-01T00:00:00Z")).toEqual([]);
    expect(pendingReconsents([doc({ requiredVersion: 3 })], [{ document: "kullanim-sartlari", version: 2 }], "2026-01-01T00:00:00Z")).toHaveLength(1);
  });

  it("yayından sonra açılan hesap beklemez (kayıtta güncel metni gördü)", () => {
    expect(pendingReconsents([doc()], [], "2026-10-05T00:00:00Z")).toEqual([]);
  });
});
