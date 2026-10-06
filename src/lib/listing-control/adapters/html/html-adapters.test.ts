import { describe, expect, it } from "vitest";
import { allPortalHosts, getHtmlAdapter, listHtmlAdapters, PORTAL_RULES_VERSION } from "./index";
import { cleanText, decodeEntities, extractJsonLd, type FetchedPage } from "./parse-core";
import { replyToReport } from "../../worker/core";

/**
 * Portal HTML ayrıştırıcıları — SENTETİK örnek sayfalar (gerçek portal sayfası KOPYALANMADI). Amaç kural motorunun
 * karar sırasını kilitlemek: engel/hata ASLA "ilan yok" olmaz; "yok" yalnız 404/410 ya da kaldırıldı ibaresiyle.
 */

const SEEN = "2026-10-07T10:00:00.000Z";
const sah = getHtmlAdapter("sahibinden")!;
const he = getHtmlAdapter("hepsiemlak")!;
const ej = getHtmlAdapter("emlakjet")!;

const page = (html: string, over: Partial<FetchedPage> = {}): FetchedPage => ({
  status: 200,
  finalUrl: "https://www.sahibinden.com/ilan/emlak-konut-satilik-kadikoy-3-1-1234567890/detay",
  html,
  ...over,
});

const SAH_LIVE = `<!doctype html><html><head><title>Kadıköy 3+1</title></head><body>
<h1 class="classified-title">Kadıköy Moda&#39;da 3+1 120 m² Daire</h1>
<div class="classified-price-wrapper"><span class="classified-price">4.750.000 TL</span></div>
<ul class="classified-info"><li><strong>İlan No</strong> <span>1234567890</span></li></ul>
<div class="username-info"><span>Örnek Gayrimenkul</span></div>
<script src="https://www.google.com/recaptcha/api.js"></script>
</body></html>`;

