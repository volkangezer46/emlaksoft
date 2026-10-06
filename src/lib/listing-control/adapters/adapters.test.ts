import { describe, expect, it } from "vitest";
import { assistedAllowedHosts, getAdapter, listAdapters } from "./index";
import { clearAdaptersForTest, registerAdapter } from "./registry";
import { parseCsv, parseInventoryCsv, parsePriceText } from "./inventory-csv";
import { listingCheckToResult, type ListingCheckResult } from "./types";
import { sahibindenAdapter } from "./sahibinden";

const result = (over: Partial<ListingCheckResult> = {}): ListingCheckResult => ({
  found: true, active: true, price: null, title: null, advisorName: null, listingNo: null, seenAt: "2026-03-01T10:00:00.000Z", confidence: 0.9, error: null, ...over,
});

describe("portal adaptör kaydı", () => {
  it("üç iskelet varsayılan olarak kayıtlı ve bağımsızdır", () => {
    expect(listAdapters().map((a) => a.id).sort()).toEqual(["emlakjet", "hepsiemlak", "sahibinden"]);
    expect(getAdapter("Sahibinden")?.label).toBe("Sahibinden");
    expect(getAdapter("zingat")).toBeNull();
  });

  it("iskeletlerde API ve kullanıcı-destekli yollar KAPALI (bağlantı yoksa kapalı)", () => {
    for (const a of listAdapters()) {
      expect(a.capabilities).toMatchObject({ api: false, feed: false, userAssisted: false, csvImport: true, manual: true });
      expect(a.checkListing).toBeUndefined();
      expect(a.assistedRecipe).toBeUndefined();
    }
    expect(assistedAllowedHosts()).toEqual([]);
  });

  it("yinelenen/geçersiz kimlik reddedilir", () => {
    expect(() => registerAdapter(sahibindenAdapter)).toThrow(/zaten kayıtlı/);
    expect(() => registerAdapter({ ...sahibindenAdapter, id: "Bad Id" })).toThrow(/Geçersiz/);
  });

  it("registry temizlenip yeniden kurulabilir (test izolasyonu)", () => {
    clearAdaptersForTest();
    expect(listAdapters()).toEqual([]);
    registerAdapter(sahibindenAdapter);
    expect(listAdapters()).toHaveLength(1);
  });
});

describe("URL → ilan no normalizasyonu (ağsız)", () => {
  it("izinli host ve kalıp: ilan no çıkar; sorgu/parça atılır", () => {
    const r = sahibindenAdapter.normalize({ url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-3-1-1234567890/detay?x=1#a" });
    expect(r).toEqual({ externalId: "1234567890", url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-3-1-1234567890/detay" });
  });
  it("yabancı host'tan id çıkarılmaz; elle girilen id korunur", () => {
    expect(sahibindenAdapter.normalize({ url: "https://evil.example/ilan/x-1234567890/detay" })).toBeNull();
    expect(sahibindenAdapter.normalize({ url: "https://evil.example/x", externalId: "555666" })).toEqual({ externalId: "555666", url: null });
  });
  it("çelişen id/URL yanlış eşleştirme yerine reddedilir", () => {
    expect(sahibindenAdapter.normalize({ url: "https://www.sahibinden.com/ilan/x-1234567890/detay", externalId: "999999" })).toBeNull();
  });
  it("tanınmayan kalıp null (kullanıcıdan id istenir)", () => {
    expect(sahibindenAdapter.normalize({ url: "https://www.sahibinden.com/" })).toBeNull();
    expect(sahibindenAdapter.normalize({})).toBeNull();
  });
});

describe("envanter CSV", () => {
  const seen = "2026-03-01T10:00:00.000Z";
  it("Türkçe başlıklar, ; ayracı, tırnaklı hücre ve fiyat biçimleri", () => {
    const csv = 'İlan No;Başlık;Fiyat;Durum;Danışman\n123456;"Kadıköy; 3+1";1.250.000;Yayında;Ayşe\n789012;Maltepe;"2.500.000,50";Pasif;\n';
    const rows = parseInventoryCsv("sahibinden", csv, seen);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ externalId: "123456", title: "Kadıköy; 3+1", price: 1_250_000, status: "active", advisorName: "Ayşe", seenAt: seen });
    expect(rows[1]).toMatchObject({ price: 2_500_000.5, status: "passive", advisorName: null });
  });
  it("ilan no sütunu yoksa HİÇ satır üretilmez", () => {
    expect(parseInventoryCsv("x", "Başlık,Fiyat\nA,1", seen)).toEqual([]);
  });
  it("BOM, boş satır, CRLF", () => {
    expect(parseCsv("﻿id,fiyat\r\n1,10\r\n\r\n2,20\r\n")).toEqual([["﻿id", "fiyat"], ["1", "10"], ["2", "20"]]);
    expect(parseInventoryCsv("x", "﻿id,fiyat\r\n1,10\r\n", seen)[0]).toMatchObject({ externalId: "1", price: 10 });
  });
  it("fiyat ayrıştırma", () => {
    expect([parsePriceText("1.250.000"), parsePriceText("1250000"), parsePriceText("12,5"), parsePriceText("abc"), parsePriceText("")]).toEqual([1_250_000, 1_250_000, 12.5, null, null]);
  });
  it("iskelet adaptör parseInventory csv'yi işler, xml'i işlemez", () => {
    const a = getAdapter("sahibinden") ?? sahibindenAdapter;
    expect(a.parseInventory?.("csv", "id,fiyat\n1,5", seen)).toHaveLength(1);
    expect(a.parseInventory?.("xml", "<a/>", seen)).toEqual([]);
  });
});

describe("kontrol sonucu → gözlem türü", () => {
  it("bulundu → present; bulunamadı (hatasız) → absent", () => {
    expect(listingCheckToResult(result())).toBe("present");
    expect(listingCheckToResult(result({ found: false }))).toBe("absent");
  });
  it("hata/engel ASLA absent değildir", () => {
    expect(listingCheckToResult(result({ found: false, error: "captcha" }))).toBe("blocked");
    expect(listingCheckToResult(result({ found: null, error: "http_429" }))).toBe("blocked");
    expect(listingCheckToResult(result({ found: null, error: "http_503" }))).toBe("blocked");
    expect(listingCheckToResult(result({ found: null, error: "timeout" }))).toBe("blocked");
    expect(listingCheckToResult(result({ found: false, error: "parse_error" }))).toBe("error");
  });
  it("belirlenemedi (found=null, hata yok) → error, absent değil", () => {
    expect(listingCheckToResult(result({ found: null }))).toBe("error");
  });
});
