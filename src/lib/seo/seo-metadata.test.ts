import { describe, expect, it } from "vitest";
import { effectivePageView, resolvePageMetadata, resolveRootMetadata } from "./metadata";
import { getSeoPage, seoPages } from "./registry";
import { DEFAULT_SEO_GLOBAL, mergeGlobal, GlobalInputSchema, PageOverrideSchema, serializeSetting, PagesSchema } from "./schema";

const G = DEFAULT_SEO_GLOBAL;

describe("kök metadata varsayılanları (ayar yokken bugünkü değerler)", () => {
  const root = resolveRootMetadata(G);
  it("başlık, açıklama ve şablon eski layout sabitleriyle aynı", () => {
    expect(root.title).toEqual({ default: "EmlakSoft — Türkiye’nin emlak işletim sistemi", template: "%s | EmlakSoft" });
    expect(root.description).toContain("Müşteriden tapuya, ilandan komisyona");
    expect(root.applicationName).toBe("EmlakSoft");
  });
  it("Open Graph tr_TR ve Twitter büyük kart", () => {
    expect(root.openGraph).toMatchObject({ type: "website", locale: "tr_TR", siteName: "EmlakSoft", url: "/" });
    expect(root.twitter).toMatchObject({ card: "summary_large_image" });
  });
  it("doğrulama kodu yoksa verification alanı basılmaz; varsa Google/Yandex/Bing eklenir", () => {
    expect(root.verification).toBeUndefined();
    const withCodes = resolveRootMetadata(
      mergeGlobal({ verification: { google: "abcdefghij123", bing: "bingtoken12345", yandex: "yandextoken123" } }),
    );
    expect(withCodes.verification).toMatchObject({ google: "abcdefghij123", yandex: "yandextoken123", other: { "msvalidate.01": "bingtoken12345" } });
  });
  it("Twitter kullanıcı adı @ ile ya da @ olmadan kaydedilir", () => {
    expect(mergeGlobal({ twitterHandle: "@emlaksoft" }).twitterHandle).toBe("emlaksoft");
    expect(resolveRootMetadata(mergeGlobal({ twitterHandle: "emlaksoft" })).twitter).toMatchObject({ site: "@emlaksoft" });
  });
});

describe("sayfa metadata'sı: ayar yokken eski metadata sabitleriyle uyum", () => {
  it("/fiyatlar", () => {
    const m = resolvePageMetadata("/fiyatlar", G, {});
    expect(m.title).toBe("Fiyatlar");
    expect(m.description).toMatch(/^EmlakSoft paketleri, aylık ve yıllık fiyatlar/);
    expect(m.alternates).toEqual({ canonical: "/fiyatlar" });
    expect(m.openGraph).toMatchObject({ title: "EmlakSoft Fiyatlar", url: "/fiyatlar", type: "website", locale: "tr_TR" });
    expect(m.robots).toBeUndefined();
  });
  it("/demo ve /kayit OG başlıkları", () => {
    expect(resolvePageMetadata("/demo", G, {}).openGraph).toMatchObject({ title: "EmlakSoft — 14 Gün Ücretsiz Dene", url: "/demo" });
    expect(resolvePageMetadata("/kayit", G, {}).openGraph).toMatchObject({ title: "EmlakSoft — Ücretsiz Başla", url: "/kayit" });
    expect(resolvePageMetadata("/kayit", G, {}).title).toBe("Ofisinizi Ücretsiz Oluşturun");
  });
  it("/giris her zaman noindex+follow ve admin indekslenebilir yapamaz", () => {
    expect(resolvePageMetadata("/giris", G, {}).robots).toEqual({ index: false, follow: true });
    expect(resolvePageMetadata("/giris", G, { "/giris": { robotsIndex: true } }).robots).toEqual({ index: false, follow: true });
  });
  it("yasal sayfalar başlık, açıklama ve canonical taşır", () => {
    for (const p of ["/gizlilik", "/kullanim-sartlari", "/cerez-politikasi", "/kvkk-aydinlatma", "/iptal-iade", "/mesafeli-satis", "/on-bilgilendirme", "/davet-kosullari"]) {
      const m = resolvePageMetadata(p, G, {});
      expect(typeof m.title).toBe("string");
      expect(m.description).toBeTruthy();
      expect(m.alternates).toEqual({ canonical: p });
    }
    expect(resolvePageMetadata("/gizlilik", G, {}).title).toBe("Gizlilik Politikası");
    expect(resolvePageMetadata("/iptal-iade", G, {}).title).toBe("İptal & İade Politikası");
  });
  it("/araclar eski OG değerleri", () => {
    const m = resolvePageMetadata("/araclar", G, {});
    expect(m.title).toBe("Ücretsiz emlak hesaplama araçları");
    expect(m.openGraph).toMatchObject({ title: "Ücretsiz emlak hesaplama araçları | EmlakSoft", url: "/araclar" });
  });
  it("ana sayfa: canonical '/' ve ayar yokken OG/başlık kökten gelir", () => {
    const m = resolvePageMetadata("/", G, {});
    expect(m.alternates).toEqual({ canonical: "/" });
    expect(m.title).toBeUndefined();
    expect(m.openGraph).toBeUndefined();
  });
  it("her sayfa kaydı canonical ve OG üretir (ana sayfa hariç)", () => {
    for (const def of seoPages().filter((p) => p.path !== "/")) {
      const m = resolvePageMetadata(def.path, G, {});
      expect(m.alternates).toEqual({ canonical: def.path });
      expect(m.openGraph).toBeDefined();
      expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    }
  });
});