describe("kayıt ve sürüm", () => {
  it("üç portal ayrı modül; host listesi manifest tek kaynağı; kurallar sürümlü ve doğrulanmamış", () => {
    expect(listHtmlAdapters().map((a) => a.id)).toEqual(["sahibinden", "hepsiemlak", "emlakjet"]);
    expect(allPortalHosts()).toEqual(["emlakjet.com", "hepsiemlak.com", "sahibinden.com"]);
    expect(PORTAL_RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(sah.rulesVerified).toBe(false);
    expect(getHtmlAdapter("zingat")).toBeNull();
  });
  it("URL denetimi: yalnız https + portal alanı + ilan yolu", () => {
    expect(sah.isListingUrl("https://www.sahibinden.com/ilan/x-1234567890/detay")).toBe(true);
    expect(sah.isListingUrl("http://www.sahibinden.com/ilan/x-1234567890/detay")).toBe(false);
    expect(sah.isListingUrl("https://evil.example/ilan/x-1234567890/detay")).toBe(false);
    expect(sah.isListingUrl("https://www.sahibinden.com.evil.example/ilan/x-1234567890/detay")).toBe(false);
    expect(sah.isPortalUrl("https://www.sahibinden.com/magaza/ornek")).toBe(true);
  });
});

describe("sahibinden ilan sayfası", () => {
  it("yayında: ilan no + fiyat + başlık + ilan sahibi (reCAPTCHA betiği tek başına engel sayılmaz)", () => {
    const r = sah.parseListing(page(SAH_LIVE), "1234567890");
    expect(r).toEqual({ found: true, price: 4_750_000, title: "Kadıköy Moda'da 3+1 120 m² Daire", advisorName: "Örnek Gayrimenkul", status: null });
    expect(replyToReport(r, SEEN)).toEqual({
      result: "present",
      observed: { price: 4_750_000, title: "Kadıköy Moda'da 3+1 120 m² Daire", advisor_name: "Örnek Gayrimenkul" },
    });
  });
  it("404/410 → bulunamadı (absent)", () => {
    for (const status of [404, 410]) {
      const r = sah.parseListing(page("", { status }), "1234567890");
      expect(r).toEqual({ found: false, notFound: true });
      expect(replyToReport(r, SEEN).result).toBe("absent");
    }
  });
  it("kaldırıldı ibaresi → bulunamadı (eski ilan no sayfada dursa bile)", () => {
    const html = `<html><body><div class="warning">Bu ilan yayından kaldırılmıştır.</div><span>İlan No</span> 1234567890</body></html>`;
    expect(replyToReport(sah.parseListing(page(html), "1234567890"), SEEN).result).toBe("absent");
  });
  it("CAPTCHA / 429 / 403 / giriş duvarı → blocked, ASLA absent değil", () => {
    const captcha = `<html><body><div id="challenge-platform">Olağandışı erişim tespit ettik</div></body></html>`;
    expect(sah.parseListing(page(captcha), "1234567890")).toEqual({ error: "captcha" });
    expect(replyToReport(sah.parseListing(page(captcha), "1234567890"), SEEN).result).toBe("blocked");
    expect(replyToReport(sah.parseListing(page("", { status: 429 }), "1234567890"), SEEN).result).toBe("blocked");
    expect(replyToReport(sah.parseListing(page("", { status: 403 }), "1234567890"), SEEN).result).toBe("blocked");
    expect(replyToReport(sah.parseListing(page("", { status: 503 }), "1234567890"), SEEN).result).toBe("blocked");
    const login = sah.parseListing(page("<html>Giriş yap</html>", { finalUrl: "https://secure.sahibinden.com/giris?return_url=x" }), "1234567890");
    expect(login).toEqual({ error: "login_required" });
    expect(replyToReport(login, SEEN).result).toBe("blocked");
  });
  it("beklenmeyen yapı / farklı ilan no / portal dışına yönlendirme → error (kontrol edilemedi), absent değil", () => {
    const odd = sah.parseListing(page("<html><body><p>Hoş geldiniz</p></body></html>"), "1234567890");
    expect(odd).toEqual({ error: "unexpected_structure" });
    expect(replyToReport(odd, SEEN).result).toBe("error");
    const other = sah.parseListing(page(SAH_LIVE.replace("1234567890</span>", "9999999999</span>")), "1234567890");
    expect(other).toEqual({ error: "id_mismatch" });
    expect(replyToReport(sah.parseListing(page(SAH_LIVE, { finalUrl: "https://evil.example/x" }), "1234567890"), SEEN).result).toBe("error");
  });
  it("JSON-LD yedeği: kalıp tutmasa da schema.org Offer'dan okunur", () => {
    const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Moda 2+1","sku":"1234567890","offers":{"@type":"Offer","price":"3250000","seller":{"name":"Deneme Emlak"}}}]}</script></head><body></body></html>`;
    expect(sah.parseListing(page(html), "1234567890")).toMatchObject({ found: true, price: 3_250_000, title: "Moda 2+1", advisorName: "Deneme Emlak" });
  });
});

describe("hepsiemlak ve emlakjet", () => {
  it("hepsiemlak yayında / kaldırıldı", () => {
    const url = "https://www.hepsiemlak.com/istanbul-kadikoy-satilik/daire/12345678-detay";
    const live = `<html><h1>Kadıköy 2+1 Satılık</h1><div class="price">2.900.000 TL</div><span>İlan No: <b>12345678</b></span><div class="firm-name"><a>Deneme Ofis</a></div></html>`;
    expect(he.parseListing({ status: 200, finalUrl: url, html: live }, "12345678")).toMatchObject({ found: true, price: 2_900_000, advisorName: "Deneme Ofis" });
    expect(he.parseListing({ status: 200, finalUrl: url, html: "<p>Bu ilan artık yayında değil</p>" }, "12345678")).toEqual({ found: false, notFound: true });
  });
  it("emlakjet yayında / 410", () => {
    const url = "https://www.emlakjet.com/ilan/kadikoy-satilik-daire-87654321";
    const live = `<html><h1>Satılık 3+1</h1><span class="price-value">5.100.000 TL</span><div>İlan Numarası 87654321</div></html>`;
    expect(ej.parseListing({ status: 200, finalUrl: url, html: live }, "87654321")).toMatchObject({ found: true, price: 5_100_000 });
    expect(ej.parseListing({ status: 410, finalUrl: url, html: "" }, "87654321")).toEqual({ found: false, notFound: true });
  });
});

describe("mağaza (liste) sayfası", () => {
  it("ilan bağlantıları tekilleşir, sonraki sayfa portal içinde kalır", () => {
    const html = `<html><a href="/ilan/a-1111111111/detay">A</a><a href="/ilan/a-1111111111/detay">A tekrar</a>
      <a href="https://www.sahibinden.com/ilan/b-2222222222/detay">B</a><a href="https://evil.example/ilan/c-3333333333/detay">C</a>
      <a class="pg" href="/magaza/ornek?pagingOffset=20" rel="next">Sonraki</a></html>`;
    const r = sah.parseStore({ status: 200, finalUrl: "https://www.sahibinden.com/magaza/ornek", html });
    expect(r.error).toBeNull();
    expect(r.items.map((i) => i.externalId)).toEqual(["1111111111", "2222222222"]);
    expect(r.nextUrl).toBe("https://www.sahibinden.com/magaza/ornek?pagingOffset=20");
  });
  it("ilan bulunamayan liste sayfası 'tam liste' sayılmaz (no_items / captcha)", () => {
    expect(sah.parseStore({ status: 200, finalUrl: "https://www.sahibinden.com/magaza/x", html: "<p>boş</p>" }).error).toBe("no_items");
    expect(sah.parseStore({ status: 200, finalUrl: "https://www.sahibinden.com/magaza/x", html: "<div class='g-recaptcha'></div>" }).error).toBe("captcha");
    expect(sah.parseStore({ status: 429, finalUrl: "https://www.sahibinden.com/magaza/x", html: "" }).error).toBe("http_429");
  });
});

describe("yardımcılar", () => {
  it("varlık çözme ve metin temizleme", () => {
    expect(decodeEntities("A&amp;B &#39;x&#39; &#x15F;")).toBe("A&B 'x' ş");
    expect(cleanText("  <b>Kadıköy</b>\n  3+1 ", 300)).toBe("Kadıköy 3+1");
    expect(cleanText("", 10)).toBeNull();
  });
  it("bozuk JSON-LD atlanır", () => {
    expect(extractJsonLd(`<script type="application/ld+json">{bozuk</script>`)).toEqual([]);
  });
});
