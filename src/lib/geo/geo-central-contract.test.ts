import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ZORLAYICI SÖZLEŞME: coğrafya (il/ilçe/mahalle) verisi TEK MERKEZDEN (src/lib/geo/**) gelir.
 *
 *  (a) geo_provinces / geo_districts / geo_neighborhoods tablolarına doğrudan `from(...)` çağrısı
 *      YALNIZ src/lib/geo/** içinde olabilir. Başka yerde gerekiyorsa servise (reader/resolve) fonksiyon ekleyin.
 *  (b) src/ içinde sabit il listesi YASAK (il adlarını koda gömmeyin; `getProvinces()` kullanın).
 *  (c) Yeni formda serbest metin il/ilçe `<input>` YASAK → GeoSelect + sunucuda doğrulama
 *      (`resolveChainForSave` / `resolveOfficeGeo`).
 *
 * İstisnalar GEREKÇELİ listelerdedir; düzeltilen dosya listeden SİLİNMELİ (eskimiş girdi de fail eder).
 */

/** (a) dosya -> gerekçe. Şu an istisna yok. */
const FROM_EXCEPTIONS: Record<string, string> = {};

/** (c) dosya -> gerekçe (rollout bekleyen serbest metin alanları). */
const FREE_TEXT_EXCEPTIONS: Record<string, string> = {
  "src/app/odeme-link/[token]/pay-buttons.tsx":
    "ROLLOUT BEKLİYOR: ödeme alıcısı fatura adresi sağlayıcıya serbest metin gider (lib/billing/buyer.ts sözleşmesi); ödeme akışı bu görev dışı",
};

const PROVINCE_SAMPLE = [
  "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ardahan", "Artvin", "Aydın", "Balıkesir", "Bartın",
  "Batman", "Bayburt", "Bilecik", "Bingöl", "Bitlis", "Burdur", "Çanakkale", "Çankırı", "Düzce", "Edirne",
];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const rel = (file: string) => relative(".", file).replaceAll("\\", "/");

const files = walk("src")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
  .map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }));
const outsideGeo = files.filter((f) => !f.path.startsWith("src/lib/geo/"));

describe("coğrafya tek merkez sözleşmesi", () => {
  it("(a) geo_* tablolarına doğrudan from(...) yalnız src/lib/geo/** içinde", () => {
    const re = /from\(\s*["'`]geo_(?:provinces|districts|neighborhoods)["'`]/;
    const hits = outsideGeo.filter((f) => re.test(f.text) && !(f.path in FROM_EXCEPTIONS)).map((f) => f.path);
    expect(
      hits,
      "Coğrafya tablosuna doğrudan from() yasak: src/lib/geo/reader.ts (okuma) ya da admin-store.ts (yönetim) içine fonksiyon ekleyin.",
    ).toEqual([]);
  });

  it("(a) istisna listesinde bayat girdi yok", () => {
    const re = /from\(\s*["'`]geo_(?:provinces|districts|neighborhoods)["'`]/;
    const stale = Object.keys(FROM_EXCEPTIONS).filter((p) => !outsideGeo.find((f) => f.path === p && re.test(f.text)));
    expect(stale).toEqual([]);
  });

  it("(b) sabit il listesi yok", () => {
    const hits = outsideGeo
      .filter((f) => PROVINCE_SAMPLE.filter((name) => f.text.includes(`"${name}"`) || f.text.includes(`'${name}'`)).length >= 5)
      .map((f) => f.path);
    expect(hits, "İl adlarını koda gömmeyin: getProvinces()/getProvinceOptions() kullanın.").toEqual([]);
  });

  it("(c) serbest metin il/ilçe input'u yok (istisnalar gerekçeli)", () => {
    const re = /<(?:input|Input|FormInput)\b[^>]*?\bname=(?:"|\{")(?:city|district|il|ilce|sehir|town|province)(?:"|"\})/;
    const hits = files.filter((f) => f.path.endsWith(".tsx") && re.test(f.text)).map((f) => f.path);
    const fresh = hits.filter((p) => !(p in FREE_TEXT_EXCEPTIONS));
    expect(fresh, "Serbest metin il/ilçe alanı yasak: GeoSelect kullanın ve sunucuda resolveChainForSave ile doğrulayın.").toEqual([]);
    const stale = Object.keys(FREE_TEXT_EXCEPTIONS).filter((p) => !hits.includes(p));
    expect(stale, "Düzeltilen dosyayı istisna listesinden silin.").toEqual([]);
  });

  it("(c) ofis ayarları ve kurulum sihirbazı GeoSelect + sunucu doğrulaması kullanır", () => {
    const text = (p: string) => files.find((f) => f.path === p)?.text ?? "";
    expect(text("src/app/app/ayarlar/company-form.tsx")).toContain("GeoSelect");
    expect(text("src/app/app/ayarlar/profil-tamamla/profil-sihirbaz.tsx")).toContain("GeoSelect");
    // Kurulum sihirbazının ofis adımı alanları yeniden sormaz: tek kaynak profil-tamamla sihirbazıdır.
    expect(text("src/app/app/baslangic/office-step.tsx")).toContain("PROFILE_WIZARD_HREF");
    expect(text("src/app/actions/settings.ts")).toContain("resolveOfficeGeo");
    expect(text("src/app/actions/onboarding-setup.ts")).toContain("resolveOfficeGeo");
  });
});