describe("admin override'ları", () => {
  it("başlık, açıklama, canonical ve OG değerleri üzerine yazılır", () => {
    const m = resolvePageMetadata("/fiyatlar", G, {
      "/fiyatlar": { title: "Yeni başlık", description: "Yeni açıklama", canonical: "https://emlaksoft.vercel.app/fiyatlar", ogTitle: "OG başlık", ogImage: "/ozel-og.png" },
    });
    expect(m.title).toBe("Yeni başlık");
    expect(m.description).toBe("Yeni açıklama");
    expect(m.alternates).toEqual({ canonical: "https://emlaksoft.vercel.app/fiyatlar" });
    expect(m.openGraph).toMatchObject({ title: "OG başlık", images: [{ url: "/ozel-og.png" }] });
  });
  it("noindex/nofollow robots'a yansır", () => {
    expect(resolvePageMetadata("/kayit", G, { "/kayit": { robotsIndex: false } }).robots).toEqual({ index: false, follow: true });
    expect(resolvePageMetadata("/kayit", G, { "/kayit": { robotsFollow: false } }).robots).toEqual({ index: true, follow: false });
    // /demo artık /kayit'a yönlenir: varsayılan noindex.
    expect(resolvePageMetadata("/demo", G, {}).robots).toEqual({ index: false, follow: true });
  });
  it("ana sayfa başlığı override edilince şablon uygulanmaz (absolute)", () => {
    const m = resolvePageMetadata("/", G, { "/": { title: "Özel ana sayfa başlığı" } });
    expect(m.title).toEqual({ absolute: "Özel ana sayfa başlığı" });
    expect(m.openGraph).toMatchObject({ title: "Özel ana sayfa başlığı" });
  });
  it("genel varsayılan OG görseli ayarlanınca sayfa kartları onu kullanır", () => {
    const g = mergeGlobal({ ogImage: "https://cdn.example.com/og.png" });
    expect(resolvePageMetadata("/demo", g, {}).openGraph).toMatchObject({ images: [{ url: "https://cdn.example.com/og.png" }] });
  });
  it("dinamik sayfa (extra): kayıt yoksa extra değerleri ve noindex kullanılır", () => {
    const m = resolvePageMetadata("/vitrin/x", G, {}, { title: "Ofis | Vitrin", titleAbsolute: true, description: "d", noindex: true });
    expect(m.title).toEqual({ absolute: "Ofis | Vitrin" });
    expect(m.robots).toEqual({ index: false, follow: true });
  });
  it("effectivePageView: noindex sayfa sitemap'te sayılmaz", () => {
    const view = effectivePageView(getSeoPage("/demo")!, { robotsIndex: false }, G);
    expect(view.indexable).toBe(false);
    expect(view.inSitemap).toBe(false);
  });
});

describe("ayar şeması", () => {
  it("HTML içeren metin reddedilir", () => {
    expect(PageOverrideSchema.safeParse({ title: "<script>alert(1)</script>" }).success).toBe(false);
    expect(GlobalInputSchema.safeParse({ defaultDescription: "a <b>kalın</b>" }).success).toBe(false);
  });
  it("başlık şablonu %s içermeli", () => {
    expect(GlobalInputSchema.safeParse({ titleTemplate: "EmlakSoft" }).success).toBe(false);
    expect(GlobalInputSchema.safeParse({ titleTemplate: "%s · EmlakSoft" }).success).toBe(true);
  });
  it("doğrulama kodu meta etiketi olarak yapıştırılırsa reddedilir", () => {
    expect(GlobalInputSchema.safeParse({ verification: { google: '<meta name="google-site-verification" content="x">' } }).success).toBe(false);
  });
  it("sameAs yalnız https adresi kabul eder", () => {
    expect(GlobalInputSchema.safeParse({ organization: { sameAs: ["javascript:alert(1)"] } }).success).toBe(false);
    expect(GlobalInputSchema.safeParse({ organization: { sameAs: ["https://www.linkedin.com/company/x"] } }).success).toBe(true);
  });
  it("boyut sınırı aşılınca yazma reddedilir", () => {
    const big: Record<string, { description: string }> = {};
    for (let i = 0; i < 400; i += 1) big[`/p${i}`] = { description: "x".repeat(300) };
    const res = serializeSetting("pages", PagesSchema, big);
    expect(res.ok).toBe(false);
  });
});
